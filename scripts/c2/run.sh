#!/usr/bin/env bash
# The C2 sequence, end to end: deploy -> create-launch (threshold $50) -> presale buys -> graduation
# crank -> DAMM v2 trade -> LP-fee crank -> redemptions -> final status.
#
#   bash scripts/c2/run.sh                                  # DRY RUN (default): the identical
#                                                           # sequence on a fresh local Surfpool fork
#   bash scripts/c2/run.sh --mainnet --allow-mainnet        # the real run (see the gate below)
#   bash scripts/c2/run.sh --resume latest [--mainnet --allow-mainnet]
#
# The dry run and the mainnet run execute the same commands, in the same order, with the same
# amounts; only the RPC (and the funding source) differ. Read docs/c2-runbook.md before --mainnet.
#
# --mainnet refuses to start unless ALL of these hold:
#   1. `scripts/c2/preflight.ts` returns the verdict GO for the mainnet RPC;
#   2. the approval marker file `keys/c2-approved` exists (the user creates it after saying yes);
#   3. `--mainnet` AND `--allow-mainnet` are passed AND `STOCKFLOOR_ALLOW_MAINNET=1` is exported
#      (the same two switches the SDK send guard requires);
#   4. `MAINNET_RPC_URL` and `TOKEN_URI` are set, and the RPC is not a loopback address.
#
# | Flag | Default | Meaning |
# |---|---|---|
# | `--mainnet` | off | Run against mainnet instead of a local fork |
# | `--allow-mainnet` | off | Second mainnet switch (with `STOCKFLOOR_ALLOW_MAINNET=1`) |
# | `--yes` | off | Skip the per-step confirmation prompts (unattended) |
# | `--confirm` | off | Ask for confirmation in the dry run too (rehearse the prompts) |
# | `--resume <id\|latest>` | — | Continue a previous run: skip the steps it completed |
# | `--from <step>` | — | Mark every step before `<step>` as skipped (manual recovery) |
# | `--threshold-usd <n>` | 50 | Migration threshold of the demo launch |
# | `--priority-fee <n>` | 100000 | Micro-lamports per compute unit on every transaction |
# | `--max-price-drift-pct <n>` | 5 | Abort if the quote price moved more than this since the plan |
# | `--skip-price-guard` | off | Do not abort when Jupiter is unreachable (still checks pause/hook) |
# | `--skip-program-hashes` | off | Preflight: skip the DBC / DAMM v2 binary comparison |
# | `--accept-program-drift` | off | Preflight: a Meteora binary upgrade warns instead of blocking |
# | `--use-rpc` | on for the dry run | `solana program deploy --use-rpc` instead of the TPU client |
# | `--rpc-port <n>` | 8899 | Dry run: the local surfnet port (the app agent uses 28899) |
# | `--reuse` / `--restart` / `--keep` | off | Dry run: reuse, restart or keep the local surfnet |
#
# Environment: MAINNET_RPC_URL (mainnet), TOKEN_URI (metadata JSON chosen by the user),
# TOKEN_NAME / TOKEN_SYMBOL, MAINNET_READ_RPC_URL (read-only mainnet endpoint for the dry run's
# rent and relay checks), STOCKFLOOR_ALLOW_MAINNET.
#
# Output: scripts/c2/reports/<run id>.md and .json (transaction log with Solscan links, rewritten
# after every step). Working files with the RPC URL stay in target/c2/<run id>/ (gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

MODE=dry
ALLOW_MAINNET=0
ASSUME_YES=0
CONFIRM_DRY=0
RESUME=""
FROM=""
THRESHOLD_USD="${THRESHOLD_USD:-50}"
PRIORITY_FEE="${PRIORITY_FEE:-100000}"
MAX_DRIFT_PCT=5
SKIP_PRICE_GUARD=0
PREFLIGHT_EXTRA=()
USE_RPC=""
RPC_PORT="${RPC_PORT:-8899}"
REUSE=0
RESTART=0
KEEP=0

TOKEN_NAME="${TOKEN_NAME:-StockFloor Demo}"
TOKEN_SYMBOL="${TOKEN_SYMBOL:-SFDEMO}"
TOKEN_URI="${TOKEN_URI:-}"
QUOTE=SPYx
SO=target/deploy/stockfloor.so
PROGRAM_ID=98NLryxegA9KLsED1TkSQdF2MDt6X8C7B1PmepJN6HpA
TSX="$ROOT/packages/sdk/node_modules/.bin/tsx"

