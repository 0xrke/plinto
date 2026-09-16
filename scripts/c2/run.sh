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
# | `--resume <id\|latest>` | — | Continue a previous run: skip the steps it completed. `latest` is the newest run **of the current mode** (by modification time); a run recorded in the other mode is refused |
# | `--from <step>` | — | Mark every step before `<step>` as skipped (manual recovery); an unknown step id is refused |
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
      sed -n '2,43p' "$0"
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
  APPROVAL_SHA="$(shasum -a 256 "$ROOT/keys/c2-approved" | cut -d' ' -f1)"
  export STOCKFLOOR_ALLOW_MAINNET=1
  [[ -n "$USE_RPC" ]] || USE_RPC=0
else
  RPC="http://127.0.0.1:${RPC_PORT}"
  TOKEN_URI="${TOKEN_URI:-https://raw.githubusercontent.com/stockfloor/stockfloor/main/app/public/demo/sfdemo.json}"
  APPROVAL_SHA=""
  # A dry run must never be able to send to mainnet. Three independent things enforce that, and all
  # three are load-bearing:
  #   1. the SDK send guard: without the override it accepts only a loopback Surfpool surfnet;
  #   2. the preflight cluster row: the dry run aborts unless the endpoint reports `surfnet-version`
  #      (see "--expect-cluster surfnet" below);
  #   3. `scripts/e2e/setup.ts mainnet-rent`, which is *not* optional: it writes the Rent sysvar with
  #      the Surfpool-only `surfnet_setAccount` cheatcode, so it fails on any endpoint that is not a
  #      surfnet — including a real mainnet RPC reached through a loopback tunnel.
  unset STOCKFLOOR_ALLOW_MAINNET
  [[ -n "$USE_RPC" ]] || USE_RPC=1
fi

# ---------------------------------------------------------------- run directory and state
# Run ids are "<prefix>-<UTC timestamp>"; the prefix is the mode, so a run directory can never be
# shared by a dry run and a mainnet run.
RUN_PREFIX="$([[ "$MODE" == "mainnet" ]] && echo "c2" || echo "dry")"
mkdir -p "$ROOT/target/c2"

# The mode a run directory was created in: state.env (current runs), meta.env (runs from before
# MODE was recorded in the state), or the run-id prefix as a last resort.
run_dir_mode() {
  local dir="$1" mode=""
  mode="$({ sed -n 's/^MODE=//p' "$dir/state.env" 2>/dev/null || true; } | tail -1)"
  [[ -n "$mode" ]] || mode="$({ sed -n 's/^MODE=//p' "$dir/meta.env" 2>/dev/null || true; } | tail -1)"
  if [[ -z "$mode" ]]; then
    case "$(basename "$dir")" in
      c2-*) mode=mainnet ;;
      dry-*) mode=dry ;;
    esac
  fi
  printf '%s' "$mode"
}

if [[ -n "$RESUME" ]]; then
  if [[ "$RESUME" == "latest" ]]; then
    # By modification time, and only within this mode's prefix. Sorting the directory names would
    # order "dry-…" after "c2-…" whatever their age, so a mainnet resume would pick up a dry run,
    # skip every step it already completed and rewrite its committed report as a mainnet report.
    LATEST_STATE="$(ls -t "$ROOT"/target/c2/"$RUN_PREFIX"-*/state.env 2>/dev/null | head -1)"
    [[ -n "$LATEST_STATE" ]] ||
      die "no previous $MODE run with state under target/c2/ (a run of the other mode cannot be resumed here)"
    RUN_ID="$(basename "$(dirname "$LATEST_STATE")")"
  else
    RUN_ID="$RESUME"
  fi
  RUN_DIR="$ROOT/target/c2/$RUN_ID"
  [[ -f "$RUN_DIR/state.env" ]] || die "no run state at $RUN_DIR/state.env"
  RESUME_MODE="$(run_dir_mode "$RUN_DIR")"
  [[ -z "$RESUME_MODE" || "$RESUME_MODE" == "$MODE" ]] ||
    die "run $RUN_ID was a ${RESUME_MODE} run; refusing to continue it in ${MODE} mode (its steps, addresses and report belong to the other cluster — start a new run instead)"
  echo "resuming run $RUN_ID ($MODE)"
