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
if npm run resolve 2>&1; then
  pass "Overlay resolution succeeded"
else
  fail "Overlay resolution failed"
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

step "Checking design reference is up to date"
cp docs/schema-reference.html /tmp/design-ref-before.html 2>/dev/null || true
npm run design:reference 2>&1 || true
if diff -q docs/schema-reference.html /tmp/design-ref-before.html >/dev/null 2>&1; then
  pass "Design reference is up to date"
else
  fail "Design reference was out of date — it has been regenerated. Stage the updated file and re-run preflight."
fi
rm -f /tmp/design-ref-before.html

step "Checking contract tables are up to date"
cp -r docs/contract-tables /tmp/contract-tables-before 2>/dev/null || true
npm run contract-tables:export 2>&1 || true
if diff -rq docs/contract-tables /tmp/contract-tables-before >/dev/null 2>&1; then
  pass "Contract tables are up to date"
else
  fail "Contract tables were out of date — they have been regenerated. Stage the updated files and re-run preflight."
fi
rm -rf /tmp/contract-tables-before

step "Checking YAML contracts reflect current CSV tables"
tmpYamlBefore=$(mktemp -d)
cp packages/contracts/*-state-machine.yaml "$tmpYamlBefore/" 2>/dev/null || true
cp packages/contracts/*-rules.yaml "$tmpYamlBefore/" 2>/dev/null || true
cp packages/contracts/*-metrics.yaml "$tmpYamlBefore/" 2>/dev/null || true
if npm run contract-tables:import 2>&1; then
  yamlChanged=0
  for f in packages/contracts/*-state-machine.yaml packages/contracts/*-rules.yaml packages/contracts/*-metrics.yaml; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    if [ -f "$tmpYamlBefore/$base" ] && ! diff -q "$f" "$tmpYamlBefore/$base" >/dev/null 2>&1; then
      yamlChanged=1
      break
    fi
  done
  if [ "$yamlChanged" -eq 0 ]; then
    pass "YAML contracts are up to date with CSV tables"
  else
    fail "CSV tables have unimported changes — YAML contracts have been updated. Stage the updated files and re-run preflight."
  fi
else
  fail "Contract table import failed"
fi
rm -rf "$tmpYamlBefore"

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