die() {
  echo "error: $*" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mainnet) MODE=mainnet ;;
    --dry-run) MODE=dry ;;
    --allow-mainnet) ALLOW_MAINNET=1 ;;
    --yes | -y) ASSUME_YES=1 ;;
    --confirm) CONFIRM_DRY=1 ;;
    --resume) RESUME="${2:?--resume needs a run id or 'latest'}"; shift ;;
    --from) FROM="${2:?--from needs a step id}"; shift ;;
    --threshold-usd) THRESHOLD_USD="${2:?}"; shift ;;
    --priority-fee) PRIORITY_FEE="${2:?}"; shift ;;
    --max-price-drift-pct) MAX_DRIFT_PCT="${2:?}"; shift ;;
    --skip-price-guard) SKIP_PRICE_GUARD=1 ;;
    --skip-program-hashes) PREFLIGHT_EXTRA+=(--skip-program-hashes) ;;
    --accept-program-drift) PREFLIGHT_EXTRA+=(--accept-program-drift) ;;
    --use-rpc) USE_RPC=1 ;;
    --rpc-port) RPC_PORT="${2:?}"; shift ;;
    --reuse) REUSE=1 ;;
    --restart) RESTART=1 ;;
    --keep) KEEP=1 ;;
    -h | --help)
      sed -n '2,52p' "$0"
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

[[ -x "$TSX" ]] || die "tsx not found at $TSX (pnpm install)"
[[ -f "$SO" ]] || die "$SO not found (bash scripts/build-programs.sh -p stockfloor)"
for tool in solana node curl; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool not found"
done

# ---------------------------------------------------------------- mode gate
if [[ "$MODE" == "mainnet" ]]; then
  [[ "$ALLOW_MAINNET" == "1" ]] || die "--mainnet also needs --allow-mainnet (two switches, like the SDK guard)"
  [[ "${STOCKFLOOR_ALLOW_MAINNET:-}" == "1" ]] || die "export STOCKFLOOR_ALLOW_MAINNET=1 before a mainnet run"
  [[ -n "${MAINNET_RPC_URL:-}" ]] || die "MAINNET_RPC_URL must point at the mainnet RPC the user chose"
  RPC="$MAINNET_RPC_URL"
  case "$(node -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "$RPC")" in
    127.0.0.1 | localhost | ::1) die "--mainnet was given a loopback RPC: use the default dry run for local forks" ;;
  esac
  [[ -n "$TOKEN_URI" ]] || die "TOKEN_URI must point at the token metadata JSON the user hosts"
  [[ -f "$ROOT/keys/c2-approved" ]] || die "keys/c2-approved is missing: the user has not approved the C2 run (docs/c2-runbook.md)"
  export STOCKFLOOR_ALLOW_MAINNET=1
  [[ -n "$USE_RPC" ]] || USE_RPC=0
else
  RPC="http://127.0.0.1:${RPC_PORT}"
  TOKEN_URI="${TOKEN_URI:-https://raw.githubusercontent.com/stockfloor/stockfloor/main/app/public/demo/sfdemo.json}"
  # A dry run must never be able to send to mainnet: without the override the SDK guard accepts only
  # a loopback Surfpool surfnet.
  unset STOCKFLOOR_ALLOW_MAINNET
  [[ -n "$USE_RPC" ]] || USE_RPC=1
fi

# ---------------------------------------------------------------- run directory and state
mkdir -p "$ROOT/target/c2"
if [[ -n "$RESUME" ]]; then
  if [[ "$RESUME" == "latest" ]]; then
    RUN_ID="$(ls -1 "$ROOT/target/c2" 2>/dev/null | while read -r d; do [[ -f "$ROOT/target/c2/$d/state.env" ]] && echo "$d"; done | tail -1)"
    [[ -n "$RUN_ID" ]] || die "no previous run with state under target/c2/"
  else
    RUN_ID="$RESUME"
  fi
  RUN_DIR="$ROOT/target/c2/$RUN_ID"
  [[ -f "$RUN_DIR/state.env" ]] || die "no run state at $RUN_DIR/state.env"
  echo "resuming run $RUN_ID"
else
  RUN_ID="$([[ "$MODE" == "mainnet" ]] && echo "c2" || echo "dry")-$(date -u +%Y%m%dT%H%M%SZ)"
  RUN_DIR="$ROOT/target/c2/$RUN_ID"
  mkdir -p "$RUN_DIR"
  : >"$RUN_DIR/state.env"
fi
mkdir -p "$RUN_DIR/logs"
STATE="$RUN_DIR/state.env"
STEPS_TSV="$RUN_DIR/steps.tsv"
TXS_TSV="$RUN_DIR/txs.tsv"
ADDR_TSV="$RUN_DIR/addresses.tsv"
touch "$STEPS_TSV" "$TXS_TSV" "$ADDR_TSV"

state_set() {
  local key="$1" value="$2" tmp="$STATE.tmp"
  { grep -v "^${key}=" "$STATE" 2>/dev/null || true; } >"$tmp"
  echo "${key}=${value}" >>"$tmp"
  mv "$tmp" "$STATE"
}
state_get() {
  { sed -n "s/^$1=//p" "$STATE" 2>/dev/null || true; } | tail -1
}

