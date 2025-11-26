#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/.stackpids"

stop_service() {
  local name="$1"
  local pid_file="$PID_DIR/${name}.pid"

  if [ ! -f "$pid_file" ]; then
    echo "$name not running (no pid file)."
    return
  fi

  local pid
  pid="$(cat "$pid_file")"

  if kill -0 "$pid" 2>/dev/null; then
    echo "Stopping $name (pid $pid)..."
    kill "$pid" 2>/dev/null || true
  else
    echo "$name pid file exists but process not running."
  fi

  rm -f "$pid_file"
}

stop_service client
stop_service partykit
stop_service server

for port in ${DEV_PORT:-5823} ${PK_PORT:-1999} ${SYNC_PORT:-3123}; do
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Warning: port $port still has a listener after stack:down."
  fi
done
