#!/usr/bin/env node
/**
 * Event Contract Validation Script
 *
 * Cross-validates state machine event references against AsyncAPI channel catalogs:
 *
 *   emit.type    — every emit step type must match a channel address in the
 *                  state machine's own eventsSpec AsyncAPI file (same domain).
 *
 *   onEvent.type — every event subscription type must match a channel address
 *                  in any domain's AsyncAPI file (cross-domain subscriptions allowed).
 *
 * This enforces that state machines only emit and subscribe to events that are
 * formally declared in an AsyncAPI contract. Structural validation (required fields,
 * types, patterns) is handled by validate-schemas.js.
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// AsyncAPI channel discovery
// =============================================================================

/**
 * Load all *-asyncapi.yaml files from a directory and return:
 *   allChannels    — Set of all channel addresses across all domains
 *   byFile         — Map of filename -> Set<channel address>
 */
function loadAsyncApiChannels(specDir) {
  const allChannels = new Set();
  const byFile = new Map();

  let files;
  try { files = readdirSync(specDir); } catch { return { allChannels, byFile }; }

  for (const file of files) {
    if (!file.endsWith('-asyncapi.yaml')) continue;
    try {
      const doc = yaml.load(readFileSync(join(specDir, file), 'utf8'));
      const channels = new Set(Object.keys(doc?.channels || {}));
      byFile.set(file, channels);
      for (const ch of channels) allChannels.add(ch);
    } catch {
      // Skip files that fail to parse — caught by validate-schemas.js
    }
  }

  return { allChannels, byFile };
}

// =============================================================================
// Step walker — collects emit.type values recursively
// =============================================================================

function collectEmitTypes(steps, results = []) {
  for (const step of (steps || [])) {
    if (step.emit?.type) results.push(step.emit.type);
    collectEmitTypes(step.then, results);
    collectEmitTypes(step.else, results);
    if (step.when) {
      for (const branch of Object.values(step.when)) collectEmitTypes(branch, results);
    }
    collectEmitTypes(step.do, results);
  }
  return results;
}

function collectAllEmitTypes(stateMachine) {
  const types = [];
  for (const machine of (stateMachine.machines || [])) {
    for (const action of (machine.actions || [])) collectEmitTypes(action.steps, types);
    for (const event of (machine.events || [])) collectEmitTypes(event.steps, types);
    for (const proc of (machine.procedures || [])) collectEmitTypes(proc.steps, types);
  }
  for (const proc of (stateMachine.procedures || [])) collectEmitTypes(proc.steps, types);
  return types;
}

function collectSubscriptionTypes(stateMachine) {
  const types = [];
  for (const machine of (stateMachine.machines || [])) {
    for (const event of (machine.events || [])) {
      if (event.type) types.push(event.type);
    }
  }
  return types;
}

/**
 * Derive timer callback event types from timers: declarations in the state machine.
 * Timer callbacks follow the pattern {domain}.{timerId} and are internal scheduling
 * infrastructure — they are intentionally excluded from domain AsyncAPI catalogs.
 */
function collectTimerCallbackTypes(stateMachine) {
  const domain = stateMachine.domain;
  if (!domain) return new Set();
  const types = new Set();
  for (const machine of (stateMachine.machines || [])) {
    for (const timer of (machine.timers || [])) {
      if (timer.id) types.add(`${domain}.${timer.id}`);
    }
  }
  return types;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const specArg = args.find(a => a.startsWith('--spec='));
  if (!specArg) {
    console.error('Error: --spec=<dir> is required.');
    process.exit(1);
  }
  const specDir = resolve(specArg.split('=')[1]);

  console.log('='.repeat(70));
  console.log('Event Contract Validator');
  console.log('='.repeat(70));
  console.log('\nCross-validating state machine event references against AsyncAPI channel catalogs...');
  console.log(`  Directory: ${specDir}\n`);

  const { allChannels, byFile } = loadAsyncApiChannels(specDir);

  if (allChannels.size === 0) {
    console.log('  No AsyncAPI files found. Nothing to validate.\n');
    process.exit(0);
  }

  console.log(`  Loaded ${byFile.size} AsyncAPI file(s), ${allChannels.size} total channel(s)\n`);

  let files;
  try { files = readdirSync(specDir); } catch { files = []; }

  const stateMachineFiles = files.filter(f => f.endsWith('-state-machine.yaml'));
  if (stateMachineFiles.length === 0) {
    console.log('  No state machine files found. Nothing to validate.\n');
    process.exit(0);
  }

  const errors = [];
  const results = [];

  for (const file of stateMachineFiles) {
    const filePath = join(specDir, file);
    let doc;
    try {
      doc = yaml.load(readFileSync(filePath, 'utf8'));
    } catch {
      continue; // Parse errors caught by validate-schemas.js
    }
    if (!doc || !Array.isArray(doc.machines)) continue;

    const fileErrors = [];

    // Resolve domain-specific channels from eventsSpec
    let domainChannels = null;
    if (doc.eventsSpec) {
      domainChannels = byFile.get(doc.eventsSpec) ?? null;
      if (!domainChannels) {
        fileErrors.push(`eventsSpec "${doc.eventsSpec}" not found — cannot validate emit types`);
      }
    }

    // Validate emit.type — must be in the domain's own eventsSpec
    const emitTypes = collectAllEmitTypes(doc);
    for (const type of emitTypes) {
      if (!domainChannels) {
        // No eventsSpec: warn but can't validate
        fileErrors.push(`emit type "${type}" — no eventsSpec declared, cannot verify`);
      } else if (!domainChannels.has(type)) {
        fileErrors.push(`emit type "${type}" not found in ${doc.eventsSpec}`);
      }
    }

    // Validate onEvent.type — must be in any domain's AsyncAPI file.
    // Timer callback types (e.g., workflow.creation_deadline) are internal scheduling
    // infrastructure declared via timers: in the state machine — skip them.
    const timerCallbackTypes = collectTimerCallbackTypes(doc);
    const subscriptionTypes = collectSubscriptionTypes(doc);
    for (const type of subscriptionTypes) {
      if (timerCallbackTypes.has(type)) continue;
      if (!allChannels.has(type)) {
        fileErrors.push(`subscription type "${type}" not found in any AsyncAPI file`);
      }
    }

    results.push({ file, emitCount: emitTypes.length, subscriptionCount: subscriptionTypes.length, errors: fileErrors });
    errors.push(...fileErrors.map(e => `  [${file}] ${e}`));
  }

  // Display results
  for (const r of results) {
    if (r.errors.length === 0) {
      console.log(`  ✓ ${r.file} (${r.emitCount} emit(s), ${r.subscriptionCount} subscription(s))`);
    } else {
      console.log(`  ✗ ${r.file}`);
      for (const e of r.errors) console.log(`    - ${e}`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  const errorCount = errors.length;
  console.log(`\n  Total: ${results.length} file(s), ${errorCount} error(s)\n`);

  if (errorCount > 0) {
    console.log('✗ Event contract validation failed\n');
    process.exit(1);
  } else {
    console.log('✓ All event contract validations passed!\n');
    process.exit(0);
  }
}

main();
