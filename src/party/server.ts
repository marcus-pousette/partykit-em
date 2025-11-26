import type * as Party from "partykit/server"
import * as CRDT from "../shared/crdt"
import * as Messages from "../shared/messages"
import type { Message } from "../shared/messages"
import type { MoveOperation } from "../shared/operation"
import { sql } from "../shared/sql"
import { PostgresDriver } from "../shared/pg-driver"
import { RoomStatus } from "../shared/room-status"

type BenchSeedOptions = { size: number; shape?: "bfs" | "chain" | "fanout" }
type BenchMessage =
  | { type: "bench:seed"; options: BenchSeedOptions }
  | { type: "bench:applyMoves"; moves: MoveOperation[] }
  | { type: "bench:getParent"; nodeId: string }
  | { type: "bench:getNodeCount" }

export default class Server implements Party.Server {
  // biome-ignore lint/style/noNonNullAssertion: <explanation>
  driver: PostgresDriver = null!

  status: RoomStatus = RoomStatus.BOOTING

  constructor(readonly room: Party.Room) {}

  /**
   * This is called when the server starts, before `onConnect` or `onRequest`.
   */
  async onStart() {
    try {
      this.driver = new PostgresDriver(this.room.id, {
        host: this.room.env.PG_HOST as string,
        user: this.room.env.PG_USER as string,
        password: this.room.env.PG_PASSWORD as string,
        db: this.room.env.PG_DB as string,
      })

      // Create tables if they don't exist yet.
      await this.driver.createTables()

      this.updateStatus(RoomStatus.READY)
    } catch (error) {
      console.error("Failed to start server.", error)
      this.updateStatus(RoomStatus.ERROR)
      throw error
    }
  }

  /**
   * Validate connections before accepting them.
   *
   * NOTE: This is where we would do authorization.
   */
  static async onBeforeConnect(request: Party.Request, lobby: Party.Lobby) {
    // Only allow alphanumeric characters and underscores for rooms
    if (!/^[a-z0-9_]{2,}$/.test(lobby.id))
      return new Response("Unauthorized", { status: 401 })

    return request
  }

  /**
   * Handles connection open events.
   *
   * Sends the current status to the new client and broadcasts the current list of clients to the room.
   */
  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // send the current status to the new client
    conn.send(JSON.stringify(Messages.status(this.status)))

    // broadcast the current list of clients to the room
    this.room.broadcast(
      JSON.stringify(
        Messages.connections(
          [...this.room.getConnections()].map((conn) => conn.id)
        )
      )
    )
  }

  /**
   * Handles connection close events.
   */
  async onClose(_connection: Party.Connection) {
    this.room.broadcast(
      JSON.stringify(
        Messages.connections(
          [...this.room.getConnections()].map((conn) => conn.id)
        )
      ),
      []
    )
  }

  /**
   * Handles incoming messages.
   */
  onMessage(message: string, sender: Party.Connection) {
    try {
      const data = JSON.parse(message) as Message

      switch (data.type) {
        case "ping": {
          sender.send(JSON.stringify(Messages.status(this.status)))
          sender.send(
            JSON.stringify(
              Messages.connections(
                [...this.room.getConnections()].map((conn) => conn.id)
              )
            )
          )

          break
        }

        default: {
          console.log("Unknown message type", data)
          break
        }
      }
    } catch (error) {
      console.error("Error parsing message", error)
    }
  }

  /**
   * Handles incoming requests.
   */
  async onRequest(req: Party.Request) {
    console.log("onRequest", req.method, req.url)

    if (req.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      })

    if (req.method === "POST") {
      const message = (await req.json()) as Message | BenchMessage

      switch (message.type) {
        case "push": {
          // TODO: Validation
          const now = new Date()

          const moveOps = message.operations.filter(
            (op): op is MoveOperation => op.type === "MOVE"
          )

          if (!moveOps.length)
            return this.json({ sync_timestamp: now.toISOString() })

          const clientId = moveOps[0].client_id

          this.room.broadcast(
            JSON.stringify(Messages.push(message.operations)),
            [clientId]
          )

          // PostgreSQL-optimized CRDT implementation
          await this.driver.insertMoveOperations(
            message.operations
              .filter((op) => op.type === "MOVE")
              .map((op) => ({
                ...op,
                sync_timestamp: now.toISOString(),
              }))
          )

          return this.json({ sync_timestamp: now.toISOString() })
        }

        case "sync:stream": {
          const { lastSyncTimestamp } = message

          const upperLimit = new Date().toISOString()

          const total = await this.driver.total({
            from: lastSyncTimestamp,
            until: upperLimit,
          })

          const header = {
            lowerLimit: lastSyncTimestamp,
            upperLimit: upperLimit,
            nodes: total.nodes,
            operations: total.operations,
          }

          console.log(`Sending ${header.operations} operations.`)

          const stream = new ReadableStream({
            start: async (controller) => {
              const encoder = new TextEncoder()

              controller.enqueue(encoder.encode(`${JSON.stringify(header)}\n`))

              try {
                for await (const operations of this.driver.streamOperations({
                  from: lastSyncTimestamp,
                  until: upperLimit,
                  chunkSize: 1000,
                  abort: req.signal,
                })) {
                  controller.enqueue(
                    encoder.encode(
                      `${operations
                        .map((op) => JSON.stringify(op))
                        .join("\n")}\n`
                    )
                  )
                }

                controller.close()
              } catch (err) {
                controller.error(err)
              }
            },
          })

          return new Response(stream, {
            headers: {
              "Content-Type": "application/x-ndjson",
              "Access-Control-Allow-Origin": "*",
            },
          })
        }

        case "subtree": {
          const { id, depth } = message
          const nodes = await CRDT.subtree(this.driver, id, depth)
          return this.json(nodes)
        }

        case "bench:seed": {
          await benchSeed(this.driver, message.options)
          return this.json({ ok: true })
        }

        case "bench:applyMoves": {
          await benchApplyMoves(this.driver, message.moves)
          return this.json({ ok: true })
        }

        case "bench:getParent": {
          const parent = await benchGetParent(this.driver, message.nodeId)
          return this.json({ parent_id: parent })
        }

        case "bench:getNodeCount": {
          const count = await benchGetNodeCount(this.driver)
          return this.json({ count })
        }

        default:
          return new Response("Not found", { status: 404 })
      }
    }

    return new Response("Not found", { status: 404 })
  }

  /**
   * Updates the room status and broadcasts it to all clients.
   */
  async updateStatus(status: RoomStatus) {
    if (status === this.status) return

    this.status = status
    this.room.broadcast(JSON.stringify(Messages.status(status)), [])
  }

  /**
   * Helper function to create a JSON response with the correct headers.
   */
  json(data: any) {
    return Response.json(data, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    })
  }
}