sed_escape() { printf '%s' "$1" | sed -e 's/[\/&|]/\\&/g'; }
REDACT_SED="s|$(sed_escape "$RPC")|<rpc>|g"
redact() { printf '%s' "$*" | sed -e "$REDACT_SED"; }
RPC_DISPLAY="$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(u.pathname.replace(/\/+$/,"")!==""||u.search!==""?`${u.origin}/…`:u.origin)' "$RPC")"

ELF_BYTES=$(wc -c <"$SO" | tr -d ' ')
ELF_SHA=$(shasum -a 256 "$SO" | cut -d' ' -f1)
MAX_LEN="${MAX_LEN:-$(( ( (ELF_BYTES * 110 / 100) + 1023 ) / 1024 * 1024 ))}"

cat >"$RUN_DIR/meta.env" <<EOF
RUN_ID=$RUN_ID
MODE=$MODE
CLUSTER=$([[ "$MODE" == "mainnet" ]] && echo "solana mainnet-beta" || echo "local Surfpool mainnet fork (127.0.0.1:${RPC_PORT})")
RPC_DISPLAY=$RPC_DISPLAY
STARTED_AT=$(date -u +%FT%TZ)
PROGRAM_ID=$PROGRAM_ID
ELF_SHA=$ELF_SHA
ELF_BYTES=$ELF_BYTES
MAX_LEN=$MAX_LEN
THRESHOLD_USD=$THRESHOLD_USD
PRIORITY_FEE=$PRIORITY_FEE
QUOTE=$QUOTE
TOKEN_NAME=$TOKEN_NAME
TOKEN_SYMBOL=$TOKEN_SYMBOL
TOKEN_URI=$TOKEN_URI
EOF

report_now() { "$TSX" "$ROOT/scripts/c2/report.ts" --run-dir "$RUN_DIR" >/dev/null; }

print_recovery() {
  cat >&2 <<EOF

Recovery
  - state and logs: ${RUN_DIR#"$ROOT"/}/ (transaction log: scripts/c2/reports/${RUN_ID}.md)
  - resume this run after fixing the cause:
      bash scripts/c2/run.sh --resume $RUN_ID$([[ "$MODE" == "mainnet" ]] && echo " --mainnet --allow-mainnet")
  - per-stage abort and rollback notes: docs/c2-runbook.md
EOF
}

abort_run() {
  echo >&2
  echo "ABORT: $*" >&2
  state_set OUTCOME "aborted in step ${CURRENT_STEP:-<none>}: $*"
  state_set FINISHED_AT "$(date -u +%FT%TZ)"
  report_now || true
  print_recovery
  exit 1
}

SURFNET_STARTED=0
cleanup() {
  local code=$?
  if [[ "$SURFNET_STARTED" == "1" && "$KEEP" != "1" ]]; then
    RPC_PORT="$RPC_PORT" bash "$ROOT/scripts/surfpool/stop.sh" || true
  fi
  exit $code
}
trap cleanup EXIT

# ---------------------------------------------------------------- step plumbing
STEP_ORDER="deploy create-launch buy1 buy2 crank-graduate damm-buy damm-sell crank-lp redeem1 redeem2 status-final"
CURRENT_STEP=""
STEP_LOG=""
STEP_START=0
REACHED_FROM=0

step_title() {
  case "$1" in
    deploy) echo "Deploy the stockfloor program (480 BPF loader transactions, ~2.57 SOL of rent from the deployer)" ;;
    create-launch) echo "Create the launch: DBC config + Launch PDA + vault, then pool + register_pool + creator first buy (2 transactions, creator)" ;;
    buy1) echo "Presale buy: buyer1 takes 45% of the threshold on the DBC curve (1 transaction)" ;;
    buy2) echo "Completing presale buy: buyer2 offers 50% of the threshold (PartialFill completes the curve, 1 transaction)" ;;
    crank-graduate) echo "Graduation crank: harvest_curve_fees, harvest_migration_fee, harvest_surplus, migration_damm_v2, sync_migration (5 transactions, cranker)" ;;
    damm-buy) echo "Market buy on DAMM v2: buyer1 buys 5% of the threshold (1 transaction)" ;;
    damm-sell) echo "Market sell on DAMM v2: buyer2 sells 25% of its tokens (1 transaction)" ;;
    crank-lp) echo "LP-fee crank: harvest_lp_fees into the vault (1 transaction, cranker)" ;;
    redeem1) echo "Redeem: buyer1 burns 50% of its tokens for SPYx from the vault (1 transaction)" ;;
    redeem2) echo "Redeem: buyer2 burns all of its tokens for SPYx from the vault (1 transaction)" ;;
    status-final) echo "Final status (read-only)" ;;
  esac
}

