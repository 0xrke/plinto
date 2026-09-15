#!/usr/bin/env bash
# Stop a surfnet started by scripts/surfpool/start.sh.
#
#   bash scripts/surfpool/stop.sh              # instance for RPC_PORT (default 8899)
#   RPC_PORT=9899 bash scripts/surfpool/stop.sh
#   INSTANCE=rpc-9899 bash scripts/surfpool/stop.sh
#   bash scripts/surfpool/stop.sh --all        # every instance under .surfpool/
#
# Sends SIGINT (Surfpool's graceful shutdown), then SIGTERM, then SIGKILL. Only signals a pid
# whose command line is a surfpool process. Logs in .surfpool/<instance>/ are kept.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

ALL=0
for arg in "$@"; do
  case "$arg" in
    --all) ALL=1 ;;
    -h | --help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

is_surfpool_pid() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= 2>/dev/null | grep -q "surfpool"
}

stop_instance() {
  local dir="$1" name pid_file pid
  name="$(basename "$dir")"
  pid_file="$dir/surfpool.pid"
  if [[ ! -f "$pid_file" ]]; then
    echo "surfnet '$name': not running (no pid file)"
    return 0
  fi
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if ! is_surfpool_pid "$pid"; then
    echo "surfnet '$name': stale pid file (pid ${pid:-?} is not a surfpool process); removed"
    rm -f "$pid_file"
    return 0
  fi
  local sig waited
  for sig in INT TERM KILL; do
    kill -"$sig" "$pid" 2>/dev/null
    waited=0
    while kill -0 "$pid" 2>/dev/null && ((waited < 50)); do
      sleep 0.2
      waited=$((waited + 1))
    done
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "surfnet '$name': stopped pid $pid (SIG$sig)"
      rm -f "$pid_file"
      return 0
    fi
  done
  echo "surfnet '$name': pid $pid did not exit" >&2
  return 1
}

if [[ "$ALL" == "1" ]]; then
  status=0
  found=0
  for d in "$ROOT"/.surfpool/*/; do
    [[ -f "${d}surfpool.pid" ]] || continue
    found=1
    stop_instance "${d%/}" || status=1
  done
  [[ "$found" == "1" ]] || echo "no surfnet pid files under .surfpool/"
  exit $status
fi

RPC_PORT="${RPC_PORT:-8899}"
INSTANCE="${INSTANCE:-rpc-${RPC_PORT}}"
[[ "$INSTANCE" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid INSTANCE: $INSTANCE" >&2; exit 2; }
stop_instance "$ROOT/.surfpool/$INSTANCE"
