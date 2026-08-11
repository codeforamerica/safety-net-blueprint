#!/usr/bin/env node
/**
 * Applies an OpenAPI Overlay Specification (1.0.0) overlay to a base graph.json.
 *
 * Supports the same action verbs as the blueprint's overlay-resolver.js:
 *   update  — deep-merges the value at target (objects are spread, not replaced)
 *   replace — completely replaces the value at target
 *   add     — sets value at target only if the key does not already exist
 *   remove  — deletes the value at target
 *
 * Target paths are simple dot-notation JSONPath ($.nodes, $.edges, $.functions).
 * Filter expressions are not needed for graph overlays.
 *
 * Usage:
 *   node src/apply-overlay.js --base <graph.json> --overlay <overlay.json> --out <merged.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOverlay } from '../../contracts/src/overlay/overlay-resolver.js';
import { validateSchema } from './validate-schema.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, arr) => {
    if (v.startsWith('--')) acc.push([v.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

if (!args.base || !args.overlay || !args.out) {
  console.error('Usage: node src/apply-overlay.js --base <graph.json> --overlay <overlay.json> --out <merged.json>');
  process.exit(1);
}

const base    = JSON.parse(readFileSync(args.base,    'utf-8'));
const overlay = JSON.parse(readFileSync(args.overlay, 'utf-8'));

const overlayDir = dirname(fileURLToPath(new URL(args.overlay, import.meta.url)));
const { result, warnings } = applyOverlay(base, overlay, { overlayDir });

for (const w of warnings) console.warn(`  Warning: ${w}`);

validateSchema('graph', result, args.out);
writeFileSync(args.out, JSON.stringify(result, null, 2));
console.log(`Wrote merged graph to ${args.out}`);
