#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="/tmp/partykit-em"
PID_DIR="$ROOT_DIR/.stackpids"
DEV_PORT="${DEV_PORT:-5823}"
SYNC_PORT="${SYNC_PORT:-3123}"
PK_PORT="${PK_PORT:-1999}"

mkdir -p "$LOG_DIR" "$PID_DIR"

check_port() {
  local port="$1"
  local name="$2"
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "$name port $port already in use; aborting stack:up."
    exit 1
  fi
}

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

check_port "$DEV_PORT" "client"
check_port "$PK_PORT" "partykit"
check_port "$SYNC_PORT" "sync server"

start_service client "yarn client:dev --host --port ${DEV_PORT}"
start_service partykit "PORT=${PK_PORT} yarn partykit:dev --port ${PK_PORT}"
start_service server "PORT=${SYNC_PORT} yarn server:dev"
