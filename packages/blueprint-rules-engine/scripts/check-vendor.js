#!/usr/bin/env node
/**
 * Check that vendor/fg.js is still the build we have recorded.
 *
 * Computes the SHA-256 of the file (excluding the header comment we added) and
 * compares it to the hash below.
 *
 * This is a local check. It does not contact GitHub and cannot tell you
 * whether the IRS has published a newer FactGraph — a mismatch means the file
 * in this repository is not the one the recorded provenance describes.
 *
 * Git already shows that the file changed. What this adds is that the file and
 * the metadata about it have to move together: the upstream commit in the
 * header of vendor/fg.js, the hash below, and the results in CONFORMANCE.md
 * all describe a specific build, and a silent swap would leave all three
 * describing bytes that are no longer there.
 *
 * Always exits 0 so preflight is not blocked.
 *
 * Usage: node packages/blueprint-rules-engine/scripts/check-vendor.js
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vendorPath = join(__dirname, '../vendor/fg.js');

// SHA-256 of fg.js before our header comment was prepended, and the upstream
// commit the build came from. Both are repeated in the header of vendor/fg.js;
// update all of them together when the bundle is replaced.
const RECORDED_SHA = '8033fc086c45f0d7748dfe7a6fe0c3a6f6864ee3227c2640c806b59eabdfc621';
const RECORDED_COMMIT = 'e0d5c8445';

const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let raw;
try {
  raw = readFileSync(vendorPath, 'utf8');
} catch {
  console.error(`Could not read ${vendorPath}`);
  process.exit(0);
}

// Strip our header comment before hashing so the hash matches the upstream file.
const withoutHeader = raw.replace(/^\/\*\*[\s\S]*?\*\/\n/, '');

const actual = createHash('sha256').update(withoutHeader).digest('hex');

if (actual === RECORDED_SHA) {
  console.log(`${GREEN}  ✓ vendor/fg.js matches the recorded build (direct-file@${RECORDED_COMMIT})${RESET}`);
} else {
  console.warn(`${YELLOW}${BOLD}  ⚠ vendor/fg.js is not the build recorded here${RESET}`);
  console.warn(`${YELLOW}    Recorded: ${RECORDED_SHA}${RESET}`);
  console.warn(`${YELLOW}    Actual:   ${actual}${RESET}`);
  console.warn(`${YELLOW}    The recorded build is IRS-Public/direct-file@${RECORDED_COMMIT}, path direct-file/fact-graph-scala.${RESET}`);
  console.warn(`${YELLOW}    If the file was replaced on purpose, update all three so they agree:${RESET}`);
  console.warn(`${YELLOW}      1. the commit, path and SHA-256 in the header of vendor/fg.js${RESET}`);
  console.warn(`${YELLOW}      2. RECORDED_SHA and RECORDED_COMMIT in this file${RESET}`);
  console.warn(`${YELLOW}      3. CONFORMANCE.md — regenerate it, since its results describe the old build${RESET}`);
  console.warn(`${YELLOW}         node packages/blueprint-rules-engine/tools/conformance-report.js > packages/blueprint-rules-engine/CONFORMANCE.md${RESET}`);
}

process.exit(0);
