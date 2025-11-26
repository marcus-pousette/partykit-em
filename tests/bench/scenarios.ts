/// <reference path="./global.d.ts" />
import { expect, type Page } from "@playwright/test"

export type BenchScenario = {
  name: string
  description?: string
  group: string
  path: (roomId: string) => string
  prepare?: (page: Page, roomId: string) => Promise<void>
  run: (page: Page, roomId: string) => Promise<void>
  skip?: boolean
  expectedNodes?: number
}

type ModeName = "noop" | "local"

const modes: ModeName[] = ["noop", "local"]

const moveSubtreeSizes: Record<ModeName, Array<{ size: number; skip?: boolean }>> = {
  noop: [
    { size: 1000 },
    { size: 10000 },
    { size: 100000 },
    { size: 1000000, skip: true },
  ],
  local: [
    { size: 1000 },
    { size: 10000 },
    { size: 100000 },
  ],
}

const deepChainSizes: Record<ModeName, Array<{ size: number; minDepth?: number; skip?: boolean }>> =
  {
    noop: [
      { size: 1000, minDepth: 10 },
      { size: 10000, minDepth: 10 },
      { size: 100000, minDepth: 12 },
    ],
    local: [
      { size: 1000 },
      { size: 10000 },
      { size: 50000 },
      { size: 100000 },
    ],
  }

const fanoutSizes: Record<ModeName, Array<{ size: number; skip?: boolean }>> = {
  noop: [{ size: 10000 }],
  local: [{ size: 10000 }],
}

const insertChainSizes: Record<ModeName, Array<{ size: number }>> = {
  noop: [{ size: 10 }, { size: 100 }, { size: 1000 }],
  local: [{ size: 10 }, { size: 100 }, { size: 1000 }],
}

const bulkInsertBatchSizes: Record<ModeName, Array<{ size: number; skip?: boolean }>> = {
  noop: [{ size: 100 }, { size: 1000 }, { size: 10000 }],
  local: [{ size: 100 }, { size: 1000 }, { size: 10000 }],
}

const liveScenarios: BenchScenario[] = [
  {
    name: "live-insert-one-root-child",
    description: "Live: insert a single child under ROOT via the normal path",
    group: "live",
    path: (roomId) => `/${roomId}?live`,
    prepare: async (page) => {
      await waitForReady(page)
      await ensureRootVisible(page)
    },
    run: async (page) => {
      const root = page.getByTestId("tree-node-ROOT")
      await root.locator("span").first().click()

      const addButton = page.getByTestId("add-child-ROOT")
      await addButton.hover()

      const nodes = page.locator("[data-testid^='tree-node-']")
      const before = await nodes.count()

      await addButton.click()
      await expect(nodes).toHaveCount(before + 1)
    },
    skip: true
  },
]

const generatedScenarios: BenchScenario[] = modes
  .flatMap((mode) => {
    const scenarios: Array<BenchScenario | null> = []

    scenarios.push(createInsertOne(mode))
    scenarios.push(createMoveLeafSmall(mode))

    moveSubtreeSizes[mode].forEach(({ size, skip }) => {
      scenarios.push(createMoveSubtree(mode, size, { skip }))
    })

    deepChainSizes[mode].forEach(({ size, minDepth, skip }) => {
      scenarios.push(createDeepChain(mode, size, { minDepth, skip }))
    })

    fanoutSizes[mode].forEach(({ size, skip }) => {
      scenarios.push(createFanout(mode, size, { skip }))
    })

    if (mode === "local") {
      scenarios.push(createRootExpand(mode))
    }

    insertChainSizes[mode].forEach(({ size }) => {
      scenarios.push(createInsertChain(mode, size))
    })

    bulkInsertBatchSizes[mode].forEach(({ size, skip }) => {
      scenarios.push(createBulkInsert(mode, size, { skip }))
    })

    return scenarios
  })
  .filter((scenario): scenario is BenchScenario => Boolean(scenario))

export const benchScenarios: BenchScenario[] = [
  ...liveScenarios,
  ...generatedScenarios,
]

function createInsertOne(mode: ModeName): BenchScenario | null {
  if (mode !== "noop") return null
  const seedLabel = "empty"
  return {
    name: `${mode}-insert-one-root-child`,
    description: "Insert a single child under ROOT and wait for render",
    group: "insert",
    path: (roomId) => pathFor(mode, roomId, seedLabel),
    prepare: async (page) => {
      await seedEmpty(mode, page, seedLabel)
    },
    run: async (page) => {
      await ensureRootVisible(page)
      const root = page.getByTestId("tree-node-ROOT")
      await root.locator("span").first().click()

      const addButton = page.getByTestId("add-child-ROOT")
      await addButton.hover()

      const nodes = page.locator("[data-testid^='tree-node-']")
      const before = await nodes.count()

      await addButton.click()
      await expect(nodes).toHaveCount(before + 1)
    },
  }
}

