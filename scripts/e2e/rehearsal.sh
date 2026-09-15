#!/usr/bin/env bash
# C2 rehearsal: the exact mainnet demo sequence, run against a FRESH LOCAL Surfpool mainnet fork
# (127.0.0.1:8899 / ws 8900). Nothing is sent to mainnet: every sending command targets the loopback
# surfnet, and the SDK CLI send guard only allows it because it is a Surfpool surfnet.
#
#   bash scripts/e2e/rehearsal.sh [--restart] [--keep]
#
#   --restart   stop a surfnet already running on 8899 first (default: refuse to reuse it)
#   --keep      leave the surfnet running at the end (default: stop it)
#
# Environment (defaults = the C2 plan):
#   THRESHOLD_USD=50           migration threshold of the demo launch (USD, converted at the live Jupiter price)
#   PRIORITY_FEE=100000        micro-lamports per CU for every transaction (deploy writes included)
#   MAX_LEN=<ELF + 10%>        programdata max length for the deploy (bytes, KiB-rounded)
#   SWEEP_THRESHOLDS="25 100"  extra create-launch-only validation launches (USD), "" to skip
#   WITH_UPGRADE=1             measure an upgrade with the same ELF at the end (validation, not part of C2)
#   SAVE_REPORT=0              1 = copy report.{md,json} to scripts/e2e/reports/<run id>.*
#   DEPLOYER_KEY=keys/deployer.json CREATOR_KEY=keys/cli-creator.json BUYER1_KEY=keys/cli-buyer1.json
#   BUYER2_KEY=keys/cli-buyer2.json CRANKER_KEY=keys/cli-cranker.json
#   BUFFER_KEY=keys/stockfloor-deploy-buffer.json (created if missing; lets a failed deploy resume)
#   TOKEN_NAME="StockFloor Demo" TOKEN_SYMBOL=SFDEMO TOKEN_URI=<placeholder of realistic length>
#   MAINNET_READ_RPC_URL       read-only mainnet endpoint for rent / relay checks (default public RPC)
#
# Output: .surfpool/rpc-8899/e2e/<run id>/ (ledger.json, per-step logs, launch.json, report.json,
# report.md). Summary tables and the C2 funding requirement: docs/research/surfpool-e2e.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

RESTART=0
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=1 ;;
    --keep) KEEP=1 ;;
    -h | --help)
      sed -n '2,26p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

export RPC_PORT=8899
RPC="http://127.0.0.1:${RPC_PORT}"
export E2E_RPC_URL="$RPC"

THRESHOLD_USD="${THRESHOLD_USD:-50}"
PRIORITY_FEE="${PRIORITY_FEE:-100000}"
SWEEP_THRESHOLDS="${SWEEP_THRESHOLDS-25 100}"
WITH_UPGRADE="${WITH_UPGRADE:-1}"
SAVE_REPORT="${SAVE_REPORT:-0}"
DEPLOYER_KEY="${DEPLOYER_KEY:-keys/deployer.json}"
CREATOR_KEY="${CREATOR_KEY:-keys/cli-creator.json}"
BUYER1_KEY="${BUYER1_KEY:-keys/cli-buyer1.json}"
BUYER2_KEY="${BUYER2_KEY:-keys/cli-buyer2.json}"
CRANKER_KEY="${CRANKER_KEY:-keys/cli-cranker.json}"
PROGRAM_KEY="keys/stockfloor-program.json"
SO="target/deploy/stockfloor.so"
BUFFER_KEY="${BUFFER_KEY:-keys/stockfloor-deploy-buffer.json}"
TOKEN_NAME="${TOKEN_NAME:-StockFloor Demo}"
TOKEN_SYMBOL="${TOKEN_SYMBOL:-SFDEMO}"
TOKEN_URI="${TOKEN_URI:-https://raw.githubusercontent.com/stockfloor/stockfloor/main/app/public/demo/sfdemo.json}"

