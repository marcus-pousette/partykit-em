/// <reference path="./global.d.ts" />
import { test } from "@playwright/test"
import fs from "node:fs/promises"
import path from "node:path"
import { runScenario } from "./runner"
import { benchScenarios } from "./scenarios"

// Collect per-scenario timings and emit a markdown table once the suite finishes.
const results: Array<{ name: string; durationMs: number }> = []

const groupFilter = (process.env.BENCH_GROUP || "")
  .split(",")
  .map((g) => g.trim())
  .filter(Boolean)

const activeScenarios = benchScenarios.filter(
  (s) => !s.skip && (groupFilter.length === 0 || groupFilter.includes(s.group)),
)

for (const scenario of activeScenarios) {
  test(`bench: ${scenario.name}`, async ({ page }, testInfo) => {
    const { durationMs, roomId } = await runScenario(page, testInfo, scenario)
    results.push({ name: scenario.name, durationMs })
    console.log(
      `[bench] ${scenario.name} ${durationMs.toFixed(
        2
      )}ms room=${roomId}`
    )
  })
}

test.afterAll(async () => {
  if (!results.length) {
    console.log("[bench] no scenarios matched filter")
    return
  }
  const outDir = path.join(process.cwd(), "test-results")
  await fs.mkdir(outDir, { recursive: true })
  const outFile = path.join(outDir, "bench-results.md")

  const lines = [
    "| Scenario | Time (ms) |",
    "| --- | --- |",
    ...results.map((r) => `| ${r.name} | ${r.durationMs.toFixed(2)} |`),
  ]

  await fs.writeFile(outFile, `${lines.join("\n")}\n`, "utf8")
  // Also surface the location in logs for quick discovery.
  console.log(`[bench] wrote results to ${outFile}`)
})
