#!/usr/bin/env bash
# The single command behind `pnpm test`.
#
#   1. build the Anchor programs (stockfloor, spike) with the repo-local program keypairs
#   2. cargo test -p stockfloor                (program unit and property tests)
#   3. tsc --noEmit for @stockfloor/sdk and @stockfloor/tests (vitest strips types, so type
#      regressions in the SDK or the fork harness would otherwise only show up at runtime)
#   4. pnpm --filter @stockfloor/sdk test      (SDK unit and property tests)
#   5. pnpm --filter @stockfloor/tests test    (LiteSVM mainnet-fork integration tests; need step 1)
#   6. pnpm --filter @stockfloor/app test      (web app unit tests)
#
# Every step runs even if an earlier one failed (except the fork tests, which are not run on a
# failed program build so they never test a stale binary). The SDK, fork and app packages are
# required: a missing package, test script or test files counts as a failure (SKIP is only
# accepted with ALLOW_SKIP=1). Prints a summary and exits non-zero if any step failed, was not
# run or was skipped without ALLOW_SKIP=1.
#
# Works with macOS bash 3.2 (no associative arrays, no `set -e`).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STEP_NAMES=()
STEP_RESULTS=()
FAILED=0
ALLOW_SKIP="${ALLOW_SKIP:-0}"

record() {
  # record <name> <PASS|FAIL|SKIP|NOT RUN> <detail>
  STEP_NAMES+=("$1")
  STEP_RESULTS+=("$(printf '%-8s %s' "$2" "$3")")
  if [[ "$2" == "FAIL" || "$2" == "NOT RUN" ]]; then
    FAILED=1
  fi
  if [[ "$2" == "SKIP" && "$ALLOW_SKIP" != "1" ]]; then
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
  # scripts/build-programs.sh copies keys/<p>-program.json into both target/deploy/ and
  # programs/<p>/target/deploy/ (Anchor 1.0.2 `build -p` reads the latter and fails with
  # "Program ID mismatch" on the random keypair it would otherwise generate there).
  # On a fresh clone keys/ does not exist; the script then builds with --ignore-keys, which
  # produces the same .so and IDL, so the test suite runs without the deploy keypairs.
  bash scripts/build-programs.sh -p "$p"
}

pnpm_package_tests() {
  # pnpm_package_tests <package name> <dir>
  local pkg="$1" dir="$2"
  if [[ ! -d "$dir" ]] || ! has_test_script "$dir"; then
    record "$pkg tests" "SKIP" "(no package or no test script in ${dir})"
    echo
    echo "==> ${pkg} tests: SKIPPED (no package or no test script in ${dir}); a failure unless ALLOW_SKIP=1"
    return 0
  fi
  if ! has_test_files "$dir"; then
    record "$pkg tests" "SKIP" "(no test files in ${dir} yet)"
    echo
    echo "==> ${pkg} tests: SKIPPED (no test files in ${dir}); a failure unless ALLOW_SKIP=1"
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

# 3. Type checks (tsc --noEmit)
run_step "typecheck @stockfloor/sdk" pnpm --filter @stockfloor/sdk exec tsc --noEmit -p tsconfig.json
run_step "typecheck @stockfloor/tests" pnpm --filter @stockfloor/tests exec tsc --noEmit -p tsconfig.json

# 4. SDK
pnpm_package_tests "@stockfloor/sdk" "packages/sdk"

# 5. Fork integration tests (use target/deploy/*.so and target/idl/*.json from step 1)
if [[ $BUILD_OK -eq 1 ]]; then
  pnpm_package_tests "@stockfloor/tests" "tests"
else
  record "@stockfloor/tests tests" "NOT RUN" "(a program build failed; refusing to test stale binaries)"
fi

# 6. Web app
pnpm_package_tests "@stockfloor/app" "app"

echo
echo "================================ test summary ================================"
for i in "${!STEP_NAMES[@]}"; do
  printf '%-32s %s\n' "${STEP_NAMES[$i]}" "${STEP_RESULTS[$i]}"
done
echo "------------------------------------------------------------------------------"
if [[ $FAILED -eq 0 ]]; then
  echo "ALL STEPS PASSED ($((SECONDS - TOTAL_START))s)"
elif [[ "$ALLOW_SKIP" != "1" ]] && printf '%s\n' "${STEP_RESULTS[@]}" | grep -q '^SKIP'; then
  echo "SOME STEPS FAILED OR WERE SKIPPED ($((SECONDS - TOTAL_START))s; set ALLOW_SKIP=1 to accept skips)"
else
  echo "SOME STEPS FAILED ($((SECONDS - TOTAL_START))s)"
fi
echo "=============================================================================="
exit $FAILED
