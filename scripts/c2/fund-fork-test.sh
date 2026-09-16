#!/usr/bin/env bash
# Fork test for scripts/c2/fund.ts: run the whole funding step against a LOCAL Surfpool mainnet
# fork, with the deployer holding exactly the 6.108 SOL the user funded on mainnet.
#
#   bash scripts/c2/fund-fork-test.sh                 # RPC 127.0.0.1:58899, WS 58900, studio 18588
#   RPC_PORT=48899 STUDIO_PORT=18500 bash scripts/c2/fund-fork-test.sh
#   KEEP_SURFPOOL=1 bash scripts/c2/fund-fork-test.sh # leave the surfnet running for inspection
#
# What it proves (nothing leaves the machine; the surfnet executes everything in its own LiteSVM):
#   1. the full run: 4 SOL transfers, 4 SPYx token accounts, 2 swap stages, 3 SPYx transfers, and
#      an end state that matches the plan;
#   2. idempotence: a second run with an EMPTY state file sends nothing at all (the skip decisions
#      come from the chain balances, not from the state file);
#   3. recovery: with the state file deleted and one wallet's SPYx wiped, only that wallet is
#      repaired, and only the missing SPYx is bought;
#   4. the refusals: the 5.05 SOL deploy floor, a deployer that cannot pay, the mainnet override
#      pointed at a loopback RPC, and Jupiter asked for on a fork.
#
# The SWAP ITSELF IS NOT EXERCISED HERE. Jupiter is mainnet-only, so the fork run injects a
# cheatcode swap provider (--swap-provider cheat) that mints the SPYx and charges the SOL. What the
# fork proves about the swap is the sizing, the quote checks, the received-amount assertion, the
# second confirmation and the resume logic — not the Jupiter route, signature or execute call.
#
# Exits non-zero if any case fails. The surfnet is always stopped (unless KEEP_SURFPOOL=1).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

RPC_PORT="${RPC_PORT:-58899}"
WS_PORT="${WS_PORT:-$((RPC_PORT + 1))}"
STUDIO_PORT="${STUDIO_PORT:-18588}"
INSTANCE="${INSTANCE:-rpc-${RPC_PORT}}"
RPC="http://127.0.0.1:${RPC_PORT}"
TSX="packages/sdk/node_modules/.bin/tsx"
WORK="target/c2/fund-fork-test"
KEEP_SURFPOOL="${KEEP_SURFPOOL:-0}"

DEPLOYER=BBU1tTr4BTrEeVfNG4wWLmrmyhDHdeLZeny5C5FsdstV
CREATOR=EFSrr7pe6fJqRLXWMBYzNCJj2uVBxtn9fxYM91U2vY5f
BUYER1=ED77vdfSwwJzrvQqUo7RtQRYsMA3bGSP213ZEBoBin99
BUYER2=5WgdkguwV2EcLuPE8sGCjrRqcxXui5kbkaxdHE4viAJJ
CRANKER=FhaZVX91912MJTxoPDW3JtmbeDEuZdRjDQ9QfkaWohyC
# The balance the user funded on mainnet, mirrored on the fork.
FUNDED_LAMPORTS=6108000000

FAILED=0
CASES=()

cleanup() {
  if [[ "$KEEP_SURFPOOL" == "1" ]]; then
    echo "KEEP_SURFPOOL=1: surfnet left running on $RPC"
  else
    RPC_PORT="$RPC_PORT" INSTANCE="$INSTANCE" bash scripts/surfpool/stop.sh >/dev/null 2>&1
    echo "surfnet stopped"
  fi
}
trap cleanup EXIT

rpc() {
  curl -s --max-time 20 -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-[]}}" "$RPC"
}

set_lamports() { rpc surfnet_setAccount "[\"$1\",{\"lamports\":$2}]" >/dev/null; }

balance() { rpc getBalance "[\"$1\"]" | sed 's/.*"value"://; s/}.*//'; }

