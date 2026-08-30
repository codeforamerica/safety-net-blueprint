/**
 * scan-gaps.js
 *
 * Scans the enriched explorer config for gap-marked steps and reports them at
 * build time. For gaps whose description mentions camelCase identifiers, searches
 * the contracts directory to check if the identifier has since appeared —
 * flagging it as "possibly resolved" for manual review.
 *
 * Called automatically by build.js after renderContextMap.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function flattenSteps(steps) {
  const result = [];
  for (const step of steps) {
    if (step.fragment !== undefined) {
      if (step.operands) {
        for (const op of step.operands) result.push(...flattenSteps(op.steps || []));
      } else {
        result.push(...flattenSteps(step.steps || []));
      }
    } else {
      result.push(step);
    }
  }
  return result;
}

export function scanGaps(config) {
  // Load all contract YAML files as a single searchable text blob
  const contractsDir = resolve(__dirname, '..', '..', '..', 'contracts');
  let contractText = '';
  if (existsSync(contractsDir)) {
    for (const f of readdirSync(contractsDir)) {
      if (f.endsWith('.yaml') || f.endsWith('.json')) {
        contractText += readFileSync(resolve(contractsDir, f), 'utf8') + '\n';
      }
    }
  }

  // Load architecture docs as a single searchable text blob
  const archDir = resolve(__dirname, '..', '..', '..', '..', '..', 'docs', 'architecture', 'domains');
  let archText = '';
  if (existsSync(archDir)) {
    for (const f of readdirSync(archDir)) {
      if (f.endsWith('.md')) {
        archText += readFileSync(resolve(archDir, f), 'utf8') + '\n';
      }
    }
  }

  // Collect all gaps from flows (recurse into fragments)
  const gaps = [];
  for (const flow of (config.flows || [])) {
    for (const step of flattenSteps(flow.steps || [])) {
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
    console.log('✅  No gaps found.');
    return;
  }

  console.log(`\n⚠️  ${gaps.length} gap(s) — design or contract work needed:\n`);

  for (const gap of gaps) {
    const candidates = [...new Set(
      (gap.description.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g) || [])
    )];

    const foundInContracts = candidates.filter(c => contractText.includes(c));
    const foundInArch      = candidates.filter(c => archText.includes(c));

    console.log(`  [${gap.flow}] ${gap.label}`);
    if (gap.description) console.log(`     ${gap.description}`);

    if (foundInContracts.length > 0) {
      console.log(`     → ✅ Possibly resolved: "${foundInContracts.join('", "')}" found in contracts — verify and remove gap: true if closed`);
    }
    if (foundInArch.length > 0 && foundInContracts.length === 0) {
      console.log(`     → \u{1F4CB} Referenced in architecture docs but not yet in contracts`);
    }

    console.log('');
  }

  console.log('  Run with updated contracts to recheck.\n');
}