function createMoveLeafSmall(mode: ModeName): BenchScenario | null {
  if (mode !== "noop") return null
  const seedLabel = "small"
  return {
    name: `${mode}-move-leaf-small-two-siblings`,
    description: "Move one leaf under the other in a tiny two-leaf tree",
    group: "move",
    path: (roomId) => pathFor(mode, roomId, seedLabel),
    prepare: async (page) => {
      await seedSmall(mode, page, seedLabel)
    },
    run: async (page) => {
      const root = page.getByTestId("tree-node-ROOT")
      await root.locator("span").first().click()

      await applyMoves(mode, page, [
        {
          type: "MOVE",
          node_id: "a",
          old_parent_id: "ROOT",
          new_parent_id: "b",
          client_id: "bench",
          timestamp: new Date().toISOString(),
        },
      ])

      const parent = await getParent(mode, page, "a")
      await expect(parent).toBe("b")
    },
  }
}

function createInsertChain(mode: ModeName, size: number): BenchScenario | null {
  // Always start from an empty tree; we only want to measure the insert cost.
  const seedLabel = mode === "noop" ? "empty" : undefined
  return {
    name: `${mode}-insert-chain-under-root-${size}`,
    description: `Insert ${size.toLocaleString()} nodes as a single chain under ROOT`,
    group: "insert",
    path: (roomId) => pathFor(mode, roomId, seedLabel),
    prepare: async (page) => {
      await seedEmpty(mode, page, seedLabel)
    },
    run: async (page) => {
      const movingId = "a"
      let parent = "ROOT"
      for (let i = 0; i < size; i++) {
        const childId = `${movingId}${i}`
        const move = {
          type: "MOVE",
          node_id: childId,
          old_parent_id: null,
          new_parent_id: parent,
          client_id: "bench",
          timestamp: new Date().toISOString(),
        }
        await applyMoves(mode, page, [move])
        parent = childId
      }

      const count = await getNodeCount(mode, page)
      await expect(count).toBeGreaterThanOrEqual(size)
    },
  }
}

function createBulkInsert(
  mode: ModeName,
  size: number,
  { skip }: { skip?: boolean } = {},
): BenchScenario {
  const seedLabel = mode === "noop" ? "empty" : undefined
  return {
    name: `${mode}-bulk-insert-root-siblings-single-batch-${size}`,
    description: `Insert ${size.toLocaleString()} new siblings directly under ROOT in one batch`,
    group: "insert",
    path: (roomId) => pathFor(mode, roomId, seedLabel),
    skip,
    prepare: async (page) => {
      await seedEmpty(mode, page, seedLabel)
    },
    run: async (page) => {
      const moves = Array.from({ length: size }).map((_, i) => ({
        type: "MOVE",
        node_id: `bulk${i}`,
        old_parent_id: null,
        new_parent_id: "ROOT",
        client_id: "bench",
        timestamp: new Date().toISOString(),
      }))

      await applyMoves(mode, page, moves)

      const count = await getNodeCount(mode, page)
      if (mode === "noop") {
        await expect(count).toBe(size)
      } else {
        const slack = 5
        await expect(count).toBeGreaterThanOrEqual(size)
        await expect(count).toBeLessThanOrEqual(size + slack)
      }
    },
  }
}

function createMoveSubtree(
  mode: ModeName,
  size: number,
  { skip }: { skip?: boolean } = {},
): BenchScenario {
  const seedLabel = mode === "noop" ? `large-${size}` : undefined
  return {
    name: `${mode}-move-subtree-root-child-into-peer-${size}`,
    description: `Move a ROOT child into a different subtree (${size.toLocaleString()} nodes)`,
    group: "move",
    path: (roomId) => pathFor(mode, roomId, seedLabel),
    skip,
    prepare: async (page) => {
      await seedBfs(mode, page, size, seedLabel)
    },
    run: async (page) => {
      const target = mode === "noop" ? await pickMoveTarget(mode, page, "a") : "b"

      await applyMoves(mode, page, [
        {
          type: "MOVE",
          node_id: "a",
          old_parent_id: "ROOT",
          new_parent_id: target,
          client_id: "bench",
          timestamp: new Date().toISOString(),
        },
      ])

      const parent = await getParent(mode, page, "a")
      await expect(parent).toBe(target)
    },
  }
}