# Set a token account's raw amount (offset 64, u64 LE) through surfnet_setAccount.
set_token_amount() {
  node -e '
    const [rpc, ata, amount] = process.argv.slice(1);
    const call = async (method, params) => {
      const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const b = await r.json();
      if (b.error) throw new Error(`${method}: ${b.error.message}`);
      return b.result;
    };
    (async () => {
      const acc = await call("getAccountInfo", [ata, { encoding: "base64" }]);
      if (!acc || !acc.value) throw new Error(`no token account ${ata}`);
      const data = Buffer.from(acc.value.data[0], "base64");
      const before = data.readBigUInt64LE(64);
      data.writeBigUInt64LE(BigInt(amount), 64);
      await call("surfnet_setAccount", [ata, { data: data.toString("hex") }]);
      console.log(`  token account ${ata}: ${before} -> ${amount}`);
    })().catch((e) => { console.error(e.message); process.exit(1); });
  ' "$RPC" "$1" "$2"
}

# The SPYx associated token account of an owner (Token-2022).
ata_of() {
  node -e '
    const { PublicKey } = require("./packages/sdk/node_modules/@solana/web3.js");
    const owner = new PublicKey(process.argv[1]);
    const mint = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");
    const tokenProgram = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const ata = PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))[0];
    console.log(ata.toBase58());
  ' "$1"
}

# case <name> <expected exit> <output file> -- <command...>
case_run() {
  local name="$1" expected="$2" out="$3"
  shift 4
  echo
  echo "==> ${name}"
  "$@" >"$out" 2>&1
  local code=$?
  if [[ "$code" == "$expected" ]]; then
    CASES+=("PASS  ${name} (exit ${code})")
    echo "    PASS (exit ${code}), output: ${out}"
  else
    CASES+=("FAIL  ${name} (exit ${code}, expected ${expected})")
    FAILED=1
    echo "    FAIL (exit ${code}, expected ${expected}), output: ${out}"
    tail -n 20 "$out"
  fi
  return 0
}

expect_grep() {
  # expect_grep <file> <pattern> <what>
  if grep -qE "$2" "$1"; then
    CASES+=("PASS  $3")
  else
    CASES+=("FAIL  $3 (no /$2/ in $1)")
    FAILED=1
    echo "    FAIL: expected /$2/ in $1"
  fi
}

expect_absent() {
  if grep -qE "$2" "$1"; then
    CASES+=("FAIL  $3 (unexpected /$2/ in $1)")
    FAILED=1
    echo "    FAIL: did not expect /$2/ in $1"
    grep -E "$2" "$1" | head -n 5
  else
    CASES+=("PASS  $3")
  fi
}

# ------------------------------------------------------------------ 0. a fresh fork

rm -rf "$WORK"
mkdir -p "$WORK/reports"

echo "==> starting a local Surfpool mainnet fork on ${RPC} (ws ${WS_PORT}, studio ${STUDIO_PORT})"
RPC_PORT="$RPC_PORT" WS_PORT="$WS_PORT" STUDIO_PORT="$STUDIO_PORT" INSTANCE="$INSTANCE" \
  AIRDROP_LAMPORTS=1000000000 bash scripts/surfpool/start.sh || exit 1

# The mainnet Token-2022 / SPL Token ELFs: SPYx carries ScaledUiAmount, Pausable and
# TransferHookAccount extensions that Surfpool's bundled build does not necessarily have.
bash scripts/surfpool/run.sh deploy-local --rpc "$RPC" --mainnet-token-programs >"$WORK/deploy-local.log" 2>&1 ||
  { echo "deploy-local failed"; tail -n 20 "$WORK/deploy-local.log"; exit 1; }

# Mirror mainnet: the deployer holds what the user sent, the demo wallets are empty.
set_lamports "$DEPLOYER" "$FUNDED_LAMPORTS"
for w in "$CREATOR" "$BUYER1" "$BUYER2" "$CRANKER"; do set_lamports "$w" 0; done
echo "    deployer $(balance "$DEPLOYER") lamports, demo wallets empty"

FUND=("$TSX" scripts/c2/fund.ts --rpc "$RPC" --swap-provider cheat --yes)

# ------------------------------------------------------------------ 1. the full run

case_run "full run (writes the committed report)" 0 "$WORK/1-full.log" -- \
  "${FUND[@]}" --new-run
expect_grep "$WORK/1-full.log" "swap:test: received" "the test swap is verified from chain"
expect_grep "$WORK/1-full.log" "The test swap arrived" "a second confirmation guards the main swap"
expect_grep "$WORK/1-full.log" "spyx:buyer2: done" "every wallet got its SPYx"
expect_grep "$WORK/1-full.log" "^OK  deployer" "the deployer is still above its floor"
expect_absent "$WORK/1-full.log" "SHORT" "no shortfall in the end state"

# ------------------------------------------------------------------ 2. idempotence