confirm() {
  # 0 = go, 2 = skip this step; anything else aborts the run.
  local prompt="$1" answer=""
  if [[ "$ASSUME_YES" == "1" ]]; then
    echo "   (--yes) proceeding"
    return 0
  fi
  if [[ "$MODE" != "mainnet" && "$CONFIRM_DRY" != "1" ]]; then return 0; fi
  # The prompt reads the terminal directly, so it still works when the run is piped into a log.
  if ! exec 3<>/dev/tty 2>/dev/null; then
    abort_run "no terminal is available for the confirmation prompt (re-run with --yes)"
  fi
  printf '   %s [yes / skip / abort]: ' "$prompt" >&3
  read -r answer <&3 || answer=""
  exec 3>&-
  case "$answer" in
    yes | y | Y | YES) return 0 ;;
    skip | s) return 2 ;;
    *) abort_run "stopped by the operator at step $CURRENT_STEP" ;;
  esac
}

quote_guard() {
  local args=(quote-guard --rpc "$RPC" --quote "$QUOTE" --max-drift-pct "$MAX_DRIFT_PCT")
  if [[ "$SKIP_PRICE_GUARD" == "1" || -z "${PRICE_USD:-}" ]]; then
    args+=(--skip-price)
  else
    args+=(--baseline-price "$PRICE_USD")
  fi
  set +e
  "$TSX" "$ROOT/scripts/c2/checks.ts" "${args[@]}"
  local code=$?
  set -e
  case $code in
    0) ;;
    3) abort_run "the $QUOTE guard stopped the run before step $CURRENT_STEP" ;;
    *) abort_run "the $QUOTE guard could not run before step $CURRENT_STEP (exit $code)" ;;
  esac
}

phase_guard() {
  local expect="$1"
  [[ -n "${LAUNCH:-}" ]] || return 0
  set +e
  "$TSX" "$ROOT/scripts/c2/checks.ts" launch-phase --rpc "$RPC" --launch "$LAUNCH" --expect "$expect"
  local code=$?
  set -e
  case $code in
    0) ;;
    3) abort_run "unexpected launch state before step $CURRENT_STEP (expected phase: $expect)" ;;
    *) abort_run "the launch state check could not run before step $CURRENT_STEP (exit $code)" ;;
  esac
}

guards_for() {
  case "$1" in
    create-launch | buy1 | buy2 | damm-buy | damm-sell | redeem1 | redeem2) quote_guard ;;
  esac
  case "$1" in
    buy1 | buy2) phase_guard "presale" ;;
    crank-graduate) phase_guard "graduating,graduated,redeemable" ;;
    damm-buy | damm-sell | crank-lp) phase_guard "graduated,redeemable" ;;
    redeem1 | redeem2) phase_guard "redeemable" ;;
  esac
}

# step_begin <id>: 0 = run the step, 1 = skip it (already done, or --from).
step_begin() {
  local id="$1" done_state
  CURRENT_STEP="$id"
  done_state="$(state_get "STEP_${id}")"
  if [[ "$done_state" == "done" || "$done_state" == "skipped" ]]; then
    echo
    echo "== [$id] $done_state in an earlier pass — skipping"
    return 1
  fi
  if [[ -n "$FROM" && "$REACHED_FROM" == "0" ]]; then
    if [[ "$id" == "$FROM" ]]; then
      REACHED_FROM=1
    else
      echo
      echo "== [$id] skipped (--from $FROM)"
      state_set "STEP_${id}" skipped
      printf '%s\tskipped\t\t--from %s\n' "$id" "$FROM" >>"$STEPS_TSV"
      return 1
    fi
  fi
  echo
  echo "== [$id] $(step_title "$id")"
  guards_for "$id"
  set +e
  confirm "run step $id?"
  local code=$?
  set -e
  if [[ $code -eq 2 ]]; then
    state_set "STEP_${id}" skipped
    printf '%s\tskipped\t\toperator\n' "$id" >>"$STEPS_TSV"
    report_now
    return 1
  fi
  STEP_LOG="$RUN_DIR/logs/${id}.log"
  : >"$STEP_LOG"
  STEP_START=$SECONDS
  return 0
}

run_cmd() {
  echo "\$ $(redact "$*")" | tee -a "$STEP_LOG"
  set +e
  "$@" 2>&1 | sed -e "$REDACT_SED" | tee -a "$STEP_LOG"
  local code=${PIPESTATUS[0]}
  set -e
  return $code
}

