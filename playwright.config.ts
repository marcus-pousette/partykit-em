import { defineConfig, devices } from "@playwright/test"

const devServerUrl = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5823"
const devServerCommand =
  process.env.PLAYWRIGHT_DEV_COMMAND ||
  "yarn client:dev --host --port 5823"

// Allow turning off heavy artifacts during benchmarking runs.
const artifactsOff = process.env.BENCH_ARTIFACTS === "0"
const traceMode = artifactsOff ? "off" : ("on-first-retry" as const)
const screenshotMode = artifactsOff ? "off" : ("only-on-failure" as const)
const videoMode = artifactsOff ? "off" : ("retain-on-failure" as const)

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  globalTeardown: "./tests/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: {
    timeout: 10_000,
  },
  reporter: "list",
  use: {
    baseURL: devServerUrl,
    trace: traceMode,
    screenshot: screenshotMode,
    video: videoMode,
    env: {
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    },
    launchOptions: {
      args: ["--no-proxy-server"],
    },
  },
  webServer: {
    command: devServerCommand,
    url: devServerUrl,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
