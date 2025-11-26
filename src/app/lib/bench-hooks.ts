import { Notifier } from "./notifier"
import { insertIntoVirtualTree, state as virtualTreeState } from "./use-virtual-tree"
import type { MoveOperation } from "../../shared/operation"

type BenchTreeNode = { id: string; parent_id: string }

export type BenchHooks = {
  fetchSubtree: (id: string, depth?: number) => Promise<BenchTreeNode[]>
  applyMoves: (moves: MoveOperation[]) => void
  snapshot: () => Record<string, any>
  seed: (mode?: string) => void
  getParent: (id: string) => string | null
  getNodeCount: () => number
  pickDeepTarget: (movingId: string, minDepth?: number) => string
  pickMoveTarget: (movingId: string) => string
}

export function createBenchHooks({
  mode,
  targetCount = 1000,
}: {
  mode: string
  targetCount?: number
}): BenchHooks {
  let { nodes: tree, set: treeSet } = generateBenchTree(mode, targetCount)

  const reset = (payload: { nodes: BenchTreeNode[]; set: Set<string> }) => {
    tree = payload.nodes
    treeSet = payload.set
    resetVirtualTree(tree)
  }

  const seed = (nextMode?: string) => {
    const next = generateBenchTree(nextMode ?? mode, targetCount)
    reset(next)
  }

  resetVirtualTree(tree)

  const applyMoves = (moves: MoveOperation[]) => {
    moves.forEach((m) => {
      // Update the in-memory tree representation so counts reflect inserts.
      if (m.type === "MOVE") {
        const existingIndex = tree.findIndex((n) => n.id === m.node_id)
        if (existingIndex >= 0) {
          tree[existingIndex] = { ...tree[existingIndex], parent_id: m.new_parent_id }
        } else {
          tree.push({ id: m.node_id, parent_id: m.new_parent_id })
        }
        treeSet.add(m.node_id)
      }

      insertIntoVirtualTree(m)
    })
    Notifier.notify()
  }

  const snapshot = () =>
    JSON.parse(JSON.stringify(virtualTreeState)) as Record<string, any>

  const fetchSubtree = async (_id: string, _depth = 1) => tree

  const getParent = (id: string) => {
    const node = virtualTreeState[id] as { parent_id?: string } | undefined
    return node?.parent_id ?? null
  }

  const getNodeCount = () => treeSet.size

  const pickMoveTarget = (movingId: string) => {
    const preferredRoot = movingId.startsWith("a") ? "b" : "a"
    let candidate = preferredRoot
    for (let i = 0; i < 12; i++) {
      if (treeSet.has(candidate) && !isDescendantName(candidate, movingId)) {
        return candidate
      }
      candidate += "a"
    }

    const fallback = tree.find(
      (n) => n.id !== movingId && !isDescendantName(n.id, movingId),
    )
    return fallback?.id ?? "ROOT"
  }

  const pickDeepTarget = (movingId: string, minDepth = 4) => {
    const base = movingId.startsWith("a") ? "b" : "a"
    let candidate = base
    for (let i = 0; i < minDepth + 8; i++) {
      if (treeSet.has(candidate) && !isDescendantName(candidate, movingId)) {
        if (candidate.length - base.length >= minDepth) return candidate
      }
      candidate += "a"
    }
    return pickMoveTarget(movingId)
  }

  return {
    fetchSubtree,
    applyMoves,
    snapshot,
    seed,
    getParent,
    getNodeCount,
    pickMoveTarget,
    pickDeepTarget,
  }
}