else
  RUN_ID="${RUN_PREFIX}-$(date -u +%Y%m%dT%H%M%SZ)"
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
state_set MODE "$MODE"

# The approval marker authorises ONE run. It is bound to the run id here, so the same
# `keys/c2-approved` cannot silently start a second full mainnet run; resuming the run it authorised
# stays possible. The script never creates or modifies the marker — only the user does.
if [[ "$MODE" == "mainnet" ]]; then
  for d in "$ROOT"/target/c2/c2-*/; do
    [[ -d "$d" && -f "${d}state.env" ]] || continue
    other="$(basename "${d%/}")"
    [[ "$other" != "$RUN_ID" ]] || continue
    grep -qxF "APPROVAL_SHA=$APPROVAL_SHA" "${d}state.env" 2>/dev/null || continue
    other_outcome="$({ sed -n 's/^OUTCOME=//p' "${d}state.env" 2>/dev/null || true; } | tail -1)"
    die "keys/c2-approved already authorised run $other (${other_outcome:-still in progress}).
  - to continue that run:  bash scripts/c2/run.sh --resume $other --mainnet --allow-mainnet
  - for a genuinely new run the user re-creates the marker:
      printf 'C2 approved %s\\n' \"\$(date -u +%Y-%m-%dT%H:%M:%SZ)\" > keys/c2-approved"
  done
  state_set APPROVAL_SHA "$APPROVAL_SHA"
fi

