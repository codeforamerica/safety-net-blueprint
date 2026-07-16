#!/usr/bin/env bash
set -uo pipefail

# Preflight check — run before creating a PR to verify everything works.

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

passed=0
failed=0
failures=()

step() {
  printf "\n${BOLD}▸ %s${RESET}\n" "$1"
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
    printf "${RED}  ✗ %s${RESET}\n" "${failures[-1]}"
    exit 1
  fi
}

step "Checking explorer outputs are up to date"
if ! git diff --exit-code packages/explorer/ > /dev/null 2>&1 || git ls-files --others --exclude-standard packages/explorer/ | grep -q .; then
  printf "${RED}  ✗ Explorer outputs are stale — rebuild and stage before running preflight:${RESET}\n"
  printf "      npm run build --workspace=packages/explorer\n"
  printf "      git add packages/explorer/\n"
  git diff --name-only packages/explorer/
  git ls-files --others --exclude-standard packages/explorer/
  exit 1
else
  pass "Explorer outputs are up to date"
fi

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

step "Validating resolved specs"
if npm run validate:resolved 2>&1; then
  pass "Resolved specs valid"
else
  fail "Resolved spec validation failed"
fi

step "Validating client generation"
if npm run clients:typescript -- --spec=packages/resolved --out=/tmp/preflight-clients-check 2>&1; then
  rm -rf /tmp/preflight-clients-check
  pass "Client generation succeeded"
else
  rm -rf /tmp/preflight-clients-check
  fail "Client generation failed"
fi

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