async function benchSeed(driver: PostgresDriver, options: BenchSeedOptions) {
  await driver.createTables()

  const nodes = generateBenchNodes(options)

  await driver.transaction(async (t) => {
    await t.executeScript(sql`
      DELETE FROM nodes;
      DELETE FROM payloads;
      DELETE FROM op_log;
    `)

    const CHUNK = 2000
    for (let i = 0; i < nodes.length; i += CHUNK) {
      const slice = nodes.slice(i, i + CHUNK)
      const values = slice
        .map((n) => `('${n.id}', ${n.parent_id ? `'${n.parent_id}'` : "NULL"})`)
        .join(",")

      await t.executeScript(sql`
        INSERT INTO nodes (id, parent_id)
        VALUES ${values}
        ON CONFLICT DO NOTHING;
      `)
    }

    await t.commit()
  })
}

async function benchApplyMoves(driver: PostgresDriver, moves: MoveOperation[]) {
  const timestamped = moves.map((move) => ({
    ...move,
    sync_timestamp: move.sync_timestamp ?? new Date().toISOString(),
  }))
  await CRDT.insertMoveOperations(driver, timestamped)
}

async function benchGetParent(driver: PostgresDriver, nodeId: string) {
  const result = await driver.execute<{ parent_id: string }>(sql`
    SELECT parent_id FROM nodes WHERE id = '${nodeId}' LIMIT 1
  `)
  return result[0]?.parent_id ?? null
}

async function benchGetNodeCount(driver: PostgresDriver) {
  const result = await driver.execute<{ count: number }>(sql`
    SELECT COUNT(1) AS count FROM nodes
  `)
  return Number(result[0]?.count ?? 0)
}

function generateBenchNodes(options: BenchSeedOptions) {
  const { size, shape = "bfs" } = options
  if (shape === "chain") return generateChain(size)
  if (shape === "fanout") return generateFanout(size)
  return generateBfs(size)
}

function generateBfs(total: number) {
  const alphabet = "abcdefghijklmnopqrst".split("")
  const nodes: Array<{ id: string; parent_id: string | null }> = [
    { id: "ROOT", parent_id: null },
  ]
  const queue: string[] = []

  for (const letter of alphabet) {
    if (nodes.length >= total) break
    nodes.push({ id: letter, parent_id: "ROOT" })
    queue.push(letter)
  }

  while (nodes.length < total && queue.length) {
    const parent = queue.shift()!
    for (const letter of alphabet) {
      if (nodes.length >= total) break
      const id = `${parent}${letter}`
      nodes.push({ id, parent_id: parent })
      queue.push(id)
    }
  }

  return nodes
}

function generateChain(total: number) {
  const nodes: Array<{ id: string; parent_id: string | null }> = [
    { id: "ROOT", parent_id: null },
    { id: "a0", parent_id: "ROOT" },
    { id: "b0", parent_id: "ROOT" },
  ]
  let lastA = "a0"
  let lastB = "b0"
  let toggle = 0

  while (nodes.length < total) {
    if (toggle % 2 === 0) {
      const next = `a${nodes.length}`
      nodes.push({ id: next, parent_id: lastA })
      lastA = next
    } else {
      const next = `b${nodes.length}`
      nodes.push({ id: next, parent_id: lastB })
      lastB = next
    }
    toggle++
  }

  return nodes
}

function generateFanout(total: number) {
  const nodes: Array<{ id: string; parent_id: string | null }> = [
    { id: "ROOT", parent_id: null },
  ]
  for (let i = 0; i < total; i++) {
    nodes.push({ id: `f${i}`, parent_id: "ROOT" })
  }
  if (total > 0) {
    nodes.push({ id: "f0-child", parent_id: "f0" })
  }
  return nodes
}

Server satisfies Party.Worker
