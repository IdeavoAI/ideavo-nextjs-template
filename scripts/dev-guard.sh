#!/usr/bin/env bash
# Runs `next dev` and restarts it if the server tree exceeds a memory ceiling.
# Restart is ~1.2s and the browser HMR client reconnects on its own, so this is
# far cheaper than letting the sandbox OOM.
set -m  # job control: the dev server gets its own process group

PORT="${PORT:-4000}"
LIMIT_MB="${DEV_MEM_LIMIT_MB:-1500}"
INTERVAL="${DEV_MEM_INTERVAL:-10}"

pid=""
# Don't orphan the dev server if the guard itself is killed.
cleanup() { [ -n "$pid" ] && kill -TERM -"$pid" 2>/dev/null; exit 0; }
trap cleanup INT TERM EXIT

while :; do
  bun run dev --port "$PORT" &
  pid=$!

  while kill -0 "$pid" 2>/dev/null; do
    sleep "$INTERVAL"
    # Sum RSS across the whole process group: bun -> next dev -> next-server -> loader workers
    mb=$(ps -eo rss=,pgid= | awk -v g="$pid" '$2==g {s+=$1} END {printf "%d", s/1024}')
    if [ "${mb:-0}" -gt "$LIMIT_MB" ]; then
      echo "[dev-guard] ${mb}MB > ${LIMIT_MB}MB ceiling - restarting dev server"
      kill -TERM -"$pid" 2>/dev/null
      sleep 3
      kill -KILL -"$pid" 2>/dev/null
      break
    fi
  done

  wait "$pid" 2>/dev/null
  sleep 1
done
