#!/usr/bin/env bash
# Build Anchor programs with the repo-local program keypairs (keys/ is gitignored).
# Usage: scripts/build-programs.sh [-p <program>] [extra anchor build args]
# anchor 1.0.2 reads the keypair from programs/<p>/target/deploy when building with -p,
# and from target/deploy otherwise, so the keypair is copied to both places.
#
# A fresh clone has no keys/ (it is gitignored and holds the deploy keypairs). The build itself
# does not need them: only anchor's program-id check does, so it is skipped with --ignore-keys.
# The built .so and IDL are identical either way, so `pnpm test` works on a fresh clone.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p target/deploy
ignore_keys=""
for p in stockfloor spike; do
  [[ -d "programs/${p}" ]] || continue
  if [[ -f "keys/${p}-program.json" ]]; then
    mkdir -p "programs/${p}/target/deploy"
    cp "keys/${p}-program.json" "target/deploy/${p}-keypair.json"
    cp "keys/${p}-program.json" "programs/${p}/target/deploy/${p}-keypair.json"
  else
    echo "note: keys/${p}-program.json is missing (fresh clone); building with --ignore-keys" >&2
    ignore_keys="--ignore-keys"
  fi
done
anchor build ${ignore_keys} "$@"
