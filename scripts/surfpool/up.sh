#!/usr/bin/env bash
# One command for the web app / e2e runs: start a local mainnet-fork surfnet (or reuse the running
# one), install the mainnet token program ELFs, deploy target/deploy/stockfloor.so, and optionally
# fund wallets with SOL and SPYx.
#
#   bash scripts/surfpool/up.sh
#   FUND_WALLETS="<pubkey> <pubkey>" FUND_SOL=10 FUND_SPYX=25 bash scripts/surfpool/up.sh
#   RPC_PORT=9899 bash scripts/surfpool/up.sh      # second instance (WS 9900, studio 19488)
#
# Same environment as start.sh (RPC_PORT, WS_PORT, STUDIO_PORT, MAINNET_RPC_URL, ...). Surfnet state
# is in memory: after a restart run this again (deploys are not persisted).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RPC_PORT="${RPC_PORT:-8899}"
RPC_URL="http://127.0.0.1:${RPC_PORT}"
export RPC_PORT
if [[ -n "${WS_PORT:-}" ]]; then
  export SURFPOOL_WS_URL="ws://127.0.0.1:${WS_PORT}"
fi

bash "$ROOT/scripts/surfpool/start.sh"
bash "$ROOT/scripts/surfpool/run.sh" deploy-local --rpc "$RPC_URL" --mainnet-token-programs

for w in ${FUND_WALLETS:-}; do
  bash "$ROOT/scripts/surfpool/run.sh" fund "$w" --rpc "$RPC_URL" --sol "${FUND_SOL:-10}" --token SPYx --amount "${FUND_SPYX:-10}"
done

echo "surfnet up: rpc $RPC_URL (stop with RPC_PORT=$RPC_PORT bash scripts/surfpool/stop.sh)"
