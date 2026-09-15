#!/usr/bin/env bash
# Build all Anchor programs with the repo-local program keypairs (keys/ is gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p target/deploy
for p in stockfloor spike; do
  if [[ -f "keys/${p}-program.json" && -d "programs/${p}" ]]; then
    cp "keys/${p}-program.json" "target/deploy/${p}-keypair.json"
  fi
done
anchor build "$@"
