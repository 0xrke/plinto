#!/usr/bin/env bash
# Build Anchor programs with the repo-local program keypairs (keys/ is gitignored).
# Usage: scripts/build-programs.sh [-p <program>] [extra anchor build args]
# anchor 1.0.2 reads the keypair from programs/<p>/target/deploy when building with -p,
# and from target/deploy otherwise, so the keypair is copied to both places.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p target/deploy
for p in stockfloor spike; do
  if [[ -f "keys/${p}-program.json" && -d "programs/${p}" ]]; then
    mkdir -p "programs/${p}/target/deploy"
    cp "keys/${p}-program.json" "target/deploy/${p}-keypair.json"
    cp "keys/${p}-program.json" "programs/${p}/target/deploy/${p}-keypair.json"
  fi
done
anchor build "$@"
