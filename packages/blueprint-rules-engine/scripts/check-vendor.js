#!/usr/bin/env node
/**
 * Vendor integrity check for fg.js.
 *
 * Computes the SHA-256 of vendor/fg.js (excluding the header comment we added)
 * and compares it to the recorded hash. Warns if they differ — the IRS may have
 * updated the FactGraph library. Always exits 0 so preflight is not blocked.
 *
 * Usage: node packages/blueprint-rules-engine/scripts/check-vendor.js
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vendorPath = join(__dirname, '../vendor/fg.js');

// SHA-256 of the original fg.js before our header comment was prepended.
// Update this when intentionally upgrading fg.js.
const RECORDED_SHA = '8033fc086c45f0d7748dfe7a6fe0c3a6f6864ee3227c2640c806b59eabdfc621';

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
  console.log(`${GREEN}  ✓ vendor/fg.js integrity check passed${RESET}`);
} else {
  console.warn(`${YELLOW}${BOLD}  ⚠ vendor/fg.js may be out of date${RESET}`);
  console.warn(`${YELLOW}    Recorded: ${RECORDED_SHA}${RESET}`);
  console.warn(`${YELLOW}    Actual:   ${actual}${RESET}`);
  console.warn(`${YELLOW}    The IRS FactGraph library may have been updated upstream.${RESET}`);
  console.warn(`${YELLOW}    Review: https://github.com/IRS-Public/direct-file${RESET}`);
  console.warn(`${YELLOW}    If you upgrade fg.js, update RECORDED_SHA in this file and the header comment in vendor/fg.js.${RESET}`);
}

process.exit(0);
