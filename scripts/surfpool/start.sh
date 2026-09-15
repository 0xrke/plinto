#!/usr/bin/env bash
# Start a LOCAL Surfpool surfnet that lazily forks mainnet state, in the background.
#
#   bash scripts/surfpool/start.sh            # RPC 127.0.0.1:8899, WS 8900, studio/HTTP 18488
#   RPC_PORT=9899 bash scripts/surfpool/start.sh   # second instance: WS 9900, studio 19488
#   bash scripts/surfpool/start.sh --offline  # no datasource at all (nothing is fetched)
#
# Surfpool executes every transaction in its own in-process LiteSVM. The datasource RPC is only
# used for reads (accounts, epoch info, blocks); see docs/research/surfpool.md for the source
# evidence that nothing is relayed to the datasource network.
#
# Environment (all optional):
#   RPC_PORT          JSON-RPC port (default 8899)
#   WS_PORT           WebSocket port (default RPC_PORT + 1)
#   STUDIO_PORT       Studio / scenario HTTP port; Surfpool binds it even with --no-studio
#                     (default 18488 + (RPC_PORT - 8899))
#   INSTANCE          state directory name under .surfpool/ (default "rpc-<RPC_PORT>")
#   MAINNET_RPC_URL   datasource RPC (read-only use); default: --network mainnet
#                     (https://api.mainnet-beta.solana.com)
#   AIRDROP_KEYPAIR   repo keypair that receives the startup airdrop (default keys/deployer.json).
#                     Always passed explicitly: without -k Surfpool reads ~/.config/solana/id.json.
#   AIRDROP_LAMPORTS  startup airdrop (default 1000 SOL)
#   SLOT_TIME_MS      slot time (default 400)
#   STUDIO            1 = serve the Studio UI on STUDIO_PORT (default 0)
#   READY_TIMEOUT     seconds to wait for getHealth/getVersion (default 90)
#   LOG_LEVEL         Surfpool simnet log level (default info)
#   SURFPOOL_BIN      Surfpool binary (default: surfpool on PATH)
#   SURFPOOL_EXTRA_ARGS  extra arguments appended to `surfpool start` (word-split)
#
# Outputs in .surfpool/<INSTANCE>/: surfpool.pid, surfpool.log (stdout/stderr), logs/ (simnet
# logs), env (RPC_URL / WS_URL / pid, sourceable). Stop with scripts/surfpool/stop.sh.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

OFFLINE=0
for arg in "$@"; do
  case "$arg" in
    --offline) OFFLINE=1 ;;
    -h | --help)
      sed -n '2,31p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

