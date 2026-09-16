#!/usr/bin/env bash
# Generate or check committed artifacts.
#
# Usage:
#   generate-artifacts.sh             — generate all artifacts
#   generate-artifacts.sh --check-only — check if artifacts are dirty; stage them if so
#   generate-artifacts.sh --commit     — stage and commit regenerated artifacts
#
# Artifacts:
#   packages/blueprint-rules-engine/dist/browser.js
#   packages/safety-net-explorer/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ARTIFACTS=(
  packages/blueprint-rules-engine/dist/browser.js
  packages/safety-net-explorer/
)

if [ "${1:-}" = "--check-only" ]; then
  if ! git diff HEAD --exit-code "${ARTIFACTS[@]}" > /dev/null 2>&1; then
    git add "${ARTIFACTS[@]}"
    exit 1
  fi
  exit 0
fi

if [ "${1:-}" = "--commit" ]; then
  git add "${ARTIFACTS[@]}"
  git commit -m "Commit regenerated artifacts"
  exit 0
fi

echo "Resolving safety-net-contracts..."
npm run resolve --prefix "$ROOT" 2>&1

echo "Generating TypeScript clients..."
npm run clients:typescript --prefix "$ROOT" -- \
  --spec="$ROOT/packages/generated/contracts" \
  --out="$ROOT/packages/generated/clients" 2>&1

echo "Rebuilding rules-engine browser bundle..."
node "$ROOT/packages/blueprint-rules-engine/scripts/build-browser.js" 2>&1

echo "Rebuilding safety-net-explorer outputs..."
node "$ROOT/packages/blueprint-explorer/build.js" \
  --content="$ROOT/packages/safety-net-explorer" \
  --resolved="$ROOT/packages/generated/contracts" \
  --clients="$ROOT/packages/generated/clients" 2>&1
