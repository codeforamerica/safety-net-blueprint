#!/usr/bin/env node
/**
 * Data dictionary explorer (STUB).
 *
 * Example of an explorer-module script meant to be run by a downstream
 * consumer (e.g. cbms-steel-thread) against that consumer's *unresolved*
 * Blueprint contracts plus its own overlay — the same two inputs the
 * resolve script takes. For now this is a stub: it only resolves and
 * prints the two paths so a consumer can confirm the wiring end to end.
 * Real data-dictionary logic will replace the body later.
 *
 * Usage:
 *   node scripts/data-dictionary.js --spec=./contracts --overlay=./overlays
 *
 * Flags:
 *   --spec     Path to the unresolved Blueprint contracts dir/file (required)
 *   --overlay  Path to the overlay file/dir (optional)
 *   --help     Show this help
 */

import { resolve } from 'node:path';

function parseArgs() {
  const options = { spec: null, overlay: null, help: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--spec=')) options.spec = arg.slice('--spec='.length);
    else if (arg.startsWith('--overlay=')) options.overlay = arg.slice('--overlay='.length);
  }
  return options;
}

const HELP = `data-dictionary (stub) — print the unresolved contracts + overlay paths.

Usage:
  node scripts/data-dictionary.js --spec=<contracts dir> [--overlay=<overlay dir/file>]

Flags:
  --spec     Path to the unresolved Blueprint contracts dir/file (required)
  --overlay  Path to the overlay file/dir (optional)
  --help     Show this help`;

function main() {
  const { spec, overlay, help } = parseArgs();

  if (help) {
    console.log(HELP);
    return;
  }

  if (!spec) {
    console.error(
      'Error: --spec is required (path to the unresolved Blueprint contracts).'
    );
    process.exitCode = 1;
    return;
  }

  console.log('Blueprint contracts data dir: ' + resolve(spec));
  console.log(
    'Overlay file:                 ' +
      (overlay ? resolve(overlay) : '(none provided)')
  );
}

main();
