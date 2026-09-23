#!/usr/bin/env bash
set -uo pipefail

# Preflight check — run before creating a PR to verify everything works.

# Tee all output to a log file for post-run diagnosis.
PREFLIGHT_LOG=/tmp/preflight.log
exec > >(tee "$PREFLIGHT_LOG") 2>&1
echo "Logging to $PREFLIGHT_LOG"
echo

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

passed=0
failed=0
failures=()

step() {
  printf "\n${BOLD}▸ %s${RESET} [%s]\n" "$1" "$(date +%H:%M:%S)"
}

pass() {
  printf "${GREEN}  ✓ %s${RESET}\n" "$1"
  passed=$((passed + 1))
}

fail() {
  printf "${RED}  ✗ %s${RESET}\n" "$1"
  failed=$((failed + 1))
  failures+=("$1")
}

# Stop immediately if a prior step failed — do not continue to later steps.
# Fix the reported failure before re-running preflight.
bail_if_failed() {
  if [ "$failed" -gt 0 ]; then
    printf "\n${RED}${BOLD}Stopping — fix the failure above before continuing.${RESET}\n"
    printf "${RED}  ✗ %s${RESET}\n" "${failures[${#failures[@]}-1]}"
    exit 1
  fi
}

step "Clearing generated artifacts for a clean-slate run"
rm -rf packages/generated
pass "Cleared generated artifacts"

step "Generating committed artifacts (contracts, clients, browser bundle, explorer)"
if bash scripts/generate-artifacts.sh 2>&1; then
  pass "Artifacts generated"
else
  fail "Artifact generation failed"
fi
bail_if_failed

step "Checking committed artifacts are up to date"
if git diff HEAD --exit-code packages/blueprint-rules-engine/dist/browser.js packages/safety-net-explorer/ > /dev/null 2>&1; then
  pass "Committed artifacts are up to date"
else
  fail "Generated artifacts are out of date — run \`bash scripts/generate-artifacts.sh --commit\` or commit them manually, then re-run preflight."
fi
bail_if_failed

step "Checking vendored dependencies"
node packages/blueprint-rules-engine/scripts/check-vendor.js
pass "Vendor check complete"

# Runs before the suites, not after: a test script that matches nothing still
# exits 0, so "all tests passed" means nothing until every test file on disk is
# known to be reachable.
step "Checking test discovery"
if node tests/check-test-discovery.js 2>&1; then
  pass "Every test file is reachable"
else
  fail "Test files exist that no test script runs"
fi
bail_if_failed

step "Running all tests"
if npm test --workspace=packages/blueprint-core \
            --workspace=packages/blueprint-cli \
            --workspace=packages/blueprint-rules-engine \
            --workspace=packages/blueprint-explorer 2>&1; then
  pass "All tests passed"
else
  fail "Tests failed"
fi
bail_if_failed

step "Validating safety-net-contracts"
if npm run validate 2>&1; then
  pass "Contracts valid"
else
  fail "Contract validation failed"
fi

# TODO: TypeScript typecheck on generated clients — disabled until generated client
# scaffold code (from @hey-api/openapi-ts) passes strict type checking.
# step "Typechecking generated safety-net-contracts TypeScript clients"
# if npx tsc --project packages/generated/clients/tsconfig.json 2>&1; then
#   pass "TypeScript clients typecheck passed"
# else
#   fail "TypeScript clients typecheck failed"
# fi
# bail_if_failed

step "Validating safety-net-contracts mock data"
if npm run validate:mock-data 2>&1; then
  pass "Mock data valid"
else
  fail "Mock data validation failed"
fi

step "Generating Postman collection"
if npm run postman:generate 2>&1; then
  pass "Postman collection generated"
else
  fail "Postman collection generation failed"
fi

step "Stopping any running mock server for a clean-slate run"
lsof -ti :1080 | xargs kill -9 2>/dev/null || true
pass "Mock server stopped (or was not running)"

step "Running blueprint-mock-server tests"
if node packages/blueprint-mock-server/tests/run-tests.js --all --contracts=packages/generated/contracts --raw-contracts=packages/safety-net-contracts/src --stop 2>&1; then
  pass "Tests passed"
else
  fail "Tests failed"
fi
bail_if_failed

step "Running safety-net-contracts tests"
if node packages/safety-net-contracts/tests/run-tests.js --all --contracts=packages/generated/contracts --seed=packages/safety-net-contracts/tests/integration/seed --clients=packages/generated/clients --stop 2>&1; then
  pass "Tests passed"
else
  fail "Tests failed"
fi

step "Checking package contents"
if node tests/check-package-contents.js 2>&1; then
  pass "Package contents verified"
else
  fail "Package contents check failed"
fi

step "Checking changeset config"
if node --test tests/check-changeset-config.js 2>&1; then
  pass "Changeset config valid"
else
  fail "Changeset config check failed"
fi

# Summary
printf "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
if [ "$failed" -eq 0 ]; then
  printf "${GREEN}${BOLD}Preflight passed${RESET} — %d checks, 0 failures\n" "$passed"
  printf "Ready to create PR.\n"
else
  printf "${RED}${BOLD}Preflight failed${RESET} — %d passed, %d failed\n" "$passed" "$failed"
  printf "\n"
  for f in "${failures[@]}"; do
    printf "${RED}  ✗ %s${RESET}\n" "$f"
  done
  exit 1
fi