collect_txs() {
  local id="$1"
  # Full base58 transaction signatures printed by the SDK CLI and the Solana CLI (85-88 characters;
  # addresses are at most 44, so there is no overlap).
  { grep -oE '[1-9A-HJ-NP-Za-km-z]{85,88}' "$STEP_LOG" 2>/dev/null || true; } | awk '!seen[$0]++' |
    while read -r sig; do
      grep -qF "$sig" "$TXS_TSV" 2>/dev/null || printf '%s\t%s\n' "$id" "$sig" >>"$TXS_TSV"
    done
}

step_end() {
  local id="$1" note="${2:-}"
  collect_txs "$id"
  state_set "STEP_${id}" done
  printf '%s\tdone\t%s\t%s\n' "$id" "$((SECONDS - STEP_START))" "$note" >>"$STEPS_TSV"
  report_now
}

add_address() {
  [[ -n "${2:-}" ]] || return 0
  { cut -f1 "$ADDR_TSV" 2>/dev/null || true; } | grep -qxF "$1" || printf '%s\t%s\n' "$1" "$2" >>"$ADDR_TSV"
}

sdk_cmd() {
  SDK_CMD=(bash "$ROOT/packages/sdk/scripts/run.sh" "$1" --rpc "$RPC")
  [[ "$MODE" == "mainnet" ]] && SDK_CMD+=(--allow-mainnet)
  shift
  SDK_CMD+=("$@")
}

json_field() {
  [[ -f "$1" ]] || return 0
  node -e 'try{const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")));process.stdout.write(v==null?"":String(v))}catch{}' "$1" "$2"
}

echo "StockFloor C2 run $RUN_ID"
echo "  mode        : $([[ "$MODE" == "mainnet" ]] && echo "MAINNET (real funds)" || echo "dry run on a local Surfpool mainnet fork")"
echo "  rpc         : $RPC_DISPLAY"
echo "  binary      : $SO ($ELF_BYTES bytes, sha256 $ELF_SHA), max-len $MAX_LEN"
echo "  threshold   : \$$THRESHOLD_USD in $QUOTE, priority fee $PRIORITY_FEE µlamports/CU"
echo "  token       : $TOKEN_NAME ($TOKEN_SYMBOL) $TOKEN_URI"
echo "  run dir     : ${RUN_DIR#"$ROOT"/}"
if [[ "$MODE" == "mainnet" ]]; then
  echo "  approval    : keys/c2-approved -> $(head -c 200 "$ROOT/keys/c2-approved" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------- 0. local fork (dry run only)
if [[ "$MODE" != "mainnet" ]]; then
  export RPC_PORT
  export E2E_RPC_URL="$RPC"
  running=0
  curl -s --max-time 2 -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC" 2>/dev/null | grep -q '"result"' && running=1
  if [[ "$running" == "1" && "$REUSE" != "1" ]]; then
    if [[ "$RESTART" == "1" ]]; then
      bash "$ROOT/scripts/surfpool/stop.sh"
      running=0
    else
      die "a surfnet is already running on $RPC; use --restart for a fresh one or --reuse to keep it"
    fi
  fi
  if [[ "$running" != "1" ]]; then
    bash "$ROOT/scripts/surfpool/start.sh"
    SURFNET_STARTED=1
    "$TSX" "$ROOT/scripts/e2e/setup.ts" check-fresh
  fi
  "$TSX" "$ROOT/scripts/e2e/setup.ts" mainnet-rent
  "$TSX" "$ROOT/scripts/e2e/setup.ts" token-programs
fi

# ---------------------------------------------------------------- 1. amounts from the live price
if [[ ! -s "$RUN_DIR/plan.env" ]]; then
  "$TSX" "$ROOT/scripts/e2e/plan.ts" pre-launch --threshold-usd "$THRESHOLD_USD" --quote "$QUOTE" --rpc "$RPC" |
    tee "$RUN_DIR/plan.env"
fi
# shellcheck disable=SC1091
source "$RUN_DIR/plan.env"
state_set PRICE_USD "$PRICE_USD"
grep -q "^PRICE_USD=" "$RUN_DIR/meta.env" || echo "PRICE_USD=$PRICE_USD" >>"$RUN_DIR/meta.env"

# ---------------------------------------------------------------- 2. fund the demo wallets (dry run)
if [[ "$MODE" != "mainnet" && "$(state_get FUNDED)" != "yes" ]]; then
  margin() { node -e 'console.log((BigInt(process.argv[1]) * 110n / 100n).toString())' "$1"; }
  "$TSX" "$ROOT/scripts/e2e/setup.ts" fund keys/cli-creator.json --sol 1 --spyx-raw "$(margin "$CREATOR_SPYX_RAW")"
  "$TSX" "$ROOT/scripts/e2e/setup.ts" fund keys/cli-buyer1.json --sol 1 --spyx-raw "$(margin "$BUYER1_SPYX_RAW")"
  "$TSX" "$ROOT/scripts/e2e/setup.ts" fund keys/cli-buyer2.json --sol 1 --spyx-raw "$(margin "$BUYER2_SPYX_RAW")"
  "$TSX" "$ROOT/scripts/e2e/setup.ts" fund keys/cli-cranker.json --sol 1
  state_set FUNDED yes
