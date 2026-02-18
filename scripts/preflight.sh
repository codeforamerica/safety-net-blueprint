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

step "Validating OpenAPI specs (syntax + patterns)"
if npm run validate 2>&1; then
  pass "Specs valid"
else
  fail "Spec validation failed"
fi

step "Running Spectral lint"
if npx spectral lint 'packages/contracts/*-openapi.yaml' --ignore-unknown-format 2>&1; then
  pass "Spectral lint passed"
else
  fail "Spectral lint failed"
fi

step "Running unit tests"
if npm test 2>&1; then
  pass "Unit tests passed"
else
  fail "Unit tests failed"
fi

step "Resolving example overlay"
if npm run overlay:resolve 2>&1; then
  pass "Overlay resolution succeeded"
else
  fail "Overlay resolution failed"
fi

step "Generating Postman collection"
if npm run postman:generate 2>&1; then
  pass "Postman collection generated"
else
  fail "Postman collection generation failed"
fi

step "Checking design reference is up to date"
npm run design:reference 2>&1 || true
if git diff --quiet docs/schema-reference.html 2>/dev/null; then
  pass "Design reference is up to date"
else
  fail "Design reference is out of date — run 'npm run design:reference' and commit the result"
fi

step "Running integration tests (starting mock server)"
MOCK_PID=""
cleanup() {
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Kill any orphaned mock server from a previous run
lsof -ti :1080 | xargs kill -9 2>/dev/null || true
sleep 1

npm run mock:start 2>&1 &
MOCK_PID=$!

# Wait for server to be ready
retries=0
max_retries=15
while ! curl -sf http://localhost:1080/persons > /dev/null 2>&1; do
  retries=$((retries + 1))
  if [ "$retries" -ge "$max_retries" ]; then
    fail "Mock server failed to start"
    MOCK_PID=""
    break
  fi
  sleep 1
done

if [ "$retries" -lt "$max_retries" ]; then
  if npm run test:integration 2>&1; then
    pass "Integration tests passed"
  else
    fail "Integration tests failed"
  fi
fi

# Stop mock server
cleanup
MOCK_PID=""

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
