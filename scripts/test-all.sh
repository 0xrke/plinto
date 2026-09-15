#!/usr/bin/env bash
# The single command behind `pnpm test`.
#
#   1. build the Anchor programs (stockfloor, spike) with the repo-local program keypairs
#   2. cargo test -p stockfloor                (program unit and property tests)
#   3. pnpm --filter @stockfloor/sdk test      (SDK unit and property tests)
#   4. pnpm --filter @stockfloor/tests test    (LiteSVM mainnet-fork integration tests; need step 1)
#   5. pnpm --filter @stockfloor/app test      (web app unit tests)
#
# Every step runs even if an earlier one failed (except the fork tests, which are not run on a
# failed program build so they never test a stale binary). A package without any test files is
# skipped with a note. Prints a summary and exits non-zero if any step failed or was not run.
#
# Works with macOS bash 3.2 (no associative arrays, no `set -e`).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STEP_NAMES=()
STEP_RESULTS=()
FAILED=0

record() {
  # record <name> <PASS|FAIL|SKIP|NOT RUN> <detail>
  STEP_NAMES+=("$1")
  STEP_RESULTS+=("$(printf '%-8s %s' "$2" "$3")")
  if [[ "$2" == "FAIL" || "$2" == "NOT RUN" ]]; then
    FAILED=1
  fi
}

run_step() {
  # run_step <name> <command...>; returns the command's exit code
  local name="$1"
  shift
  echo
  echo "==> ${name}"
  echo "    \$ $*"
  local start=$SECONDS
  "$@"
  local code=$?
  local secs=$((SECONDS - start))
  if [[ $code -eq 0 ]]; then
    record "$name" "PASS" "(${secs}s)"
  else
    record "$name" "FAIL" "(exit ${code}, ${secs}s)"
    echo "!! ${name} failed with exit code ${code}"
  fi
  return $code
}

# True if <dir> contains at least one *.test.* / *.spec.* file outside node_modules and build output.
has_test_files() {
  local found
  found="$(find "$1" \( -name node_modules -o -name .next -o -name target -o -name dist \) -prune -o \
    -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \) -print 2>/dev/null | head -n 1)"
  [[ -n "$found" ]]
}

# True if <dir>/package.json defines a "test" script.
has_test_script() {
  [[ -f "$1/package.json" ]] &&
    node -e 'process.exit(require(process.argv[1]).scripts?.test ? 0 : 1)' "$ROOT/$1/package.json"
}

build_program() {
  local p="$1"
  if [[ ! -f "keys/${p}-program.json" ]]; then
    echo "missing keys/${p}-program.json: the repo-local program keypair (gitignored) is required to build ${p}"
    return 1
  fi
  # `anchor build -p <p>` (Anchor 1.0.2) also reads programs/<p>/target/deploy/<p>-keypair.json and
  # fails with "Program ID mismatch" when it generates a random one there; keep it in sync
  # (gitignored). scripts/build-programs.sh copies the key into target/deploy/.
  mkdir -p "programs/${p}/target/deploy"
  cp "keys/${p}-program.json" "programs/${p}/target/deploy/${p}-keypair.json"
  bash scripts/build-programs.sh -p "$p"
}

pnpm_package_tests() {
  # pnpm_package_tests <package name> <dir>
  local pkg="$1" dir="$2"
  if [[ ! -d "$dir" ]] || ! has_test_script "$dir"; then
    record "$pkg tests" "SKIP" "(no package or no test script in ${dir})"
    echo
    echo "==> ${pkg} tests: skipped (no package or no test script in ${dir})"
    return 0
  fi
  if ! has_test_files "$dir"; then
    record "$pkg tests" "SKIP" "(no test files in ${dir} yet)"
    echo
    echo "==> ${pkg} tests: skipped (no test files in ${dir} yet)"
    return 0
  fi
  run_step "$pkg tests" pnpm --filter "$pkg" test
}

TOTAL_START=$SECONDS

# 1. Programs
BUILD_OK=1
for p in stockfloor spike; do
  if [[ -d "programs/${p}" ]]; then
    run_step "build program ${p}" build_program "$p" || BUILD_OK=0
  fi
done

# 2. Program unit tests
run_step "cargo test -p stockfloor" cargo test -p stockfloor

# 3. SDK
pnpm_package_tests "@stockfloor/sdk" "packages/sdk"

# 4. Fork integration tests (use target/deploy/*.so and target/idl/*.json from step 1)
if [[ $BUILD_OK -eq 1 ]]; then
  pnpm_package_tests "@stockfloor/tests" "tests"
else
  record "@stockfloor/tests tests" "NOT RUN" "(a program build failed; refusing to test stale binaries)"
fi

# 5. Web app
pnpm_package_tests "@stockfloor/app" "app"

echo
echo "================================ test summary ================================"
for i in "${!STEP_NAMES[@]}"; do
  printf '%-32s %s\n' "${STEP_NAMES[$i]}" "${STEP_RESULTS[$i]}"
done
echo "------------------------------------------------------------------------------"
if [[ $FAILED -eq 0 ]]; then
  echo "ALL STEPS PASSED ($((SECONDS - TOTAL_START))s)"
else
  echo "SOME STEPS FAILED ($((SECONDS - TOTAL_START))s)"
fi
echo "=============================================================================="
exit $FAILED
