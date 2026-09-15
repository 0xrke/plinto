#!/usr/bin/env bash
# Run a Surfpool helper script with tsx from the @stockfloor/tests package (its dependencies).
#
#   bash scripts/surfpool/run.sh deploy-local [--rpc http://127.0.0.1:8899] [...]
#   bash scripts/surfpool/run.sh fund <wallet> [--sol 10] [--token SPYx --amount 5]
#   bash scripts/surfpool/run.sh smoke [--rpc ...]
#
# Equivalent: pnpm --filter @stockfloor/tests exec tsx ../scripts/surfpool/<name>.ts [...]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ $# -lt 1 ]]; then
  sed -n '2,8p' "$0"
  exit 2
fi
NAME="${1%.ts}"
shift
SCRIPT="$ROOT/scripts/surfpool/${NAME}.ts"
[[ -f "$SCRIPT" ]] || { echo "no such script: $SCRIPT" >&2; exit 2; }
TSX="$ROOT/tests/node_modules/.bin/tsx"
[[ -x "$TSX" ]] || { echo "tsx not found at $TSX (run pnpm install)" >&2; exit 1; }
exec "$TSX" "$SCRIPT" "$@"