fi

# ---------------------------------------------------------------- 3. preflight (go / no-go)
echo
echo "== preflight"
set +e
"$TSX" "$ROOT/scripts/c2/preflight.ts" --rpc "$RPC" --threshold-usd "$THRESHOLD_USD" \
  --priority-fee "$PRIORITY_FEE" --quote "$QUOTE" --so "$SO" --max-len "$MAX_LEN" \
  --plan-file "$RUN_DIR/plan.env" --out "$RUN_DIR/preflight.json" "${PREFLIGHT_EXTRA[@]+"${PREFLIGHT_EXTRA[@]}"}" |
  sed -e "$REDACT_SED" | tee "$RUN_DIR/logs/preflight.log"
PREFLIGHT_CODE=${PIPESTATUS[0]}
set -e
PREFLIGHT_VERDICT="$(json_field "$RUN_DIR/preflight.json" verdict || true)"
PREFLIGHT_WARNINGS="$(json_field "$RUN_DIR/preflight.json" counts.warnings || true)"
state_set PREFLIGHT "$PREFLIGHT_VERDICT ($PREFLIGHT_WARNINGS warning(s))"
report_now
if [[ "$MODE" == "mainnet" ]]; then
  [[ "$PREFLIGHT_CODE" -eq 0 && "$PREFLIGHT_VERDICT" == "GO" ]] ||
    abort_run "preflight verdict is ${PREFLIGHT_VERDICT:-unknown}: fix the blockers above (nothing was sent)"
  if [[ "${PREFLIGHT_WARNINGS:-0}" != "0" ]]; then
    set +e
    confirm "preflight passed with $PREFLIGHT_WARNINGS warning(s); continue?"
    [[ $? -eq 0 ]] || abort_run "stopped after the preflight warnings"
    set -e
  fi
elif [[ "$PREFLIGHT_CODE" -ne 0 ]]; then
  echo "(dry run: preflight verdict $PREFLIGHT_VERDICT — continuing, the local fork is not mainnet)"
fi

LAUNCH="$(state_get LAUNCH)"

# ---------------------------------------------------------------- 4. deploy
if step_begin deploy; then
  set +e
  PROGRAM_STATE="$("$TSX" "$ROOT/scripts/c2/checks.ts" program-state --rpc "$RPC" --so "$SO" 2>&1)"
  PROGRAM_STATE_CODE=$?
  set -e
  echo "   program state: $PROGRAM_STATE"
  if [[ "$PROGRAM_STATE" == "match" ]]; then
    step_end deploy "already deployed with this binary"
  elif [[ "$PROGRAM_STATE" != "absent" || "$PROGRAM_STATE_CODE" -ne 0 ]]; then
    abort_run "the program id $PROGRAM_ID is occupied by a different binary: $PROGRAM_STATE"
  else
    printf 'json_rpc_url: "%s"\nwebsocket_url: ""\nkeypair_path: "%s"\naddress_labels: {}\ncommitment: confirmed\n' \
      "$RPC" "$ROOT/keys/deployer.json" >"$RUN_DIR/solana-cli.yml"
    chmod 600 "$RUN_DIR/solana-cli.yml"
    DEPLOY_CMD=(solana program deploy --config "$RUN_DIR/solana-cli.yml" --url "$RPC"
      --keypair keys/deployer.json --fee-payer keys/deployer.json --upgrade-authority keys/deployer.json
      --program-id keys/stockfloor-program.json --buffer keys/stockfloor-deploy-buffer.json
      --max-len "$MAX_LEN" --with-compute-unit-price "$PRIORITY_FEE" --commitment confirmed)
    [[ "$USE_RPC" == "1" ]] && DEPLOY_CMD+=(--use-rpc)
    DEPLOY_CMD+=("$SO")
    if [[ ! -f "$ROOT/keys/stockfloor-deploy-buffer.json" ]]; then
      solana-keygen new --no-bip39-passphrase --silent --outfile "$ROOT/keys/stockfloor-deploy-buffer.json" >/dev/null
      echo "   created the deploy buffer keypair keys/stockfloor-deploy-buffer.json"
    fi
    run_cmd "${DEPLOY_CMD[@]}" ||
      abort_run "the deploy failed. Re-running the same command resumes into the same buffer (keys/stockfloor-deploy-buffer.json); 'solana program show --buffers' and 'solana program close --buffers' recover stranded buffer rent."
    set +e
    AFTER="$("$TSX" "$ROOT/scripts/c2/checks.ts" program-state --rpc "$RPC" --so "$SO" 2>&1)"
    set -e
    [[ "$AFTER" == "match" ]] || abort_run "after the deploy the on-chain ELF does not match the local binary: $AFTER"
    echo "   verified: the deployed ELF matches $SO"
    add_address "stockfloor program" "$PROGRAM_ID"
    echo "DEPLOY_TX_COUNT=$(( (ELF_BYTES + 959) / 960 + 2 ))" >>"$RUN_DIR/meta.env"
    step_end deploy "deployed ELF verified"
  fi
