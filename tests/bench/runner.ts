/// <reference path="./global.d.ts" />
import type { Page, TestInfo } from "@playwright/test"
import type { BenchScenario } from "./scenarios"

const roomPrefix = process.env.BENCH_ROOM_PREFIX || "bench"

async function clearOriginStorage(page: Page) {
  // Ensure we are on the app origin before clearing storage.
  await page.goto("/", { waitUntil: "domcontentloaded" })

  await page.evaluate(async () => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch (e) {
      console.warn("Storage clear warning:", e)
    }

    // Best-effort IndexedDB cleanup.
    try {
      const databases = await (indexedDB as any).databases?.()
      if (databases?.length) {
        await Promise.all(
          databases
            .map((db: any) => db?.name)
            .filter(Boolean)
            .map(
              (name: string) =>
                new Promise<void>((resolve) => {
                  const req = indexedDB.deleteDatabase(name)
                  req.onsuccess = req.onerror = req.onblocked = () => resolve()
                }),
            ),
        )
      }
    } catch (e) {
      console.warn("IndexedDB clear warning:", e)
    }

    // Best-effort OPFS cleanup.
    try {
      // @ts-ignore navigator.storage.getDirectory is supported in this environment
      const root: any = await navigator.storage.getDirectory?.()
      if (root?.removeEntry) {
        for await (const [name] of root.entries()) {
          await root.removeEntry(name, { recursive: true })
        }
      }
    } catch (e) {
      console.warn("OPFS clear warning:", e)
    }
  })
}

function setupOpenV2FailFast(page: Page) {
  let triggered = false
  let rejectFn: (err: Error) => void = () => {}

  const waitForFailure = new Promise<never>((_, reject) => {
    rejectFn = reject
  })

  const checkText = (text?: string | null) => {
    if (!text) return
    const lower = text.toLowerCase()
    if (lower.includes("sqlite3_open_v2") || lower.includes("sqliteerror")) {
      if (triggered) return
      triggered = true
      rejectFn(
        new Error(
          `Fail-fast: sqlite open error observed: ${text}`,
        ),
      )
    }
  }

  const consoleListener = (msg: any) => {
    // Console messages from workers bubble here.
    const text = msg?.text?.()
    checkText(text)
  }

  const pageErrorListener = (err: Error) => {
    // Unhandled errors (including worker errors) surface here.
    checkText(err?.message)
  }

  page.on("console", consoleListener)
  page.on("pageerror", pageErrorListener)

  const detach = () => {
    page.off("console", consoleListener)
    page.off("pageerror", pageErrorListener)
  }

  return { waitForFailure, detach }
}

export const runScenario = async (
  page: Page,
  info: TestInfo,
  scenario: BenchScenario
) => {
  const rawId = `${roomPrefix}-${scenario.name}-${Date.now()}`
  const roomId = rawId.replace(/[^a-z0-9_]/gi, "_").toLowerCase()

  // Start each scenario from a clean origin (localStorage/IndexedDB/OPFS).
  await clearOriginStorage(page)

  // Fail fast if the worker cannot open the OPFS-backed database.
  const { waitForFailure, detach } = setupOpenV2FailFast(page)

  const work = (async () => {
    await page.goto(scenario.path(roomId))
    await scenario.prepare?.(page, roomId)

    const start = performance.now()
    await scenario.run(page, roomId)
    const durationMs = performance.now() - start

    info.annotations.push({
      type: "perf",
      description: `${scenario.name} ${durationMs.toFixed(2)}ms`,
    })

    return { roomId, durationMs }
  })()

  try {
    return await Promise.race([work, waitForFailure])
  } finally {
    detach()
  }
}
