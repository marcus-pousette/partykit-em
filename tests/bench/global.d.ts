import type { BenchHooks } from "../../src/app/lib/bench-hooks"

declare global {
  interface Window {
    __bench?: BenchHooks
    __local?: {
      seed: (opts: { size: number; shape?: "bfs" | "chain" | "fanout" }) => Promise<number | void>
      applyMoves: (moves: any[]) => Promise<void>
      getParent: (id: string) => Promise<string | null>
      getNodeCount: () => Promise<number>
    }
  }
}

export {}
