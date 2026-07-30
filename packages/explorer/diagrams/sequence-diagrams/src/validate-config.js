#!/usr/bin/env node
/**
 * validate-config.js
 *
 * Validates that every event key and procedure/branch key referenced in
 * {domain}-config.yaml files actually exists in the corresponding state
 * machine contracts. Run during preflight.
 *
 * Exit code 1 if any mismatches are found.
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '../../../../contracts');
const configDir    = resolve(__dirname, '../config');

// ── Load state machines ────────────────────────────────────────────────────

const SM_FILES = readdirSync(contractsDir)
  .filter(f => f.endsWith('-state-machine.yaml') && f !== 'platform-state-machine.yaml')
  .sort();

const smByDomain = new Map();
for (const f of SM_FILES) {
  const sm = yaml.load(readFileSync(resolve(contractsDir, f), 'utf8'));
  smByDomain.set(sm.domain, sm);
}

// Build event-type index per domain: domain → Set<evtType>
function eventTypesForDomain(domain) {
  const sm = smByDomain.get(domain);
  if (!sm) return new Set();
  const types = new Set();
  for (const machine of sm.machines ?? []) {
    for (const ev of machine.events ?? []) {
      if (ev.type) types.add(ev.type);
    }
  }
  return types;
}

// Build procedure index per domain: domain → Map<procId, proc>
function procsForDomain(domain) {
  const sm = smByDomain.get(domain);
  if (!sm) return new Map();
  const map = new Map();
  for (const proc of sm.procedures ?? []) map.set(proc.id, proc);
  for (const machine of sm.machines ?? []) {
    for (const proc of machine.procedures ?? []) map.set(proc.id, proc);
  }
  return map;
}

// ── Load config files and validate ────────────────────────────────────────

const configFiles = readdirSync(configDir).filter(f => f.endsWith('-config.yaml'));
let errors = 0;

for (const f of configFiles) {
  const cfg = yaml.load(readFileSync(resolve(configDir, f), 'utf8'));
  if (!cfg?.domain) {
    console.error(`[validate-config] ${f}: missing 'domain' field`);
    errors++;
    continue;
  }

  const domain = cfg.domain;
  const smExists = smByDomain.has(domain);

  // Event keys — these can reference events from ANY domain (not just the config domain)
  // so we check against a global event set across all state machines.
  const allEventTypes = new Set();
  for (const sm of smByDomain.values()) {
    for (const machine of sm.machines ?? []) {
      for (const ev of machine.events ?? []) {
        if (ev.type) allEventTypes.add(ev.type);
      }
    }
  }

  for (const evtType of Object.keys(cfg.events ?? {})) {
    if (!allEventTypes.has(evtType)) {
      console.error(`[validate-config] ${f}: event '${evtType}' not found in any state machine`);
      errors++;
    }
  }

  // Procedure and branch keys — these must exist in the config domain's state machine
  if (!smExists && Object.keys(cfg.procedures ?? {}).length > 0) {
    console.error(`[validate-config] ${f}: no state machine found for domain '${domain}' (needed for procedure validation)`);
    errors++;
    continue;
  }

  const procs = procsForDomain(domain);
  for (const [procId, procCfg] of Object.entries(cfg.procedures ?? {})) {
    if (!procs.has(procId)) {
      console.error(`[validate-config] ${f}: procedure '${procId}' not found in ${domain} state machine`);
      errors++;
      continue;
    }

    // Validate match branch keys if config specifies them
    if (procCfg.match) {
      const proc = procs.get(procId);
      // Collect branch keys from the proc (supports on: or when: maps)
      const actualBranches = new Set(Object.keys(proc.on ?? proc.when ?? proc.match ?? {}));
      for (const branchKey of Object.keys(procCfg.match)) {
        if (!actualBranches.has(branchKey)) {
          console.error(`[validate-config] ${f}: procedure '${procId}' branch '${branchKey}' not found in state machine (actual: ${[...actualBranches].join(', ')})`);
          errors++;
        }
      }
    }
  }
}

if (errors === 0) {
  console.log(`[validate-config] All sequence diagram config files validated (${configFiles.length} files)`);
} else {
  console.error(`[validate-config] ${errors} error(s) found — fix config files before continuing`);
  process.exit(1);
}
