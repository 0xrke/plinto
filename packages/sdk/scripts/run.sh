#!/usr/bin/env bash
# Run an SDK CLI script with the SDK package's tsx.
#
#   bash packages/sdk/scripts/run.sh create-launch --keypair keys/cli-creator.json --name ... --symbol ...
#   bash packages/sdk/scripts/run.sh buy|sell|redeem|crank|status [flags]
#
# Equivalent: pnpm --filter @stockfloor/sdk exec tsx scripts/<name>.ts [flags]
# Keypairs must live under the repo keys/ directory. Sending commands refuse any RPC that is not a
# local cluster (see packages/sdk/src/guard.ts and packages/sdk/scripts/README.md).
set -euo pipefail
SDK="$(cd "$(dirname "$0")/.." && pwd)"
if [[ $# -lt 1 ]]; then
  sed -n '2,9p' "$0"
  exit 2
fi
NAME="${1%.ts}"
shift
SCRIPT="$SDK/scripts/${NAME}.ts"
[[ -f "$SCRIPT" ]] || { echo "no such script: $SCRIPT" >&2; exit 2; }
cd "$SDK/../.."
exec "$SDK/node_modules/.bin/tsx" "$SCRIPT" "$@"