case_run "second run with an empty state file sends nothing" 0 "$WORK/2-again.log" -- \
  "${FUND[@]}" --state "$WORK/again.json" --reports-dir "$WORK/reports"
expect_absent "$WORK/2-again.log" ": done [1-9A-HJ-NP-Za-km-z]{60,}" "no transaction was sent on the second run"
expect_grep "$WORK/2-again.log" "already holds its target: nothing to send" "the plan is empty"

# ------------------------------------------------------------------ 3. recovery

BUYER2_ATA="$(ata_of "$BUYER2")"
echo
echo "==> wiping buyer2's SPYx and the state file (a crash that lost both)"
set_token_amount "$BUYER2_ATA" 0
rm -f "$WORK/again.json"
# Buying that SPYx again would come out of the deploy money, so the repair is refused first.
case_run "refuses a repair that would eat the deploy money" 3 "$WORK/3-repair-refused.log" -- \
  "${FUND[@]}" --state "$WORK/again.json" --reports-dir "$WORK/reports"
expect_grep "$WORK/3-repair-refused.log" "below the 5.050000 SOL the deploy needs" "the floor holds during a repair too"

echo "==> topping the deployer back up to the funded balance and repairing"
set_lamports "$DEPLOYER" "$FUNDED_LAMPORTS"
case_run "recovery: only the missing wallet is repaired" 0 "$WORK/3-recover.log" -- \
  "${FUND[@]}" --state "$WORK/again.json" --reports-dir "$WORK/reports"
expect_grep "$WORK/3-recover.log" "spyx:buyer2: transferring" "buyer2 is topped up"
expect_absent "$WORK/3-recover.log" "spyx:(creator|buyer1): transferring" "the wallets that are funded are left alone"
expect_absent "$WORK/3-recover.log" "sol:[a-z0-9]+: sending" "no SOL is sent again"

# ------------------------------------------------------------------ 4. the refusals

echo
echo "==> emptying the cranker and leaving the deployer 5.09 SOL (0.045 SOL of work to do)"
set_lamports "$CRANKER" 0
set_lamports "$DEPLOYER" 5090000000
case_run "refuses a plan that would leave the deployer under 5.05 SOL" 3 "$WORK/4-floor.log" -- \
  "${FUND[@]}" --state "$WORK/again.json" --reports-dir "$WORK/reports"
expect_grep "$WORK/4-floor.log" "below the 5.050000 SOL the deploy needs" "the floor is named"

set_lamports "$DEPLOYER" 10000000
case_run "refuses when the deployer cannot pay for the plan" 3 "$WORK/5-broke.log" -- \
  "${FUND[@]}" --state "$WORK/again.json" --reports-dir "$WORK/reports"

set_lamports "$DEPLOYER" "$FUNDED_LAMPORTS"
case_run "refuses the mainnet override on a loopback RPC" 2 "$WORK/6-loopback.log" -- \
  env STOCKFLOOR_ALLOW_MAINNET=1 "$TSX" scripts/c2/fund.ts --rpc "$RPC" \
  --allow-mainnet --yes-i-am-spending-real-money --swap-provider jupiter --yes
expect_grep "$WORK/6-loopback.log" "loopback address" "the loopback refusal is explained"

case_run "refuses to swap on Jupiter against a fork" 2 "$WORK/7-jupiter.log" -- \
  "$TSX" scripts/c2/fund.ts --rpc "$RPC" --swap-provider jupiter --yes
expect_grep "$WORK/7-jupiter.log" "Jupiter has no local fork" "the provider refusal is explained"

case_run "--plan-only sends nothing" 0 "$WORK/8-plan-only.log" -- \
  "$TSX" scripts/c2/fund.ts --rpc "$RPC" --swap-provider cheat --plan-only
expect_grep "$WORK/8-plan-only.log" "nothing was sent" "plan-only says so"

# ------------------------------------------------------------------ summary

echo
echo "================================ fund fork test ================================"
for c in "${CASES[@]}"; do echo "$c"; done
echo "-------------------------------------------------------------------------------"
if [[ $FAILED -eq 0 ]]; then
  echo "ALL CASES PASSED (logs in ${WORK}/)"
else
  echo "SOME CASES FAILED (logs in ${WORK}/)"
fi
echo "The Jupiter swap path itself is NOT exercised by this test: see the header."
echo "==============================================================================="
exit $FAILED
