#!/usr/bin/env bash
# Regenerate all committed golden outputs for blueprint-harness.
#
# Run from the project root:
#   bash packages/blueprint-harness/scripts/regenerate.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HARNESS="$ROOT/packages/blueprint-harness"
CLI="$ROOT/packages/blueprint-cli/scripts"

echo "Regenerating blueprint-harness golden outputs..."

echo "  [1/6] Resolving contracts..."
node "$CLI/resolve.js" \
  --spec="$HARNESS/contracts" \
  --overlay="$HARNESS/contracts/overlays" \
  --out="$HARNESS/generated/resolved"

echo "  [2/6] Bundling contracts..."
node "$CLI/resolve.js" \
  --spec="$HARNESS/contracts" \
  --overlay="$HARNESS/contracts/overlays" \
  --out="$HARNESS/generated/bundled" \
  --bundle

echo "  [3/6] Generating TypeScript clients..."
node "$CLI/generate-ts-clients.js" \
  --spec="$HARNESS/generated/resolved" \
  --out="$HARNESS/generated/clients"

echo "  [4/6] Building explorer..."
node "$CLI/build-explorer.js" \
  --spec="$HARNESS/generated/resolved" \
  --out="$HARNESS/generated/explorer" \
  --config="$HARNESS/explorer" \
  --clients="$HARNESS/generated/clients"

echo "  [5/6] Generating Postman collection..."
node "$CLI/generate-postman-collection.js" \
  --spec="$HARNESS/generated/resolved" \
  --out="$HARNESS/generated/postman"

echo "  [6/6] Exporting JSON schemas..."
node "$CLI/export-schemas.js" \
  --spec="$HARNESS/generated/resolved" \
  --out="$HARNESS/generated/schemas"

echo "Done."