function createDeepChain(
  mode: ModeName,
  size: number,
  { minDepth, skip }: { minDepth?: number; skip?: boolean } = {},
): BenchScenario {
  const seedLabel = mode === "noop" ? `chain-${size}` : undefined
  const baseName =
    mode === "noop"
      ? `move-root-child-into-deep-chain`
      : `move-root-child-into-deep-chain`
  return {
    name: `${mode}-${baseName}-${size}`,
    description:
      mode === "noop"
        ? `Move root child into a deep descendant (${size.toLocaleString()} chain)`
        : `${mode === "local" ? "Local-only" : "Server"}: move root child into a deep descendant (${size.toLocaleString()} chain)`,
    group: "deep",
    path: (roomId) => pathFor(mode, roomId, seedLabel),
    skip,
    prepare: async (page) => {
      await seedChain(mode, page, size, seedLabel)
    },
    run: async (page) => {
      const movingId = mode === "noop" ? "a" : "a0"
      const target =
        mode === "noop"
          ? await pickDeepTarget(mode, page, movingId, minDepth ?? 10)
          : `b${Math.max(1, Math.floor(size / 2))}`

      await applyMoves(mode, page, [
        {
          type: "MOVE",
          node_id: movingId,
          old_parent_id: "ROOT",
          new_parent_id: target,
          client_id: "bench",
          timestamp: new Date().toISOString(),
        },
      ])

      const parent = await getParent(mode, page, movingId)
      await expect(parent).toBe(target)
    },
  }
}

function createFanout(
  mode: ModeName,
  size: number,
  { skip }: { skip?: boolean } = {},
): BenchScenario {
  const seedLabel = mode === "noop" ? `fanout-${size}` : undefined
  const target = "f1"
  const movingId = "f0"
  return {
    name: `${mode}-move-fanout-root-child-into-sibling-${size}`,
    description: `Move a root child into a sibling within a ${size.toLocaleString()} fan-out under ROOT`,
    group: "fanout",
    path: (roomId) => pathFor(mode, roomId, seedLabel),
    skip,
    prepare: async (page) => {
      await seedFanout(mode, page, size, seedLabel)
    },
    run: async (page) => {
      await applyMoves(mode, page, [
        {
          type: "MOVE",
          node_id: movingId,
          old_parent_id: "ROOT",
          new_parent_id: target,
          client_id: "bench",
          timestamp: new Date().toISOString(),
        },
      ])

      const parent = await getParent(mode, page, movingId)
      await expect(parent).toBe(target)
    },
  }
}

function createRootExpand(mode: ModeName): BenchScenario | null {
  if (mode !== "local") return null

  return {
    name: `${mode}-expand-root-after-bfs-20`,
    description: "Local-only: seed a small tree and verify ROOT can be expanded to show children",
    group: "expand",
    path: (roomId) => pathFor(mode, roomId),
    prepare: async (page) => {
      await seedBfs(mode, page, 20)
    },
    run: async (page) => {
      await page.reload({ waitUntil: "domcontentloaded" })

      await seedBfs(mode, page, 20)
      await ensureRootVisible(page)

      const root = page.getByTestId("tree-node-ROOT")
      await root.locator("span").first().click()

      const child = page.getByTestId("tree-node-a")
      await expect(child).toBeVisible()

      const nodes = page.locator("[data-testid^='tree-node-']")
      await expect(await nodes.count()).toBeGreaterThan(1)
    },
  }
}

function pathFor(mode: ModeName, roomId: string, seedLabel?: string) {
  return mode === "noop"
    ? `/${roomId}?live&noop=${seedLabel ?? "default"}`
    : `/${roomId}?live&local-only`
}

async function seedEmpty(mode: ModeName, page: Page, seedLabel?: string) {
  if (mode === "noop") {
    await seedNoop(page, seedLabel ?? "empty")
    await expectNodeCount(mode, page, 0)
  } else if (mode === "local") {
    const seeded = await seedLocal(page, { size: 0, shape: "bfs" })
    await expectNodeCount(mode, page, seeded ?? 0)
  }
  await ensureRootVisible(page)
}

async function seedSmall(mode: ModeName, page: Page, seedLabel?: string) {
  if (mode === "noop") {
    await seedNoop(page, seedLabel ?? "small")
    await expectNodeCount(mode, page, 2)
    await ensureRootVisible(page)
  } else if (mode === "local") {
    const seeded = await seedLocal(page, { size: 2, shape: "bfs" })
    await expectNodeCount(mode, page, seeded ?? 2)
  }
}