TSX="$ROOT/packages/sdk/node_modules/.bin/tsx"
SDK_CLI=(bash "$ROOT/packages/sdk/scripts/run.sh")
for tool in solana surfpool curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool not found" >&2; exit 1; }
done
[[ -x "$TSX" ]] || { echo "tsx not found at $TSX (pnpm install)" >&2; exit 1; }
[[ -f "$SO" ]] || { echo "$SO not found (bash scripts/build-programs.sh -p stockfloor)" >&2; exit 1; }
for k in "$DEPLOYER_KEY" "$CREATOR_KEY" "$BUYER1_KEY" "$BUYER2_KEY" "$CRANKER_KEY" "$PROGRAM_KEY"; do
  case "$k" in keys/*) ;; *) echo "refusing keypair outside keys/: $k" >&2; exit 1 ;; esac
  [[ -f "$k" ]] || { echo "keypair not found: $k" >&2; exit 1; }
done

case "$BUFFER_KEY" in keys/*) ;; *) echo "refusing buffer keypair outside keys/: $BUFFER_KEY" >&2; exit 1 ;; esac
if [[ ! -f "$BUFFER_KEY" ]]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile "$BUFFER_KEY" >/dev/null
  echo "created deploy buffer keypair $BUFFER_KEY"
fi

ELF_BYTES=$(wc -c <"$SO" | tr -d ' ')
MAX_LEN="${MAX_LEN:-$(( ( (ELF_BYTES * 110 / 100) + 1023 ) / 1024 * 1024 ))}"
(( MAX_LEN >= ELF_BYTES )) || { echo "MAX_LEN $MAX_LEN < ELF size $ELF_BYTES" >&2; exit 1; }

e2e() { "$TSX" "$ROOT/scripts/e2e/$1.ts" "${@:2}"; }

# ---------------------------------------------------------------- fresh surfnet
INSTANCE_DIR="$ROOT/.surfpool/rpc-${RPC_PORT}"
running() { curl -s --max-time 2 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" 2>/dev/null | grep -q '"result"'; }
if running || { [[ -f "$INSTANCE_DIR/surfpool.pid" ]] && kill -0 "$(cat "$INSTANCE_DIR/surfpool.pid")" 2>/dev/null; }; then
  if [[ "$RESTART" == "1" ]]; then
    bash scripts/surfpool/stop.sh
  else
    echo "a surfnet is already running on $RPC; the rehearsal needs a fresh one (use --restart)" >&2
    exit 1
  fi
fi

STARTED=0
cleanup() {
  local code=$?
  if [[ "$STARTED" == "1" && "$KEEP" != "1" ]]; then
    bash "$ROOT/scripts/surfpool/stop.sh" || true
  fi
  if [[ $code -ne 0 ]]; then
    echo "rehearsal FAILED (exit $code); logs in ${RUN_DIR:-.surfpool}" >&2
  fi
  exit $code
}
trap cleanup EXIT

bash scripts/surfpool/start.sh
STARTED=1

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$INSTANCE_DIR/e2e/$RUN_ID"
mkdir -p "$RUN_DIR"
export E2E_RUN_DIR="$RUN_DIR"
echo "run dir: ${RUN_DIR#"$ROOT"/}"

DEPLOYER_PK="$(e2e setup pubkey "$DEPLOYER_KEY")"
CREATOR_PK="$(e2e setup pubkey "$CREATOR_KEY")"
BUYER1_PK="$(e2e setup pubkey "$BUYER1_KEY")"
BUYER2_PK="$(e2e setup pubkey "$BUYER2_KEY")"
CRANKER_PK="$(e2e setup pubkey "$CRANKER_KEY")"

cat >"$RUN_DIR/params.env" <<EOF
THRESHOLD_USD=$THRESHOLD_USD
PRIORITY_FEE=$PRIORITY_FEE
MAX_LEN=$MAX_LEN
ELF_BYTES=$ELF_BYTES
ELF_SHA256=$(shasum -a 256 "$SO" | cut -d' ' -f1)
SWEEP_THRESHOLDS="$SWEEP_THRESHOLDS"
TOKEN_NAME="$TOKEN_NAME"
TOKEN_SYMBOL=$TOKEN_SYMBOL
TOKEN_URI=$TOKEN_URI
DEPLOYER=$DEPLOYER_PK
CREATOR=$CREATOR_PK
BUYER1=$BUYER1_PK
BUYER2=$BUYER2_PK
CRANKER=$CRANKER_PK
EOF

e2e ledger init --roles "deployer=$DEPLOYER_KEY,creator=$CREATOR_KEY,buyer1=$BUYER1_KEY,buyer2=$BUYER2_KEY,cranker=$CRANKER_KEY"

STEP_NO=0
# step <name> <category> <command...>: runs the command under the ledger, output in <run dir>/NN-<name>.log
step() {
  local name="$1" category="$2"
  shift 2
  STEP_NO=$((STEP_NO + 1))
  local log
  log="$RUN_DIR/$(printf '%02d' "$STEP_NO")-${name}.log"
  echo
  echo "== [$STEP_NO] $name ($category)"
  echo "\$ ${*#"$ROOT"/}"
  e2e ledger begin "$name" --category "$category" --command "$*"
  "$@" 2>&1 | tee "$log"
  e2e ledger end "$name" --log "$log" ${LEDGER_END_EXTRA:-}
}

# ---------------------------------------------------------------- 1. surfnet = mainnet state + mainnet rent
step surfnet-prepare setup bash -c "set -e; '$TSX' scripts/e2e/setup.ts check-fresh; '$TSX' scripts/e2e/setup.ts mainnet-rent; '$TSX' scripts/e2e/setup.ts token-programs"

# ---------------------------------------------------------------- 2. deploy (real BPF upgradeable loader transactions)
# Throwaway Solana CLI config: no user config or wallet is ever read.
CLI_CONFIG="$RUN_DIR/solana-cli.yml"
printf 'json_rpc_url: "%s"\nwebsocket_url: ""\nkeypair_path: "%s"\naddress_labels: {}\ncommitment: confirmed\n' "$RPC" "$ROOT/$DEPLOYER_KEY" >"$CLI_CONFIG"
step deploy-program mainnet solana program deploy --config "$CLI_CONFIG" --url "$RPC" \
  --keypair "$DEPLOYER_KEY" --fee-payer "$DEPLOYER_KEY" --upgrade-authority "$DEPLOYER_KEY" \
  --program-id "$PROGRAM_KEY" --buffer "$BUFFER_KEY" --max-len "$MAX_LEN" \
  --with-compute-unit-price "$PRIORITY_FEE" --use-rpc --commitment confirmed "$SO"
step program-show readonly solana program show --config "$CLI_CONFIG" --url "$RPC" 98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA

# (No IDL upload here: `anchor idl init` refuses loopback clusters with "Skipping IDL initialization on
# localnet", so the optional Program Metadata IDL account cannot be rehearsed locally.)

# ---------------------------------------------------------------- 3. plan + fund the demo wallets (cheatcodes)
e2e plan pre-launch --threshold-usd "$THRESHOLD_USD" --rpc "$RPC" | tee "$RUN_DIR/plan.env"
# shellcheck disable=SC1091
source "$RUN_DIR/plan.env"
step fund-wallets setup bash -c "set -e
  '$TSX' scripts/e2e/setup.ts fund '$CREATOR_KEY' --sol 1 --spyx-raw '$CREATOR_SPYX_RAW'
  '$TSX' scripts/e2e/setup.ts fund '$BUYER1_KEY' --sol 1 --spyx-raw '$BUYER1_SPYX_RAW'
  '$TSX' scripts/e2e/setup.ts fund '$BUYER2_KEY' --sol 1 --spyx-raw '$BUYER2_SPYX_RAW'
  '$TSX' scripts/e2e/setup.ts fund '$CRANKER_KEY' --sol 1"

# ---------------------------------------------------------------- 4. launch + presale
LEDGER_END_EXTRA="--launch-file $RUN_DIR/launch.json" step create-launch mainnet "${SDK_CLI[@]}" create-launch \
  --rpc "$RPC" --keypair "$CREATOR_KEY" --name "$TOKEN_NAME" --symbol "$TOKEN_SYMBOL" --uri "$TOKEN_URI" \
  --quote SPYx --preset gentle --vault-share 50 --threshold-usd "$THRESHOLD_USD" --exit-fee-bps 200 \
  --price-usd "$PRICE_USD" --first-buy "$FIRST_BUY_UNITS" --slippage-bps 100 --priority-fee "$PRIORITY_FEE" \
  --out "$RUN_DIR/launch.json"
LAUNCH="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).addresses.launch)' "$RUN_DIR/launch.json")"
BASE_MINT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).addresses.baseMint)' "$RUN_DIR/launch.json")"
echo "launch $LAUNCH, base mint $BASE_MINT"
step status-presale readonly "${SDK_CLI[@]}" status --rpc "$RPC" --launch "$LAUNCH" --price-usd "$PRICE_USD"

step buyer1-buy mainnet "${SDK_CLI[@]}" buy --rpc "$RPC" --keypair "$BUYER1_KEY" --launch "$LAUNCH" \
  --raw "$BUYER1_BUY_RAW" --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
e2e plan completing-buy --launch "$LAUNCH" --offer-raw "$BUYER2_OFFER_RAW" --rpc "$RPC" | tee -a "$RUN_DIR/plan.env"
step buyer2-completing-buy mainnet "${SDK_CLI[@]}" buy --rpc "$RPC" --keypair "$BUYER2_KEY" --launch "$LAUNCH" \
  --raw "$BUYER2_OFFER_RAW" --slippage-bps 100 --priority-fee "$PRIORITY_FEE"

# ---------------------------------------------------------------- 5. graduation crank
step crank-dry-run readonly "${SDK_CLI[@]}" crank --rpc "$RPC" --keypair "$CRANKER_KEY" --launch "$LAUNCH" --dry-run
step crank-graduate mainnet "${SDK_CLI[@]}" crank --rpc "$RPC" --keypair "$CRANKER_KEY" --launch "$LAUNCH" \
  --priority-fee "$PRIORITY_FEE" --json
step status-graduated readonly "${SDK_CLI[@]}" status --rpc "$RPC" --launch "$LAUNCH" --price-usd "$PRICE_USD"

# ---------------------------------------------------------------- 6. DAMM v2 market, LP fees
e2e plan post-migration --launch "$LAUNCH" --buyer1 "$BUYER1_PK" --buyer2 "$BUYER2_PK" --rpc "$RPC" | tee "$RUN_DIR/plan-post.env"
# shellcheck disable=SC1091
source "$RUN_DIR/plan-post.env"
step buyer1-damm-buy mainnet "${SDK_CLI[@]}" buy --rpc "$RPC" --keypair "$BUYER1_KEY" --launch "$LAUNCH" \
  --raw "$BUYER1_DAMM_RAW" --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
step buyer2-damm-sell mainnet "${SDK_CLI[@]}" sell --rpc "$RPC" --keypair "$BUYER2_KEY" --launch "$LAUNCH" \
  --raw "$BUYER2_SELL_RAW" --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
step crank-lp-fees mainnet "${SDK_CLI[@]}" crank --rpc "$RPC" --keypair "$CRANKER_KEY" --launch "$LAUNCH" \
  --priority-fee "$PRIORITY_FEE" --json

# ---------------------------------------------------------------- 7. redemptions, final status
e2e plan post-migration --launch "$LAUNCH" --buyer1 "$BUYER1_PK" --buyer2 "$BUYER2_PK" --rpc "$RPC" | tee "$RUN_DIR/plan-redeem.env"
# shellcheck disable=SC1091
source "$RUN_DIR/plan-redeem.env"
step buyer1-redeem mainnet "${SDK_CLI[@]}" redeem --rpc "$RPC" --keypair "$BUYER1_KEY" --launch "$LAUNCH" \
  --raw "$BUYER1_REDEEM_RAW" --priority-fee "$PRIORITY_FEE"
step buyer2-redeem-all mainnet "${SDK_CLI[@]}" redeem --rpc "$RPC" --keypair "$BUYER2_KEY" --launch "$LAUNCH" \
  --all --priority-fee "$PRIORITY_FEE"
step status-final readonly "${SDK_CLI[@]}" status --rpc "$RPC" --launch "$LAUNCH" --price-usd "$PRICE_USD"

# ---------------------------------------------------------------- 8. threshold validation sweep (not part of C2)
for usd in $SWEEP_THRESHOLDS; do
  step "validate-threshold-${usd}usd" validation "${SDK_CLI[@]}" create-launch --rpc "$RPC" --keypair "$CREATOR_KEY" \
    --name "Threshold ${usd}" --symbol "T${usd}" --uri "$TOKEN_URI" --quote SPYx --preset gentle --vault-share 50 \
    --threshold-usd "$usd" --exit-fee-bps 200 --price-usd "$PRICE_USD" --priority-fee "$PRIORITY_FEE" \
    --out "$RUN_DIR/launch-${usd}usd.json"
done

# ---------------------------------------------------------------- 9. upgrade cost (not part of C2): same ELF again
if [[ "$WITH_UPGRADE" == "1" ]]; then
  step validate-upgrade validation solana program deploy --config "$CLI_CONFIG" --url "$RPC" \
    --keypair "$DEPLOYER_KEY" --fee-payer "$DEPLOYER_KEY" --upgrade-authority "$DEPLOYER_KEY" \
    --program-id "$PROGRAM_KEY" --buffer "$BUFFER_KEY" --with-compute-unit-price "$PRIORITY_FEE" \
    --use-rpc --commitment confirmed "$SO"
fi

# ---------------------------------------------------------------- 10. report (read-only mainnet checks)
e2e setup check-rent
if [[ "$SAVE_REPORT" == "1" ]]; then
  e2e report --launch "$LAUNCH" --save
else
  e2e report --launch "$LAUNCH"
fi
echo
echo "rehearsal OK: ${RUN_DIR#"$ROOT"/}/report.md"
