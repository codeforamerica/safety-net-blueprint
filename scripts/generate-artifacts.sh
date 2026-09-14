#!/usr/bin/env bash
# Generate all committed artifacts from source.
# Called by preflight and the pre-push hook.
#
# Artifacts produced:
#   packages/blueprint-rules-engine/dist/browser.js
#   packages/safety-net-explorer/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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