async function seedBfs(
  mode: ModeName,
  page: Page,
  size: number,
  seedLabel?: string,
) {
  if (mode === "noop") {
    await seedNoop(page, seedLabel ?? `large-${size}`)
    await expectNodeCount(mode, page, size)
    await ensureRootVisible(page)
  } else if (mode === "local") {
    const seeded = await seedLocal(page, { size, shape: "bfs" })
    await expectNodeCount(mode, page, seeded ?? size)
  }
}

async function seedChain(
  mode: ModeName,
  page: Page,
  size: number,
  seedLabel?: string,
) {
  if (mode === "noop") {
    await seedNoop(page, seedLabel ?? `chain-${size}`)
    await expectNodeCount(mode, page, size)
  } else if (mode === "local") {
    const seeded = await seedLocal(page, { size, shape: "chain" })
    await expectNodeCount(mode, page, seeded ?? size)
  }
}

async function seedFanout(
  mode: ModeName,
  page: Page,
  size: number,
  seedLabel?: string,
) {
  if (mode === "noop") {
    await seedNoop(page, seedLabel ?? `fanout-${size}`)
    await expectNodeCount(mode, page, size + 1)
    await ensureRootVisible(page)
  } else if (mode === "local") {
    const seeded = await seedLocal(page, { size, shape: "fanout" })
    await expectNodeCount(mode, page, seeded ?? size)
  }
}

async function seedNoop(page: Page, seedMode: string) {
  await waitForBench(page)
  await page.evaluate((mode) => {
    window.__bench?.seed?.(mode)
    window.__bench?.applyMoves?.([])
  }, seedMode)
}

async function seedLocal(
  page: Page,
  options: { size: number; shape?: "bfs" | "chain" | "fanout" },
) {
  await waitForLocal(page)
  return page.evaluate((opts) => window.__local?.seed?.(opts), options)
}

async function applyMoves(
  mode: ModeName,
  page: Page,
  moves: Array<Record<string, any>>,
) {
  if (mode === "noop") {
    await page.evaluate((payload) => {
      window.__bench?.applyMoves?.(payload)
    }, moves)
    return
  }

  if (mode === "local") {
    await page.evaluate(async (payload) => {
      await window.__local?.applyMoves?.(payload)
    }, moves)
    return
  }
}

async function getParent(mode: ModeName, page: Page, nodeId: string) {
  if (mode === "noop") {
    return page.evaluate((id) => window.__bench?.getParent?.(id) ?? null, nodeId)
  }

  if (mode === "local") {
    return page.evaluate((id) => window.__local?.getParent?.(id) ?? null, nodeId)
  }
  return null
}

async function pickMoveTarget(mode: ModeName, page: Page, movingId: string) {
  if (mode === "noop") {
    return page.evaluate(
      (id) => window.__bench?.pickMoveTarget?.(id) ?? "b",
      movingId,
    )
  }
  return "b"
}

async function pickDeepTarget(
  mode: ModeName,
  page: Page,
  movingId: string,
  minDepth: number,
) {
  if (mode === "noop") {
    return page.evaluate(
      ([id, depth]) => window.__bench?.pickDeepTarget?.(id, depth) ?? "b",
      [movingId, minDepth],
    )
  }
  return `b${Math.max(1, minDepth)}`
}

async function expectNodeCount(mode: ModeName, page: Page, expected: number) {
  const count = await getNodeCount(mode, page)
  if (mode === "noop") {
    await expect(count).toBe(expected)
  } else {
    await expect(count).toBeGreaterThanOrEqual(expected)
    await expect(count).toBeLessThanOrEqual(expected + 2)
  }
  return count
}

async function getNodeCount(mode: ModeName, page: Page) {
  if (mode === "noop") {
    return page.evaluate(() => window.__bench?.getNodeCount?.() ?? 0)
  }
  if (mode === "local") {
    return page.evaluate(() => window.__local?.getNodeCount?.() ?? 0)
  }
  return 0
}

function ensureRootVisible(page: Page) {
  return page.getByTestId("tree-node-ROOT").waitFor({ state: "visible" })
}

async function waitForReady(page: Page) {
  const status = page.getByTestId("status-text")
  await status.waitFor({ state: "visible" })
  await expect(status).not.toContainText(/BOOTING|ERROR/i, { timeout: 20_000 })
}

function waitForLocal(page: Page) {
  return page.waitForFunction(() => Boolean((window as any).__local?.seed))
}

function waitForBench(page: Page) {
  return page.waitForFunction(() => Boolean((window as any).__bench?.seed))
}