function generateBenchTree(
  mode: string,
  targetCount: number,
): { nodes: BenchTreeNode[]; set: Set<string> } {
  const chainMatch = mode.match(/^chain-(\d+)/)
  const fanoutMatch = mode.match(/^fanout-(\d+)/)
  if (mode === "empty") return { nodes: [], set: new Set() }
  if (mode === "small" || mode === "move-small") {
    const nodes = [
      { id: "a", parent_id: "ROOT" },
      { id: "b", parent_id: "ROOT" },
    ]
    return { nodes, set: new Set(nodes.map((n) => n.id)) }
  }
  if (chainMatch) {
    const total = Number(chainMatch[1])
    return generateChain(total)
  }
  if (fanoutMatch) {
    const total = Number(fanoutMatch[1])
    return generateFanout(total)
  }

  const sizeMatch = mode.match(/(\d+)/)
  const total = Number(sizeMatch?.[1] ?? targetCount)

  const nodes: BenchTreeNode[] = []
  const set = new Set<string>()
  const queue: string[] = []

  for (const letter of ALPHABET) {
    if (nodes.length >= total) break
    nodes.push({ id: letter, parent_id: "ROOT" })
    set.add(letter)
    queue.push(letter)
  }

  while (nodes.length < total && queue.length) {
    const parent = queue.shift()!
    for (const letter of ALPHABET) {
      if (nodes.length >= total) break
      const id = `${parent}${letter}`
      nodes.push({ id, parent_id: parent })
      set.add(id)
      queue.push(id)
    }
  }

  return { nodes, set }
}

const ALPHABET = "abcdefghijklmnopqrst".split("")

function generateChain(total: number): { nodes: BenchTreeNode[]; set: Set<string> } {
  const nodes: BenchTreeNode[] = []
  const set = new Set<string>()
  if (total <= 0) return { nodes, set }

  const branches = [
    { prefix: "a", last: "a", count: 1 },
    { prefix: "b", last: "b", count: 1 },
  ]

  for (const branch of branches) {
    if (nodes.length >= total) break
    nodes.push({ id: branch.last, parent_id: "ROOT" })
    set.add(branch.last)
  }

  let toggle = 0
  while (nodes.length < total) {
    const branch = branches[toggle % branches.length]
    const nextId = `${branch.prefix}${branch.count}`
    nodes.push({ id: nextId, parent_id: branch.last })
    set.add(nextId)
    branch.last = nextId
    branch.count += 1
    toggle++
  }

  return { nodes, set }
}

function generateFanout(total: number): { nodes: BenchTreeNode[]; set: Set<string> } {
  const nodes: BenchTreeNode[] = []
  const set = new Set<string>()
  for (let i = 0; i < total; i++) {
    const id = `f${i}`
    nodes.push({ id, parent_id: "ROOT" })
    set.add(id)
  }

  // Add a shallow second level under the first node to allow non-root moves if needed.
  if (nodes.length && total > 1) {
    const parent = nodes[0].id
    const child = `${parent}-child`
    nodes.push({ id: child, parent_id: parent })
    set.add(child)
  }

  return { nodes, set }
}

function resetVirtualTree(nodes: BenchTreeNode[]) {
  for (const key of Object.keys(virtualTreeState)) {
    // biome-ignore lint/performance/noDelete: simple reset for bench mode
    delete (virtualTreeState as any)[key]
  }

  virtualTreeState.ROOT = { id: "ROOT", children: [], loading: false }

  for (const node of nodes) {
    if (!virtualTreeState[node.parent_id]) {
      virtualTreeState[node.parent_id] = { id: node.parent_id, children: [] }
    }
    virtualTreeState[node.id] = {
      id: node.id,
      parent_id: node.parent_id,
      children: [],
    }
  }

  for (const node of nodes) {
    const parent = virtualTreeState[node.parent_id]
    if (parent?.children && !parent.children.includes(node.id)) {
      parent.children.push(node.id)
    }
  }
}

function isDescendantOf(id: string, ancestor: string) {
  let current = id
  while (current && current !== "ROOT") {
    const parent = (virtualTreeState[current] as any)?.parent_id
    if (!parent) return false
    if (parent === ancestor) return true
    current = parent
  }
  return false
}

function isDescendantName(id: string, ancestor: string) {
  if (id === ancestor) return false
  return id.startsWith(ancestor)
}
