import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const exec = promisify(execFile)

const dataDir =
  process.env.PGDATA ?? path.join(os.homedir(), ".local", "var", "postgres")
const logFile = path.join(dataDir, "server.log")
const pgPort = process.env.PGPORT ?? "5432"
const markerFile = path.join(os.tmpdir(), "partykit-em-db-started")

const withBin = (cmd: string) =>
  process.env.PG_BIN ? path.join(process.env.PG_BIN, cmd) : cmd

function missingPgBinaryMessage(cmd: string) {
  return [
    `Postgres binary "${cmd}" not found.`,
    `Install Postgres or point PG_BIN to your Postgres bin directory.`,
    `Examples:`,
    `  brew install postgresql@15`,
    `  PG_BIN=/opt/homebrew/opt/postgresql@15/bin yarn dev:up`,
  ].join("\n")
}

async function isReady() {
  try {
    await exec(withBin("pg_isready"), ["-h", "localhost", "-p", pgPort])
    return true
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(missingPgBinaryMessage("pg_isready"))
    }
    return false
  }
}

/**
 * Ensures the database is running. Returns true if we started it.
 */
export async function ensureDbRunning() {
/*   if (await isReady()) return false
  try {
    await exec(withBin("pg_ctl"), ["-w", "-D", dataDir, "-l", logFile, "start"])
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(missingPgBinaryMessage("pg_ctl"))
    }
    throw error
  }
  await fs.writeFile(markerFile, "started")
  return true */
}

/**
 * Stops the database only if we started it in this test run.
 */
export async function stopDbIfStarted() {
  try {
    await fs.access(markerFile)
  } catch {
    return
  }

  try {
    await exec(withBin("pg_ctl"), ["-w", "-D", dataDir, "stop"])
  } finally {
    await fs.rm(markerFile, { force: true })
  }
}