is_port() { [[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 > 0 && 10#$1 < 65536)); }

RPC_PORT="${RPC_PORT:-8899}"
is_port "$RPC_PORT" || { echo "invalid RPC_PORT: $RPC_PORT" >&2; exit 2; }
OFFSET=$((RPC_PORT - 8899))
WS_PORT="${WS_PORT:-$((RPC_PORT + 1))}"
STUDIO_PORT="${STUDIO_PORT:-$((18488 + OFFSET))}"
is_port "$WS_PORT" || { echo "invalid WS_PORT: $WS_PORT" >&2; exit 2; }
is_port "$STUDIO_PORT" || { echo "invalid STUDIO_PORT: $STUDIO_PORT" >&2; exit 2; }
INSTANCE="${INSTANCE:-rpc-${RPC_PORT}}"
[[ "$INSTANCE" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid INSTANCE: $INSTANCE" >&2; exit 2; }
HOST=127.0.0.1
SURFPOOL_BIN="${SURFPOOL_BIN:-surfpool}"
AIRDROP_KEYPAIR="${AIRDROP_KEYPAIR:-keys/deployer.json}"
AIRDROP_LAMPORTS="${AIRDROP_LAMPORTS:-1000000000000}"
SLOT_TIME_MS="${SLOT_TIME_MS:-400}"
STUDIO="${STUDIO:-0}"
READY_TIMEOUT="${READY_TIMEOUT:-90}"
LOG_LEVEL="${LOG_LEVEL:-info}"

STATE_DIR="$ROOT/.surfpool/$INSTANCE"
PID_FILE="$STATE_DIR/surfpool.pid"
LOG_FILE="$STATE_DIR/surfpool.log"
ENV_FILE="$STATE_DIR/env"
RPC_URL="http://${HOST}:${RPC_PORT}"
WS_URL="ws://${HOST}:${WS_PORT}"

command -v "$SURFPOOL_BIN" >/dev/null 2>&1 || {
  echo "surfpool not found (SURFPOOL_BIN=$SURFPOOL_BIN)" >&2
  exit 1
}
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

# The airdrop keypair must be a repo keypair under keys/ (never a user wallet).
case "$AIRDROP_KEYPAIR" in
  /*) AIRDROP_KEYPAIR_ABS="$AIRDROP_KEYPAIR" ;;
  *) AIRDROP_KEYPAIR_ABS="$ROOT/$AIRDROP_KEYPAIR" ;;
esac
if [[ ! -f "$AIRDROP_KEYPAIR_ABS" ]]; then
  echo "airdrop keypair not found: $AIRDROP_KEYPAIR_ABS" >&2
  exit 1
fi
AIRDROP_KEYPAIR_ABS="$(cd "$(dirname "$AIRDROP_KEYPAIR_ABS")" && pwd)/$(basename "$AIRDROP_KEYPAIR_ABS")"
case "$AIRDROP_KEYPAIR_ABS" in
  "$ROOT"/keys/*) ;;
  *)
    echo "refusing airdrop keypair outside $ROOT/keys/: $AIRDROP_KEYPAIR_ABS" >&2
    exit 1
    ;;
esac

rpc() {
  # rpc <method> [params-json] -> prints the JSON response (empty on connection failure)
  curl -s --max-time 3 -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-[]}}" "$RPC_URL" 2>/dev/null
}

is_surfpool_pid() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= 2>/dev/null | grep -q "surfpool"
}

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if is_surfpool_pid "$OLD_PID"; then
    if rpc getHealth | grep -q '"result"'; then
      echo "surfnet '$INSTANCE' already running (pid $OLD_PID) at $RPC_URL"
      exit 0
    fi
    echo "surfnet '$INSTANCE' has a live pid $OLD_PID but $RPC_URL is not healthy; run stop.sh first" >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/${HOST}/$1") 2>/dev/null
  fi
}
for p in "$RPC_PORT" "$WS_PORT" "$STUDIO_PORT"; do
  if port_in_use "$p"; then
    echo "port $p is already in use; pick another RPC_PORT / WS_PORT / STUDIO_PORT" >&2
    exit 1
  fi
done

ARGS=(start --no-tui --no-deploy --yes
  --host "$HOST" --port "$RPC_PORT" --ws-port "$WS_PORT" --studio-port "$STUDIO_PORT"
  --airdrop-keypair-path "$AIRDROP_KEYPAIR_ABS" --airdrop-amount "$AIRDROP_LAMPORTS"
  --slot-time "$SLOT_TIME_MS" --log-level "$LOG_LEVEL" --log-path "$STATE_DIR/logs"
  --surfnet-id "$INSTANCE")
[[ "$STUDIO" == "1" ]] || ARGS+=(--no-studio)

DATASOURCE_LABEL="offline"
if [[ "$OFFLINE" == "1" ]]; then
  ARGS+=(--offline)
elif [[ -n "${MAINNET_RPC_URL:-}" ]]; then
  ARGS+=(--rpc-url "$MAINNET_RPC_URL")
  # never print an API key embedded in the URL
  DATASOURCE_LABEL="$(printf '%s' "$MAINNET_RPC_URL" | sed -E 's#^([a-z]+://[^/?]+).*#\1#')/… (MAINNET_RPC_URL)"
else
  ARGS+=(--network mainnet)
  DATASOURCE_LABEL="https://api.mainnet-beta.solana.com (--network mainnet)"
fi
if [[ -n "${SURFPOOL_EXTRA_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  EXTRA=(${SURFPOOL_EXTRA_ARGS})
  ARGS+=("${EXTRA[@]}")
fi

mkdir -p "$STATE_DIR/logs"
: >"$LOG_FILE"

# Run from the state directory so Surfpool never picks up Anchor.toml / txtx.yml from the repo
# root. Clear Surfpool env overrides so only the flags above apply.
(
  cd "$STATE_DIR" || exit 1
  unset SURFPOOL_DATASOURCE_RPC_URL SURFPOOL_PUBLIC_HOST SURFPOOL_PUBLIC_RPC_URL \
    SURFPOOL_PUBLIC_WS_URL SURFPOOL_PUBLIC_STUDIO_URL
  exec nohup "$SURFPOOL_BIN" "${ARGS[@]}" </dev/null >>"$LOG_FILE" 2>&1
) &
PID=$!
echo "$PID" >"$PID_FILE"

echo "starting surfnet '$INSTANCE' (pid $PID)"
echo "  datasource: $DATASOURCE_LABEL"
echo "  rpc: $RPC_URL  ws: $WS_URL  studio/http port: $STUDIO_PORT"
echo "  log: ${LOG_FILE#"$ROOT"/}"

START=$SECONDS
READY=0
while ((SECONDS - START < READY_TIMEOUT)); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "surfpool exited during startup; last log lines:" >&2
    tail -n 40 "$LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
  if rpc getHealth | grep -q '"result":"ok"' && rpc getVersion | grep -q '"solana-core"'; then
    # In fork mode also wait for the simnet to report its datasource (printed after its Ready event).
    if [[ "$OFFLINE" == "1" ]] || grep -q "Datasource connection successful" "$LOG_FILE" 2>/dev/null; then
      READY=1
      break
    fi
  fi
  sleep 0.5
done

if [[ "$READY" != "1" ]]; then
  echo "surfnet not ready after ${READY_TIMEOUT}s; stopping it. Last log lines:" >&2
  tail -n 40 "$LOG_FILE" >&2
  kill -INT "$PID" 2>/dev/null
  sleep 2
  kill -KILL "$PID" 2>/dev/null
  rm -f "$PID_FILE"
  exit 1
fi

VERSION_JSON="$(rpc getVersion)"
SLOT_JSON="$(rpc getSlot)"
cat >"$ENV_FILE" <<EOF
SURFPOOL_INSTANCE=$INSTANCE
SURFPOOL_PID=$PID
SURFPOOL_RPC_URL=$RPC_URL
SURFPOOL_WS_URL=$WS_URL
SURFPOOL_STUDIO_PORT=$STUDIO_PORT
EOF

echo "ready in $((SECONDS - START))s"
echo "  getVersion: $VERSION_JSON"
echo "  getSlot:    $SLOT_JSON"
echo "  env file:   ${ENV_FILE#"$ROOT"/}"
