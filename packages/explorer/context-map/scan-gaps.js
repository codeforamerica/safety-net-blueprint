#!/usr/bin/env node
/**
 * scan-gaps.js
 *
 * Scans config.yaml for gap-marked steps and reports them at build time.
 * For gaps whose description mentions camelCase identifiers, searches the
 * contracts directory to check if the identifier has since appeared —
 * flagging it as "possibly resolved" for manual review.
 *
 * Called automatically by build.js after render.js.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkgConfig = yaml.load(
  readFileSync(resolve(__dirname, '..', 'config.yaml'), 'utf8')
);

// Load all contract YAML files as a single searchable text blob
const contractsDir = resolve(__dirname, '..', '..', 'contracts');
let contractText = '';
if (existsSync(contractsDir)) {
  for (const f of readdirSync(contractsDir)) {
    if (f.endsWith('.yaml') || f.endsWith('.json')) {
      contractText += readFileSync(resolve(contractsDir, f), 'utf8') + '\n';
    }
  }
}

// Load architecture docs as a single searchable text blob
const archDir = resolve(__dirname, '..', '..', '..', '..', 'docs', 'architecture', 'domains');
let archText = '';
if (existsSync(archDir)) {
  for (const f of readdirSync(archDir)) {
    if (f.endsWith('.md')) {
      archText += readFileSync(resolve(archDir, f), 'utf8') + '\n';
    }
  }
}

// ── Collect all gaps from flows ────────────────────────────────────────────

const gaps = [];
for (const flow of (pkgConfig.flows || [])) {
  for (const step of (flow.steps || [])) {
    if (step.gap) {
      gaps.push({
        flow:        flow.label,
        label:       step.label || step.event || step.self || '(unknown)',
        description: step.gap_description || '',
      });
    }
  }
}

if (gaps.length === 0) {
  console.log('\u2705  No gaps found.');
  process.exit(0);
}

// ── Report ─────────────────────────────────────────────────────────────────

console.log(`\n\u26a0\ufe0f  ${gaps.length} gap(s) — design or contract work needed:\n`);

for (const gap of gaps) {
  // Extract camelCase identifiers as candidate field/schema names
  const candidates = [...new Set(
    (gap.description.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g) || [])
  )];

  const foundInContracts = candidates.filter(c => contractText.includes(c));
  const foundInArch      = candidates.filter(c => archText.includes(c));

  console.log(`  [${gap.flow}] ${gap.label}`);
  if (gap.description) console.log(`     ${gap.description}`);

  if (foundInContracts.length > 0) {
    console.log(`     \u2192 \u2705 Possibly resolved: "${foundInContracts.join('", "')}" found in contracts — verify and remove gap: true if closed`);
  }
  if (foundInArch.length > 0 && foundInContracts.length === 0) {
    console.log(`     \u2192 \u{1F4CB} Referenced in architecture docs but not yet in contracts`);
  }

  console.log('');
}

console.log('  Run with updated contracts to recheck.\n');
