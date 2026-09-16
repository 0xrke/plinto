#!/usr/bin/env bash
# Seed a local Surfpool mainnet fork with the four launches the README screenshots show, using only
# the repo's own SDK CLI scripts and the keypairs under keys/. Nothing here can reach mainnet: every
# sending script refuses an RPC that is not a loopback local cluster or Surfpool surfnet.
#
#   bash app/scripts/seed-fork.sh                      # starts/reuses the surfnet on RPC_PORT (28899)
#   RPC_PORT=8899 bash app/scripts/seed-fork.sh        # another instance
#   SKIP_UP=1 bash app/scripts/seed-fork.sh            # surfnet already up and funded
#
# Takes a few minutes. Afterwards, build and serve the app against the same RPC and run
# `pnpm --filter @stockfloor/app screenshots` (see app/README.md, "Screenshots").
#
# What it creates (newest first, which is the order the launch list shows):
#   Kestrel Outfitters  KSTL  flat   70% vault  $100    graduated, cranked, traded on DAMM v2
#   Cedar Ridge Records CDRR  flat   60% vault  $100    presale, about 72% filled
#   Northwind Labs      NWND  gentle 50% vault  $1,000  presale, about 51% filled
#   Harbor Roasters     HRBR  gentle 50% vault  $1,000  graduated, cranked, traded, one redemption
#
# Amounts are in the quote asset (SPYx) and are deliberately generous: a buy that would cross the
# migration price becomes a DBC PartialFill, so the exact live SPYx price only moves the USD figures,
# never the shape of the result.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RPC_PORT="${RPC_PORT:-28899}"
RPC="${RPC_URL:-http://127.0.0.1:${RPC_PORT}}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/stockfloor-seed.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

CREATOR="$ROOT/keys/cli-creator.json"
BUYER1="$ROOT/keys/cli-buyer1.json"
BUYER2="$ROOT/keys/cli-buyer2.json"
CRANKER="$ROOT/keys/cli-cranker.json"
for k in "$CREATOR" "$BUYER1" "$BUYER2" "$CRANKER"; do
  [[ -f "$k" ]] || { echo "missing $k — keys/ is gitignored; generate the CLI keypairs first" >&2; exit 1; }
done

sdk() { bash "$ROOT/packages/sdk/scripts/run.sh" "$@" --rpc "$RPC"; }
pubkey() {
  node -e 'const{Keypair}=require(process.argv[1]+"/tests/node_modules/@solana/web3.js");
    console.log(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(require("fs").readFileSync(process.argv[2],"utf8")))).publicKey.toBase58());' \
    "$ROOT" "$1"
}
# The base mint of a launch, from the report `create-launch --out` writes.
mint_of() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).addresses.baseMint);' "$1"; }

if [[ "${SKIP_UP:-}" != "1" ]]; then
  echo "== surfnet on $RPC (mainnet fork, deploy, funding) =="
  FUND_WALLETS="$(pubkey "$CREATOR") $(pubkey "$BUYER1") $(pubkey "$BUYER2") $(pubkey "$CRANKER")" \
    FUND_SOL="${FUND_SOL:-10}" FUND_SPYX="${FUND_SPYX:-12}" RPC_PORT="$RPC_PORT" \
    bash "$ROOT/scripts/surfpool/up.sh" > "$WORK/up.log" 2>&1 ||
    { tail -30 "$WORK/up.log" >&2; echo "surfpool up failed" >&2; exit 1; }
fi

create() { # name symbol slug preset vault-share threshold-usd first-buy; prints the base mint
  echo "== $1 (\$$2) ==" >&2
  sdk create-launch --keypair "$CREATOR" --name "$1" --symbol "$2" \
    --uri "https://example.com/$3.json" --quote SPYx --preset "$4" --vault-share "$5" \
    --threshold-usd "$6" --exit-fee-bps 200 --first-buy "$7" --out "$WORK/$3.json" > "$WORK/$3.log"
  mint_of "$WORK/$3.json"
}

