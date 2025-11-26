#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.devlogs"
PID_DIR="$ROOT_DIR/.devpids"
DEV_PORT="${DEV_PORT:-5823}"

mkdir -p "$LOG_DIR" "$PID_DIR"

start_service() {
  local name="$1"
  shift
  local cmd="$*"
  local log_file="$LOG_DIR/${name}.log"
  local pid_file="$PID_DIR/${name}.pid"

  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "$name already running (pid $(cat "$pid_file"))."
    return
  fi

  echo "Starting $name -> $cmd"
  nohup bash -lc "$cmd" >"$log_file" 2>&1 &
  echo $! >"$pid_file"
  echo "$name started (pid $(cat "$pid_file")), logs: $log_file"
}

start_service client "yarn client:dev --host --port ${DEV_PORT}"
start_service partykit "yarn partykit:dev"
start_service sync "yarn server:dev"
