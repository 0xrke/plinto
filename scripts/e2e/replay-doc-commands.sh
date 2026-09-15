#!/usr/bin/env bash
# Replays the C2 mainnet command list of docs/research/surfpool-e2e.md (the ```bash blocks between
# <!-- c2-commands:begin --> and <!-- c2-commands:end -->) against a FRESH LOCAL Surfpool mainnet fork,
# to prove the commands the user approves work exactly as written.
#
#   bash scripts/e2e/replay-doc-commands.sh [--restart] [--keep]
#
# Differences from a mainnet run, and nothing else:
#   - MAINNET_RPC_URL is forced to http://127.0.0.1:8899 (checked to be a fresh surfnet first);
#   - `solana program deploy` gets --use-rpc appended (a surfnet has no TPU port);
#   - the demo wallets are funded with cheatcodes (SOL airdrop, SPYx balance patch) instead of by the user;
#   - C2_DIR points into the run directory and TOKEN_URI is a placeholder.
# The SDK CLI runs with --allow-mainnet and STOCKFLOOR_ALLOW_MAINNET=1 exactly as documented; the
# override only ever sees the loopback URL above.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
DOC="docs/research/surfpool-e2e.md"

RESTART=0
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=1 ;;
    --keep) KEEP=1 ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

export RPC_PORT=8899
LOCAL_RPC="http://127.0.0.1:${RPC_PORT}"
export E2E_RPC_URL="$LOCAL_RPC"
TSX="$ROOT/packages/sdk/node_modules/.bin/tsx"
e2e() { "$TSX" "$ROOT/scripts/e2e/$1.ts" "${@:2}"; }

INSTANCE_DIR="$ROOT/.surfpool/rpc-${RPC_PORT}"
if curl -s --max-time 2 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$LOCAL_RPC" 2>/dev/null | grep -q '"result"'; then
  if [[ "$RESTART" == "1" ]]; then
    bash scripts/surfpool/stop.sh
  else
    echo "a surfnet is already running on $LOCAL_RPC; use --restart" >&2
    exit 1
  fi
fi

STARTED=0
cleanup() {
  local code=$?
  if [[ "$STARTED" == "1" && "$KEEP" != "1" ]]; then bash "$ROOT/scripts/surfpool/stop.sh" || true; fi
  [[ $code -eq 0 ]] || echo "replay FAILED (exit $code)" >&2
  exit $code
}
trap cleanup EXIT

bash scripts/surfpool/start.sh
STARTED=1

RUN_DIR="$INSTANCE_DIR/e2e/replay-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RUN_DIR"
export E2E_RUN_DIR="$RUN_DIR"

e2e setup check-fresh
e2e setup mainnet-rent
e2e setup token-programs

# Extract the documented command blocks.
awk '/<!-- c2-commands:begin -->/{f=1;next} /<!-- c2-commands:end -->/{f=0} f' "$DOC" |
  awk '/^```bash$/{f=1;next} /^```$/{f=0} f' >"$RUN_DIR/c2-commands.sh"
[[ -s "$RUN_DIR/c2-commands.sh" ]] || { echo "no command blocks found in $DOC" >&2; exit 1; }
grep -q "solana program deploy" "$RUN_DIR/c2-commands.sh" || { echo "deploy command missing from $DOC" >&2; exit 1; }
echo "extracted $(wc -l <"$RUN_DIR/c2-commands.sh" | tr -d ' ') lines of commands from $DOC"

# Fund the demo wallets like the user would, with 10% SPYx headroom over the plan (cheatcodes).
e2e plan pre-launch --threshold-usd 50 --rpc "$LOCAL_RPC" >"$RUN_DIR/funding-plan.env"
# shellcheck disable=SC1091
source "$RUN_DIR/funding-plan.env"
with_margin() { node -e 'console.log((BigInt(process.argv[1]) * 110n / 100n).toString())' "$1"; }
e2e setup fund keys/cli-creator.json --sol 1 --spyx-raw "$(with_margin "$CREATOR_SPYX_RAW")"
e2e setup fund keys/cli-buyer1.json --sol 1 --spyx-raw "$(with_margin "$BUYER1_SPYX_RAW")"
e2e setup fund keys/cli-buyer2.json --sol 1 --spyx-raw "$(with_margin "$BUYER2_SPYX_RAW")"
e2e setup fund keys/cli-cranker.json --sol 1

cat >"$RUN_DIR/replay.sh" <<EOF
set -euo pipefail
set -x
export MAINNET_RPC_URL="$LOCAL_RPC"
export C2_DIR="$RUN_DIR/c2"
export TOKEN_URI="https://raw.githubusercontent.com/stockfloor/stockfloor/main/app/public/demo/sfdemo.json"
solana() {
  if [[ "\${1:-} \${2:-}" == "program deploy" ]]; then command solana "\$@" --use-rpc; else command solana "\$@"; fi
}
cd "$ROOT"
source "$RUN_DIR/c2-commands.sh"
EOF
bash "$RUN_DIR/replay.sh" 2>&1 | tee "$RUN_DIR/replay.log"

# The documented sequence must end redeemable, with every quote exact, and nothing on mainnet.
FINAL_JSON="$(awk '/^\{$/{buf=""; f=1} f{buf=buf $0 "\n"} /^\}$/{f=0; last=buf} END{printf "%s", last}' "$RUN_DIR/replay.log")"
node -e '
  const s = JSON.parse(process.argv[1]);
  if (s.phase !== "redeemable" || s.floorViewMatchesState !== true) { console.error("final status not redeemable/consistent", s.phase, s.floorViewMatchesState); process.exit(1); }
  console.log(`final status: phase ${s.phase}, vault ${s.vaultRaw} raw, supply ${s.baseSupplyRaw}, floor view = state`);
' "$FINAL_JSON"
EXACT_FALSE=$(grep -c '"exact": false' "$RUN_DIR/replay.log" || true)
EXACT_TRUE=$(grep -c '"exact": true' "$RUN_DIR/replay.log" || true)
[[ "$EXACT_FALSE" == "0" && "$EXACT_TRUE" -ge 6 ]] || { echo "exact checks: $EXACT_TRUE true, $EXACT_FALSE false" >&2; exit 1; }
echo "quotes exact: $EXACT_TRUE"
e2e setup relay-check
echo "replay OK: ${RUN_DIR#"$ROOT"/}/replay.log"