fi

# ---------------------------------------------------------------- 5. create the launch
if step_begin create-launch; then
  SESSION=""
  [[ -f "$RUN_DIR/launch.json" ]] && SESSION="$(json_field "$RUN_DIR/launch.json" session)"
  if [[ -n "$SESSION" && -f "$SESSION" ]]; then
    echo "   resuming the launch session $SESSION"
    sdk_cmd create-launch --keypair keys/cli-creator.json --resume "$SESSION" \
      --priority-fee "$PRIORITY_FEE" --out "$RUN_DIR/launch.json"
  else
    sdk_cmd create-launch --keypair keys/cli-creator.json \
      --name "$TOKEN_NAME" --symbol "$TOKEN_SYMBOL" --uri "$TOKEN_URI" \
      --quote "$QUOTE" --preset gentle --vault-share 50 --threshold-usd "$THRESHOLD_USD" \
      --exit-fee-bps 200 --price-usd "$PRICE_USD" --first-buy "$FIRST_BUY_UNITS" \
      --slippage-bps 100 --priority-fee "$PRIORITY_FEE" --out "$RUN_DIR/launch.json"
  fi
  run_cmd "${SDK_CMD[@]}" ||
    abort_run "create-launch failed. Its session file keeps both throwaway keypairs, so resuming this run finishes the launch instead of orphaning it."
  LAUNCH="$(json_field "$RUN_DIR/launch.json" addresses.launch)"
  [[ -n "$LAUNCH" ]] || abort_run "create-launch produced no launch address"
  state_set LAUNCH "$LAUNCH"
  state_set CONFIG "$(json_field "$RUN_DIR/launch.json" addresses.config)"
  add_address "launch (StockFloor)" "$LAUNCH"
  add_address "base mint" "$(json_field "$RUN_DIR/launch.json" addresses.baseMint)"
  add_address "DBC config" "$(json_field "$RUN_DIR/launch.json" addresses.config)"
  add_address "DBC pool" "$(json_field "$RUN_DIR/launch.json" addresses.pool)"
  add_address "floor vault ($QUOTE)" "$(json_field "$RUN_DIR/launch.json" addresses.vault)"
  step_end create-launch "launch $LAUNCH"
fi
[[ -n "$LAUNCH" ]] || LAUNCH="$(state_get LAUNCH)"
[[ -n "$LAUNCH" ]] || abort_run "no launch address in the run state (pass --from create-launch to create one)"

# ---------------------------------------------------------------- 6. presale buys
if step_begin buy1; then
  sdk_cmd buy --keypair keys/cli-buyer1.json --launch "$LAUNCH" --raw "$BUYER1_BUY_RAW" \
    --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
  run_cmd "${SDK_CMD[@]}" || abort_run "buyer1's presale buy failed (nothing else was sent)"
  step_end buy1 "paid $BUYER1_BUY_RAW raw $QUOTE"
fi

if step_begin buy2; then
  run_cmd "$TSX" "$ROOT/scripts/e2e/plan.ts" completing-buy --launch "$LAUNCH" \
    --offer-raw "$BUYER2_OFFER_RAW" --rpc "$RPC" ||
    abort_run "the planned completing buy no longer covers the remaining curve: re-plan the amounts"
  sdk_cmd buy --keypair keys/cli-buyer2.json --launch "$LAUNCH" --raw "$BUYER2_OFFER_RAW" \
    --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
  run_cmd "${SDK_CMD[@]}" || abort_run "buyer2's completing buy failed"
  step_end buy2 "offered $BUYER2_OFFER_RAW raw $QUOTE (PartialFill)"
fi

# ---------------------------------------------------------------- 7. graduation crank
if step_begin crank-graduate; then
  sdk_cmd crank --keypair keys/cli-cranker.json --launch "$LAUNCH" --dry-run
  run_cmd "${SDK_CMD[@]}" || abort_run "the crank plan could not be read"
  sdk_cmd crank --keypair keys/cli-cranker.json --launch "$LAUNCH" --priority-fee "$PRIORITY_FEE" --json
  run_cmd "${SDK_CMD[@]}" ||
    abort_run "the graduation crank failed. It is permissionless and re-plans from chain state: resuming this run retries only what is still due (a failed migration retries with fresh position NFT keys)."
  step_end crank-graduate "harvests + migration + sync"
fi