# Escape a string for use as the pattern of `s|…|…|` in BRE (sed): the delimiter, the replacement's
# `&`, and every BRE metacharacter, `[` and `]` included.
sed_escape() {
  node -e 'process.stdout.write(String(process.argv[1]).replace(/[\\^$.*|/&\[\]]/g, "\\$&"))' "$1"
}
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
  - a step that failed while waiting for a confirmation may still have landed. Check its signatures
    (below, in the report, and in ${RUN_DIR#"$ROOT"/}/logs/) with
      solana confirm -v <signature> --url "\$MAINNET_RPC_URL"
    or the launch state with \`bash packages/sdk/scripts/run.sh status --rpc "\$MAINNET_RPC_URL" --launch <launch>\`.
    If it landed, answer \`skip\` at that step's prompt when you resume — buys, sells and redemptions
    are not idempotent.
  - per-stage abort and rollback notes: docs/c2-runbook.md
EOF
}

abort_run() {
  echo >&2
  echo "ABORT: $*" >&2
  # Record whatever the failing step already sent BEFORE writing the report: a send whose
  # confirmation timed out leaves its signature in the step log, and it may well have landed.
  local sigs=""
  if [[ -n "${CURRENT_STEP:-}" && -n "${STEP_LOG:-}" && -f "${STEP_LOG:-}" ]]; then
    collect_txs "$CURRENT_STEP" || true
    sigs="$({ awk -F'\t' -v s="$CURRENT_STEP" '$1 == s { print $2 }' "$TXS_TSV" 2>/dev/null || true; })"
  fi
  state_set OUTCOME "aborted in step ${CURRENT_STEP:-<none>}: $*"
  state_set FINISHED_AT "$(date -u +%FT%TZ)"
  report_now || true
  if [[ -n "$sigs" ]]; then
    {
      echo
      echo "Transactions already sent in step ${CURRENT_STEP} (they may have landed even though the step failed):"
      echo "$sigs" | sed -e 's/^/  /'
    } >&2
  fi
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
# A mistyped --from used to mark every step "skipped" and finish a run that sent nothing.
if [[ -n "$FROM" ]]; then
  case " $STEP_ORDER " in
    *" $FROM "*) ;;
    *) die "--from $FROM is not a step id. Steps: $STEP_ORDER" ;;
  esac
fi
CURRENT_STEP=""
STEP_LOG=""
STEP_START=0
REACHED_FROM=0

step_title() {
  case "$1" in
    deploy) echo "Deploy the stockfloor program ($(( (ELF_BYTES + 959) / 960 + 2 )) BPF loader transactions, ~2.57 SOL of rent from the deployer)" ;;
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

# Who signs and pays for a step, as "<role> <key file>".
step_payer() {
  case "$1" in
    deploy) echo "deployer keys/deployer.json" ;;
    create-launch) echo "creator keys/cli-creator.json" ;;
    buy1 | damm-buy | redeem1) echo "buyer1 keys/cli-buyer1.json" ;;
    buy2 | damm-sell | redeem2) echo "buyer2 keys/cli-buyer2.json" ;;
    crank-graduate | crank-lp) echo "cranker keys/cli-cranker.json" ;;
  esac
}

# 1234567 -> 1,234,567 (left alone when it is not a number).
group() { node -e 'process.stdout.write(String(process.argv[1]).replace(/\B(?=(\d{3})+(?!\d))/g, ","))' "$1"; }

# The deploy cost the preflight measured from the live rent, in SOL.
deploy_cost_sol() {
  node -e '
    try {
      const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const row = (r.rows || []).find((x) => x.id === "rent");
      process.stdout.write(row ? (Number(row.data.deployCost) / 1e9).toFixed(4) : "2.57");
    } catch { process.stdout.write("2.57"); }
  ' "$RUN_DIR/preflight.json"
}

# Raw quote amount as "<raw> raw SPYx (≈ $x.xx)" using the price the amounts were planned at.
# QUOTE_DECIMALS defaults to SPYx's 8; every quote asset on the allowlist is an 8-decimal xStock.
fmt_quote() {
  node -e '
    const raw = BigInt(process.argv[1] || "0");
    const price = Number(process.argv[2] || "0");
    const mult = Number(process.argv[3] || "1");
    const decimals = Number(process.argv[4] || "8");
    const usd = (Number(raw) / 10 ** decimals) * mult * price;
    const grouped = raw.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    process.stdout.write(`${grouped} raw ${process.argv[5]}` + (price > 0 ? ` (≈ $${usd.toFixed(2)})` : ""));
  ' "$1" "${PRICE_USD:-0}" "${QUOTE_MULTIPLIER:-1}" "${QUOTE_DECIMALS:-8}" "$QUOTE"
}

# What the step is about to spend. Printed with the prompt: a confirmation that names only the step
# id tells the operator nothing about the amount or the wallet it leaves.
step_amount() {
  case "$1" in
    deploy) echo "≈ $(deploy_cost_sol) SOL from the deployer over $(( (ELF_BYTES + 959) / 960 + 2 )) transactions; almost all of it is programdata rent, which only the irreversible \`solana program close\` gives back" ;;
    create-launch) echo "$(fmt_quote "${FIRST_BUY_RAW:-0}") as the creator's first buy, plus ≈ 0.032 SOL of account rent" ;;
    buy1) echo "$(fmt_quote "${BUYER1_BUY_RAW:-0}")" ;;
    buy2) echo "$(fmt_quote "${BUYER2_OFFER_RAW:-0}") offered; PartialFill takes only what the curve still needs" ;;
    damm-buy) echo "$(fmt_quote "${BUYER1_DAMM_RAW:-0}")" ;;
    damm-sell) echo "$(group "${BUYER2_SELL_RAW:-?}") raw base tokens sold on DAMM v2" ;;
    redeem1) echo "$(group "${BUYER1_REDEEM_RAW:-?}") raw base tokens burned for $QUOTE from the vault" ;;
    redeem2) echo "buyer2's whole base balance burned for $QUOTE from the vault" ;;
    crank-graduate) echo "no funds from the signer beyond fees (≈ 0.018 SOL, including the migration flash rent)" ;;
    crank-lp) echo "no funds from the signer beyond fees (≈ 0.0002 SOL)" ;;
    status-final) echo "nothing: a read-only status query" ;;
  esac
}

step_context() {
  local id="$1" amount payer role file
  amount="$(step_amount "$id")"
  [[ -z "$amount" ]] || echo "   spends      : $amount"
  payer="$(step_payer "$id")"
  if [[ -n "$payer" ]]; then
    role="${payer%% *}"
    file="${payer#* }"
    echo "   fee payer   : $role $(solana-keygen pubkey "$ROOT/$file" 2>/dev/null || echo "?") ($file)"
  fi
}

confirm() {
  # 0 = go, 2 = skip this step; `abort` (or an unreadable terminal) aborts the run. Anything else is
  # re-prompted: at a prompt that is about to spend real money, a typo must not mean "go" and must
  # not throw away a run either.
  local prompt="$1" answer="" tries=0
  if [[ "$ASSUME_YES" == "1" ]]; then
    echo "   (--yes) proceeding"
    return 0
  fi
  if [[ "$MODE" != "mainnet" && "$CONFIRM_DRY" != "1" ]]; then return 0; fi
  # The prompt reads the terminal directly, so it still works when the run is piped into a log.
  if ! exec 3<>/dev/tty 2>/dev/null; then
    abort_run "no terminal is available for the confirmation prompt (re-run with --yes)"
  fi
  while true; do
    printf '   %s [yes / skip / abort]: ' "$prompt" >&3
    if ! read -r answer <&3; then
      exec 3>&-
      abort_run "the confirmation prompt reached end of input at step $CURRENT_STEP (re-run with --yes for an unattended run)"
    fi
    case "$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
      y | yes) exec 3>&- ; return 0 ;;
      s | skip) exec 3>&- ; return 2 ;;
      a | abort | n | no | quit | q)
        exec 3>&-
        abort_run "stopped by the operator at step $CURRENT_STEP"
        ;;
      *)
        tries=$((tries + 1))
        if [[ $tries -ge 5 ]]; then
          exec 3>&-
          abort_run "no valid answer after $tries attempts at step $CURRENT_STEP"
        fi
        printf '   answer "yes" to run this step, "skip" to leave it out, "abort" to stop the run.\n' >&3
        ;;
    esac
  done
}

# True once a step that moves funds has completed.
money_moved() {
  local s
  for s in create-launch buy1 buy2; do
    if [[ "$(state_get "STEP_${s}")" == "done" ]]; then return 0; fi
  done
  return 1
}

# quote_guard <chain|price>
#   chain: only what is on chain — is the quote mint paused, did a transfer hook appear. Every step
#          that moves the quote asset runs this.
#   price: additionally compares the live Jupiter price with the price the amounts were planned at.
#          Only the steps whose raw amounts are derived from that price run it (create-launch, buy1,
#          buy2, damm-buy). The sell and the two redemptions spend on-chain balances, so a Jupiter
#          rate-limit blip must not abort the run between the buys and the redemptions.
quote_guard() {
  local kind="${1:-chain}"
  local args=(quote-guard --rpc "$RPC" --quote "$QUOTE" --max-drift-pct "$MAX_DRIFT_PCT")
  if [[ "$kind" != "price" || "$SKIP_PRICE_GUARD" == "1" || -z "${PRICE_USD:-}" ]]; then
    args+=(--skip-price)
  else
    args+=(--baseline-price "$PRICE_USD")
    # After the first buy the threshold is fixed on chain in raw units: an unreachable Jupiter is
    # then a warning, not a reason to stop a run that has already spent money.
    if money_moved; then args+=(--price-optional); fi
  fi
  set +e
  "$TSX" "$ROOT/scripts/c2/checks.ts" "${args[@]}"
  local code=$?
  set -e
  case $code in
    0) ;;
    3) abort_run "the $QUOTE guard stopped the run before step $CURRENT_STEP. --skip-price-guard keeps only the on-chain pause and transfer-hook checks; --max-price-drift-pct <n> widens the price window; a new run re-plans the amounts at the current price." ;;
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
    create-launch | buy1 | buy2 | damm-buy) quote_guard price ;;
    deploy | crank-graduate | damm-sell | crank-lp | redeem1 | redeem2) quote_guard chain ;;
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
  step_context "$id"
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

# plan_cmd <out file> <abort message> <plan.ts arguments...>
# The read-only planner writes `export K=V` lines that the later steps source. Running it through
# here means a failure ends the run the way any other failure does — with a written report, a
# recorded outcome and the recovery block — instead of a bare non-zero exit.
plan_cmd() {
  local out="$1" message="$2"
  shift 2
  echo "\$ $(redact "scripts/e2e/plan.ts $*")"
  set +e
  "$TSX" "$ROOT/scripts/e2e/plan.ts" "$@" >"$out.tmp" 2>"$out.err"
  local code=$?
  set -e
  if [[ $code -ne 0 ]]; then
    { sed -e "$REDACT_SED" "$out.err" || true; } >&2
    rm -f "$out.tmp" "$out.err"
    abort_run "$message (scripts/e2e/plan.ts exited $code)"
  fi
  rm -f "$out.err"
  mv "$out.tmp" "$out"
  cat "$out"
}

collect_txs() {
  local id="$1"
  # Transaction signatures, in the shapes the tools actually print them:
  #   success  `Signature: <sig>`                 (solana program deploy)
  #            `"signature": "<sig>"`             (SDK CLI JSON output)
  #            `sent create_config+…: <sig>`      (create-launch, per transaction)
  #            `… migrate executed <sig> (… CU)`  (crank)
  #   failure  `… Check signature <sig> using …`  (web3.js confirmation timeout: it may have landed)
  #            `Signature <sig> has expired: …`   (blockhash expired)
  #            `<label> <sig> failed: …`          (confirmed with an on-chain error)
  # The last three are why abort_run calls this: a send whose confirmation timed out has to reach the
  # report, or the operator resumes blind.
  #
  # Anchoring on those labels is also what makes it safe to scan the log at all: a bare "85-88 base58
  # characters" search has exactly the alphabet and length of a base58-encoded 64-byte secret key, so
  # anything of that shape that ever reached a step log would be copied into the committed report.
  {
    { grep -oE '([Ss]ignature"?:?|sent [A-Za-z0-9_+-]+:|executed) *"?[1-9A-HJ-NP-Za-km-z]{85,88}' "$STEP_LOG" 2>/dev/null || true; } |
      sed -E 's/.*[^1-9A-HJ-NP-Za-km-z]//'
    { grep -oE '[1-9A-HJ-NP-Za-km-z]{85,88} (failed|has expired)' "$STEP_LOG" 2>/dev/null || true; } |
      sed -E 's/[^1-9A-HJ-NP-Za-km-z].*$//'
  } | awk '!seen[$0]++' |
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

# The SDK CLI commands that send transactions. Only these take --allow-mainnet: it is the send
# guard's switch, and a command that does not declare it as a switch (status) would parse the next
# flag as its value and die with "missing value for --allow-mainnet".
# packages/sdk/test/c2-cli-flags.test.ts checks this list against both run.sh and the scripts.
SDK_SENDING_COMMANDS="create-launch buy sell redeem crank"

sdk_cmd() {
  SDK_CMD=(bash "$ROOT/packages/sdk/scripts/run.sh" "$1" --rpc "$RPC")
  if [[ "$MODE" == "mainnet" && " $SDK_SENDING_COMMANDS " == *" $1 "* ]]; then
    SDK_CMD+=(--allow-mainnet)
  fi
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
  # Load-bearing, not just fidelity: `mainnet-rent` writes the Rent sysvar with the Surfpool-only
  # `surfnet_setAccount` cheatcode, so it fails on anything that is not a surfnet. Together with the
  # preflight cluster check below it is what keeps a "dry run" from ever talking to real mainnet.
  "$TSX" "$ROOT/scripts/e2e/setup.ts" mainnet-rent
  "$TSX" "$ROOT/scripts/e2e/setup.ts" token-programs
fi

# ---------------------------------------------------------------- 1. amounts from the live price
if [[ ! -s "$RUN_DIR/plan.env" ]]; then
  plan_cmd "$RUN_DIR/plan.env" "the demo amounts could not be planned from the live $QUOTE price" \
    pre-launch --threshold-usd "$THRESHOLD_USD" --quote "$QUOTE" --rpc "$RPC"
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
# On a resume, a wallet whose quote-spending step already landed no longer needs its SPYx: it is in
# the pool. Without this the preflight blocks a correct resume on "creator funded: NO-GO".
SPYX_SPENT=""
for pair in "create-launch:creator" "buy1:buyer1" "buy2:buyer2"; do
  step="${pair%%:*}"; role="${pair##*:}"
  if [[ "$(state_get "STEP_${step}")" == "done" ]]; then
    SPYX_SPENT="${SPYX_SPENT:+$SPYX_SPENT,}$role"
  fi
done
[[ -n "$SPYX_SPENT" ]] && PREFLIGHT_EXTRA+=(--spyx-spent "$SPYX_SPENT")
# The creator has no steps after create-launch: its rent and fees are already paid, so requiring the
# full pre-launch balance again would block the resume.
if [[ "$(state_get STEP_create-launch)" == "done" ]]; then
  PREFLIGHT_EXTRA+=(--spent-roles creator)
fi

set +e
EXPECT_CLUSTER="$([[ "$MODE" == "mainnet" ]] && echo "mainnet" || echo "surfnet")"
"$TSX" "$ROOT/scripts/c2/preflight.ts" --rpc "$RPC" --threshold-usd "$THRESHOLD_USD" \
  --priority-fee "$PRIORITY_FEE" --quote "$QUOTE" --so "$SO" --max-len "$MAX_LEN" \
  --expect-cluster "$EXPECT_CLUSTER" \
  --plan-file "$RUN_DIR/plan.env" --out "$RUN_DIR/preflight.json" "${PREFLIGHT_EXTRA[@]+"${PREFLIGHT_EXTRA[@]}"}" |
  sed -e "$REDACT_SED" | tee "$RUN_DIR/logs/preflight.log"
PREFLIGHT_CODE=${PIPESTATUS[0]}
set -e
PREFLIGHT_VERDICT="$(json_field "$RUN_DIR/preflight.json" verdict || true)"
PREFLIGHT_WARNINGS="$(json_field "$RUN_DIR/preflight.json" counts.warnings || true)"
PREFLIGHT_CLUSTER="$(json_field "$RUN_DIR/preflight.json" cluster || true)"
state_set PREFLIGHT "$PREFLIGHT_VERDICT ($PREFLIGHT_WARNINGS warning(s), cluster ${PREFLIGHT_CLUSTER:-unknown})"
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
else
  # A dry run may only ever run against a Surfpool surfnet. The preflight classifies the endpoint
  # from `getVersion` (surfnet-version), not from its host name, so a surfnet behind any hostname
  # counts and a real cluster behind a loopback name does not.
  [[ "$PREFLIGHT_CLUSTER" == "surfnet" ]] ||
    abort_run "the dry run's endpoint is not a Surfpool surfnet (preflight cluster: ${PREFLIGHT_CLUSTER:-unknown}). A dry run must never send anywhere else; start one with scripts/surfpool/start.sh."
  if [[ "$PREFLIGHT_CODE" -ne 0 ]]; then
    echo "(dry run: preflight verdict $PREFLIGHT_VERDICT — continuing on the surfnet; the funding and cost rows are about mainnet)"
  fi
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
    # No --url: the endpoint comes from the 0600 config file above, so an RPC URL with an API key in
    # it does not sit on the command line of a ten-minute process for every local `ps` to read.
    DEPLOY_CMD=(solana program deploy --config "$RUN_DIR/solana-cli.yml"
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
      abort_run "the deploy failed. Resuming this run re-runs the same command, which continues writing into the same buffer (keys/stockfloor-deploy-buffer.json) instead of paying for the writes again; the preflight compares what is already in that buffer with the local binary. 'solana program show --buffers --keypair keys/deployer.json' lists a stranded buffer and 'solana program close --buffers --keypair keys/deployer.json' returns its rent."
    # A provider endpoint load-balances across nodes, so the account written by the last deploy
    # transaction is not visible to every one of them at once. Observed on mainnet: this check read
    # "absent" seconds after a deploy that had in fact landed (the dumped ELF matched byte for byte).
    # Poll before believing it.
    AFTER=""
    for _ in $(seq 1 20); do
      set +e
      AFTER="$("$TSX" "$ROOT/scripts/c2/checks.ts" program-state --rpc "$RPC" --so "$SO" 2>&1)"
      set -e
      [[ "$AFTER" == "match" ]] && break
      sleep 3
    done
    [[ "$AFTER" == "match" ]] || abort_run "after the deploy the on-chain ELF does not match the local binary: $AFTER"
    echo "   verified: the deployed ELF matches $SO"
    add_address "stockfloor program" "$PROGRAM_ID"
    # In the state, not meta.env: meta.env is rewritten on every pass, so a resumed run would
    # otherwise drop the deploy transaction count from its report.
    state_set DEPLOY_TX_COUNT "$(( (ELF_BYTES + 959) / 960 + 2 ))"
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
  run_cmd "${SDK_CMD[@]}" || abort_run "buyer1's presale buy failed. A single transaction: it either landed or it did not — check the signature below before resuming, and answer 'skip' for buy1 if it did."
  step_end buy1 "paid $BUYER1_BUY_RAW raw $QUOTE"
fi

if step_begin buy2; then
  run_cmd "$TSX" "$ROOT/scripts/e2e/plan.ts" completing-buy --launch "$LAUNCH" \
    --offer-raw "$BUYER2_OFFER_RAW" --rpc "$RPC" ||
    abort_run "the planned completing buy no longer covers the remaining curve: re-plan the amounts"
  sdk_cmd buy --keypair keys/cli-buyer2.json --launch "$LAUNCH" --raw "$BUYER2_OFFER_RAW" \
    --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
  run_cmd "${SDK_CMD[@]}" || abort_run "buyer2's completing buy failed. A single transaction: it either landed or it did not — check the signature below before resuming, and answer 'skip' for buy2 if it did."
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
  plan_cmd "$RUN_DIR/plan-post.env" "the post-migration amounts could not be read from chain state" \
    post-migration --launch "$LAUNCH" \
    --buyer1 "$(solana-keygen pubkey keys/cli-buyer1.json)" \
    --buyer2 "$(solana-keygen pubkey keys/cli-buyer2.json)" \
    --rpc "$RPC"
fi
if [[ -s "$RUN_DIR/plan-post.env" ]]; then
  # shellcheck disable=SC1091
  source "$RUN_DIR/plan-post.env"
fi

if step_begin damm-buy; then
  sdk_cmd buy --keypair keys/cli-buyer1.json --launch "$LAUNCH" --raw "$BUYER1_DAMM_RAW" \
    --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
  run_cmd "${SDK_CMD[@]}" || abort_run "the DAMM v2 buy failed. A single transaction: check the signature below before resuming, and answer 'skip' for damm-buy if it landed."
  step_end damm-buy "paid $BUYER1_DAMM_RAW raw $QUOTE"
fi

if step_begin damm-sell; then
  sdk_cmd sell --keypair keys/cli-buyer2.json --launch "$LAUNCH" --raw "$BUYER2_SELL_RAW" \
    --slippage-bps 100 --priority-fee "$PRIORITY_FEE"
  run_cmd "${SDK_CMD[@]}" || abort_run "the DAMM v2 sell failed. A single transaction: check the signature below before resuming, and answer 'skip' for damm-sell if it landed."
  step_end damm-sell "sold $BUYER2_SELL_RAW raw base"
fi

if step_begin crank-lp; then
  sdk_cmd crank --keypair keys/cli-cranker.json --launch "$LAUNCH" --priority-fee "$PRIORITY_FEE" --json
  run_cmd "${SDK_CMD[@]}" || abort_run "the LP-fee crank failed (permissionless: it can be retried any time)"
  step_end crank-lp "LP fees into the vault"
fi

# ---------------------------------------------------------------- 9. redemptions
if [[ "$(state_get STEP_redeem1)" != "done" ]]; then
  plan_cmd "$RUN_DIR/plan-redeem.env" "the redemption amounts could not be read from chain state" \
    post-migration --launch "$LAUNCH" \
    --buyer1 "$(solana-keygen pubkey keys/cli-buyer1.json)" \
    --buyer2 "$(solana-keygen pubkey keys/cli-buyer2.json)" \
    --rpc "$RPC"
  # shellcheck disable=SC1091
  source "$RUN_DIR/plan-redeem.env"
fi

if step_begin redeem1; then
  sdk_cmd redeem --keypair keys/cli-buyer1.json --launch "$LAUNCH" --raw "$BUYER1_REDEEM_RAW" \
    --priority-fee "$PRIORITY_FEE"
  run_cmd "${SDK_CMD[@]}" || abort_run "buyer1's redemption failed. Redemptions are not idempotent: check the signature below before resuming, and answer 'skip' for redeem1 if it landed."
  step_end redeem1 "burned $BUYER1_REDEEM_RAW raw base"
fi

if step_begin redeem2; then
  sdk_cmd redeem --keypair keys/cli-buyer2.json --launch "$LAUNCH" --all --priority-fee "$PRIORITY_FEE"
  run_cmd "${SDK_CMD[@]}" || abort_run "buyer2's redemption failed. Redemptions are not idempotent: check the signature below before resuming, and answer 'skip' for redeem2 if it landed."
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
