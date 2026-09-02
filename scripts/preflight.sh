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

step "Stopping any running mock server for a clean-slate run"
lsof -ti :1080 | xargs kill -9 2>/dev/null || true
pass "Mock server stopped (or was not running)"

step "Clearing generated artifacts for a clean-slate run"
rm -rf packages/generated
pass "Cleared generated artifacts"

step "Running unit tests"
if npm run test:unit --workspaces --if-present 2>&1; then
  pass "Unit tests passed"
else
  fail "Unit tests failed"
fi
bail_if_failed

step "Resolving safety-net-contracts"
if npm run resolve 2>&1; then
  pass "Contracts resolved"
else
  fail "Contract resolution failed"
fi
bail_if_failed

step "Validating safety-net-contracts"
if npm run validate 2>&1; then
  pass "Contracts valid"
else
  fail "Contract validation failed"
fi

step "Generating TypeScript clients for resolved safety-net-contracts"
if npm run clients:typescript -- --spec=packages/generated/contracts --out=packages/generated/clients 2>&1; then
  pass "TypeScript clients generated"
else
  fail "TypeScript client generation failed"
fi
bail_if_failed

# TODO: TypeScript typecheck on generated clients — disabled until generated client
# scaffold code (from @hey-api/openapi-ts) passes strict type checking.
# step "Typechecking generated safety-net-contracts TypeScript clients"
# if npx tsc --project packages/generated/clients/tsconfig.json 2>&1; then
#   pass "TypeScript clients typecheck passed"
# else
#   fail "TypeScript clients typecheck failed"
# fi
# bail_if_failed

step "Rebuilding safety-net-explorer outputs"
if node packages/blueprint-explorer/build.js --content=packages/safety-net-explorer --resolved=packages/generated/contracts --clients=packages/generated/clients 2>&1; then
  git add packages/safety-net-explorer/
  pass "Explorer rebuilt and staged"
else
  fail "Explorer build failed"
fi
bail_if_failed

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

step "Running blueprint-mock-server functional tests"
if node packages/blueprint-mock-server/tests/run-tests.js --functional 2>&1; then
  pass "Functional tests passed"
else
  fail "Functional tests failed"
fi

step "Running blueprint-mock-server integration tests"
if node packages/blueprint-mock-server/tests/run-tests.js --integration --contracts=packages/generated/contracts --raw-contracts=packages/safety-net-contracts/src 2>&1; then
  pass "Integration tests passed"
else
  fail "Integration tests failed"
fi
bail_if_failed

step "Running safety-net-contracts integration tests"
if node packages/safety-net-contracts/tests/run-tests.js --integration --contracts=packages/generated/contracts --seed=packages/safety-net-contracts/tests/integration/seed --clients=packages/generated/clients --stop 2>&1; then
  pass "Integration tests passed"
else
  fail "Integration tests failed"
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