# 1. Harbor Roasters: the default shape ($1,000, gentle, 50%), taken all the way to a live floor.
HRBR="$(create "Harbor Roasters" HRBR harbor-roasters gentle 50 1000 0.12)"
sdk buy   --keypair "$BUYER1"  --mint "$HRBR" --amount 0.5 > /dev/null
sdk buy   --keypair "$BUYER2"  --mint "$HRBR" --amount 0.35 > /dev/null
sdk sell  --keypair "$BUYER1"  --mint "$HRBR" --raw 30000000000000 > /dev/null
sdk crank --keypair "$CRANKER" --mint "$HRBR" > /dev/null            # curve fees into the vault
sdk buy   --keypair "$BUYER2"  --mint "$HRBR" --amount 0.8 > /dev/null   # PartialFill completes the curve
sdk crank --keypair "$CRANKER" --mint "$HRBR" > /dev/null            # migration fee, surplus, migrate, latch
sdk buy   --keypair "$BUYER1"  --mint "$HRBR" --amount 0.45 > /dev/null  # DAMM v2 from here on
sdk sell  --keypair "$BUYER2"  --mint "$HRBR" --raw 60000000000000 > /dev/null
sdk buy   --keypair "$CRANKER" --mint "$HRBR" --amount 0.2 > /dev/null
sdk crank --keypair "$CRANKER" --mint "$HRBR" > /dev/null            # LP fees raise the floor
sdk redeem --keypair "$BUYER2" --mint "$HRBR" --raw 40000000000000 > /dev/null
sdk sell  --keypair "$BUYER1"  --mint "$HRBR" --raw 90000000000000 > /dev/null  # back near the graduation price
sdk crank --keypair "$CRANKER" --mint "$HRBR" > /dev/null

# 2. Northwind Labs: a $1,000 presale about halfway to graduation.
NWND="$(create "Northwind Labs" NWND northwind-labs gentle 50 1000 0.1)"
sdk buy --keypair "$BUYER1" --mint "$NWND" --amount 0.35 > /dev/null
sdk buy --keypair "$BUYER2" --mint "$NWND" --amount 0.22 > /dev/null

# 3. Cedar Ridge Records: a small $100 presale, flat curve, most of the way there.
CDRR="$(create "Cedar Ridge Records" CDRR cedar-ridge-records flat 60 100 0.02)"
sdk buy --keypair "$BUYER2" --mint "$CDRR" --amount 0.055 > /dev/null
sdk buy --keypair "$BUYER1" --mint "$CDRR" --amount 0.02 > /dev/null

# 4. Kestrel Outfitters: a 70% vault share, so the floor is about half the graduation price.
KSTL="$(create "Kestrel Outfitters" KSTL kestrel-outfitters flat 70 100 0.025)"
sdk buy   --keypair "$BUYER1"  --mint "$KSTL" --amount 0.06 > /dev/null
sdk buy   --keypair "$BUYER2"  --mint "$KSTL" --amount 0.15 > /dev/null
sdk crank --keypair "$CRANKER" --mint "$KSTL" > /dev/null
sdk buy   --keypair "$BUYER1"  --mint "$KSTL" --amount 0.03 > /dev/null
sdk sell  --keypair "$BUYER2"  --mint "$KSTL" --raw 8000000000000 > /dev/null
sdk crank --keypair "$CRANKER" --mint "$KSTL" > /dev/null
sdk sell  --keypair "$BUYER1"  --mint "$KSTL" --raw 90000000000000 > /dev/null
sdk crank --keypair "$CRANKER" --mint "$KSTL" > /dev/null

echo "== final crank across every launch =="
sdk crank --keypair "$CRANKER" | grep -E "executed|nothing due" || true

echo
for entry in "KSTL:$KSTL" "CDRR:$CDRR" "NWND:$NWND" "HRBR:$HRBR"; do
  printf '%s\t%s\t' "${entry%%:*}" "${entry#*:}"
  sdk status --mint "${entry#*:}" --json |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);
      console.log(`${l.phase}\t${l.progress}\tvault ${l.vaultRaw}`);});'
done
echo
echo "seeded on $RPC — now build and serve the app against it, then: pnpm --filter @stockfloor/app screenshots"
