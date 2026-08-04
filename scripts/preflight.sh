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
rm -rf packages/resolved
rm -rf packages/mock-server/tests/integration/generated
rm -rf packages/mock-server/tests/functional/resolved
rm -rf packages/mock-server/tests/functional/generated
pass "Cleared packages/resolved, tests/integration/generated, and functional resolved/generated"

step "Validating base specs"
if npm run validate 2>&1; then
  pass "Base specs valid"
else
  fail "Base spec validation failed"
fi
bail_if_failed

step "Running unit tests"
if npm test 2>&1; then
  pass "Unit tests passed"
else
  fail "Unit tests failed"
fi
bail_if_failed

step "Resolving example overlay"
if npm run resolve 2>&1; then
  pass "Overlay resolution succeeded"
else
  fail "Overlay resolution failed"
fi

step "Validating sequence diagram config files"
if node packages/explorer/diagrams/sequence-diagrams/src/validate-config.js 2>&1; then
  pass "Sequence diagram config valid"
else
  fail "Sequence diagram config validation failed"
fi
bail_if_failed

step "Validating resolved specs"
if npm run validate:resolved 2>&1; then
  pass "Resolved specs valid"
else
  fail "Resolved spec validation failed"
fi

step "Generating TypeScript clients from resolved specs"
if npm run clients:typescript -- --spec=packages/resolved --out=packages/clients/generated 2>&1; then
  git add packages/clients/generated/
  pass "TypeScript clients generated and staged"
else
  fail "TypeScript client generation failed"
fi
bail_if_failed

step "Rebuilding explorer outputs"
if npm run build --workspace=packages/explorer 2>&1; then
  git add packages/explorer/
  pass "Explorer rebuilt and staged"
else
  fail "Explorer build failed"
fi
bail_if_failed

step "Validating seed data"
if npm run validate:seed 2>&1; then
  pass "Seed data valid"
else
  fail "Seed data validation failed"
fi

step "Generating Postman collection"
if npm run postman:generate 2>&1; then
  pass "Postman collection generated"
else
  fail "Postman collection generation failed"
fi

step "Running functional tests"
# Kill any orphaned mock server from a previous run
lsof -ti :1080 | xargs kill -9 2>/dev/null || true

if node packages/mock-server/tests/run-all-tests.js --functional 2>&1; then
  pass "Functional tests passed"
else
  fail "Functional tests failed"
fi

step "Running integration tests"
# Kill any orphaned mock server from a previous run
lsof -ti :1080 | xargs kill -9 2>/dev/null || true

if npm run test:integration 2>&1; then
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