# ---------------------------------------------------------------- 8. DAMM v2 market
if [[ ! -s "$RUN_DIR/plan-post.env" ]] && [[ "$(state_get STEP_damm-buy)" != "done" || "$(state_get STEP_damm-sell)" != "done" ]]; then
  "$TSX" "$ROOT/scripts/e2e/plan.ts" post-migration --launch "$LAUNCH" \
    --buyer1 "$(solana-keygen pubkey keys/cli-buyer1.json)" \
    --buyer2 "$(solana-keygen pubkey keys/cli-buyer2.json)" \
    --rpc "$RPC" | tee "$RUN_DIR/plan-post.env"
fi
if [[ -s "$RUN_DIR/plan-post.env" ]]; then
  # shellcheck disable=SC1091
  source "$RUN_DIR/plan-post.env"
fi

if step_begin damm-buy; then
  sdk_cmd buy --keypair keys/cli-buyer1.json --launch "$LAUNCH" --raw "$BUYER1_DAMM_RAW" \
    --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
  run_cmd "${SDK_CMD[@]}" || abort_run "the DAMM v2 buy failed"
  step_end damm-buy "paid $BUYER1_DAMM_RAW raw $QUOTE"
fi

if step_begin damm-sell; then
  sdk_cmd sell --keypair keys/cli-buyer2.json --launch "$LAUNCH" --raw "$BUYER2_SELL_RAW" \
    --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
  run_cmd "${SDK_CMD[@]}" || abort_run "the DAMM v2 sell failed"
  step_end damm-sell "sold $BUYER2_SELL_RAW raw base"
fi

if step_begin crank-lp; then
  sdk_cmd crank --keypair keys/cli-cranker.json --launch "$LAUNCH" --priority-fee "$PRIORITY_FEE" --json
  run_cmd "${SDK_CMD[@]}" || abort_run "the LP-fee crank failed (permissionless: it can be retried any time)"
  step_end crank-lp "LP fees into the vault"
fi

# ---------------------------------------------------------------- 9. redemptions
if [[ "$(state_get STEP_redeem1)" != "done" ]]; then
  "$TSX" "$ROOT/scripts/e2e/plan.ts" post-migration --launch "$LAUNCH" \
    --buyer1 "$(solana-keygen pubkey keys/cli-buyer1.json)" \
    --buyer2 "$(solana-keygen pubkey keys/cli-buyer2.json)" \
    --rpc "$RPC" | tee "$RUN_DIR/plan-redeem.env"
  # shellcheck disable=SC1091
  source "$RUN_DIR/plan-redeem.env"
fi

if step_begin redeem1; then
  sdk_cmd redeem --keypair keys/cli-buyer1.json --launch "$LAUNCH" --raw "$BUYER1_REDEEM_RAW" \
    --priority-fee "$PRIORITY_FEE"
  run_cmd "${SDK_CMD[@]}" || abort_run "buyer1's redemption failed"
  step_end redeem1 "burned $BUYER1_REDEEM_RAW raw base"
fi

if step_begin redeem2; then
  sdk_cmd redeem --keypair keys/cli-buyer2.json --launch "$LAUNCH" --all --priority-fee "$PRIORITY_FEE"
  run_cmd "${SDK_CMD[@]}" || abort_run "buyer2's redemption failed"
  step_end redeem2 "burned the whole balance"
fi

# ---------------------------------------------------------------- 10. final status
if step_begin status-final; then
  sdk_cmd status --launch "$LAUNCH" --price-usd "$PRICE_USD"
  run_cmd "${SDK_CMD[@]}" || abort_run "the final status read failed"
  DAMM_POOL="$(grep -oE '"dammPool": "[^"]+"' "$STEP_LOG" | head -1 | cut -d'"' -f4 || true)"
  [[ -n "$DAMM_POOL" ]] && add_address "DAMM v2 pool" "$DAMM_POOL"
  step_end status-final
fi

# ---------------------------------------------------------------- 11. finish
if [[ "$MODE" != "mainnet" ]]; then
  echo
  echo "== relay check (read-only mainnet lookup: no local signature may exist on mainnet)"
  "$TSX" "$ROOT/scripts/e2e/setup.ts" relay-check
fi

state_set OUTCOME "completed"
state_set FINISHED_AT "$(date -u +%FT%TZ)"
report_now
echo
echo "C2 run $RUN_ID completed."
echo "  launch      : $LAUNCH"
echo "  report      : scripts/c2/reports/${RUN_ID}.md"
echo "  transactions: $(wc -l <"$TXS_TSV" | tr -d ' ') recorded"
if [[ "$MODE" == "mainnet" ]]; then
  echo "  Solscan     : https://solscan.io/account/$LAUNCH"
else
  echo "  (dry run: nothing left the local surfnet)"
fi
