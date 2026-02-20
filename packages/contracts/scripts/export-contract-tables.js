#!/usr/bin/env node
/**
 * Export Contract Tables
 * Discovers behavioral contract YAML files by $schema field and renders
 * each contract type into CSV tables grouped by domain.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, basename, relative } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Export Contract Tables\n');
    console.log('Usage: node scripts/export-contract-tables.js [options]\n');
    console.log('Discovers behavioral contract YAML files and exports CSV tables.\n');
    console.log('Options:');
    console.log('  --specs=<dir>  Path to specs directory (default: contracts package root)');
    console.log('  --out=<dir>    Output directory (default: ../../docs/contract-tables)');
    console.log('  --file=<name>  Export only this contract file');
    console.log('  -h, --help     Show this help message');
    process.exit(0);
  }

  const packageRoot = resolve(__dirname, '..');
  const specsArg = args.find(a => a.startsWith('--specs='));
  const outArg = args.find(a => a.startsWith('--out='));
  const fileArg = args.find(a => a.startsWith('--file='));

  return {
    specsDir: specsArg ? resolve(specsArg.split('=')[1]) : packageRoot,
    outDir: outArg ? resolve(outArg.split('=')[1]) : resolve(packageRoot, '../../docs/contract-tables'),
    singleFile: fileArg ? fileArg.split('=')[1] : null,
  };
}

// ---------------------------------------------------------------------------
// File discovery (same pattern as validate-schemas.js)
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'resolved', 'resolved_ts', 'resolved_json_schema']);

function findYamlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = resolve(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...findYamlFiles(fullPath));
    } else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      results.push(fullPath);
    }
  }
  return results;
}

function discoverContracts(specsDir, singleFile) {
  const yamlFiles = singleFile
    ? [resolve(specsDir, singleFile)]
    : findYamlFiles(specsDir);

  const contracts = [];
  for (const filePath of yamlFiles) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const doc = yaml.load(content);
      if (doc && typeof doc === 'object' && doc.$schema && !doc.$schema.startsWith('http')) {
        contracts.push({ filePath, doc });
      }
    } catch {
      // Skip files that fail to parse
    }
  }
  return contracts;
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

/** Escape a value for CSV — wrap in quotes if it contains commas, quotes, or newlines. */
function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields) {
  return fields.map(csvEscape).join(',');
}

function csvTable(headers, rows) {
  return [csvRow(headers), ...rows.map(csvRow)].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// State machine → CSV renderers
// ---------------------------------------------------------------------------

function renderTransitions(doc) {
  const headers = ['From', 'To', 'Trigger', 'Actors', 'Guards', 'Effects'];
  const rows = [];

  // onCreate as a pseudo-transition (no "from" state)
  if (doc.onCreate) {
    const actors = (doc.onCreate.actors || []).join('; ');
    const effects = (doc.onCreate.effects || []).map(e => e.description || e.type).join('; ');
    rows.push(['(create)', doc.initialState || '', 'create', actors, '', effects]);
  }

  for (const t of doc.transitions || []) {
    const actors = (t.actors || []).join('; ');
    const guards = (t.guards || []).join('; ');
    const effects = (t.effects || []).map(e => e.description || e.type).join('; ');
    rows.push([t.from, t.to, t.trigger, actors, guards, effects]);
  }

  return csvTable(headers, rows);
}

function renderGuards(doc) {
  const headers = ['Guard Name', 'Field', 'Operator', 'Value'];
  const rows = [];
  for (const [name, g] of Object.entries(doc.guards || {})) {
    // Only JSON.stringify objects/arrays; leave strings and numbers as-is
    let value = '';
    if (g.value != null) {
      value = typeof g.value === 'object' ? JSON.stringify(g.value) : String(g.value);
    }
    rows.push([name, g.field || '', g.operator || '', value]);
  }
  return csvTable(headers, rows);
}

function renderSla(doc) {
  const headers = ['State', 'SLA Clock'];
  const rows = [];
  for (const [name, state] of Object.entries(doc.states || {})) {
    rows.push([name, state.slaClock || '']);
  }
  return csvTable(headers, rows);
}

function renderRequestBodies(doc) {
  const headers = ['Trigger', 'Fields'];
  const rows = [];
  for (const [trigger, body] of Object.entries(doc.requestBodies || {})) {
    if (!body || !body.properties) {
      rows.push([trigger, '(none)']);
    } else {
      const required = new Set(body.required || []);
      const fields = Object.entries(body.properties).map(([name, prop]) => {
        const req = required.has(name) ? ' (required)' : '';
        return `${name}: ${prop.type || 'any'}${req}`;
      });
      rows.push([trigger, fields.join('; ')]);
    }
  }
  return csvTable(headers, rows);
}

// ---------------------------------------------------------------------------
// Rules → CSV renderer
// ---------------------------------------------------------------------------

function renderRuleSet(ruleSet) {
  const headers = ['Order', 'Condition', 'Action', 'Fallback', 'Description'];
  const rows = [];
  for (const rule of ruleSet.rules || []) {
    const condition = typeof rule.condition === 'object'
      ? JSON.stringify(rule.condition)
      : String(rule.condition);
    const action = rule.action ? JSON.stringify(rule.action) : '';
    const fallback = rule.fallbackAction ? JSON.stringify(rule.fallbackAction) : '';
    rows.push([rule.order, condition, action, fallback, rule.description || '']);
  }
  return csvTable(headers, rows);
}

// ---------------------------------------------------------------------------
// Metrics → CSV renderer
// ---------------------------------------------------------------------------

function renderMetrics(doc) {
  const headers = ['Metric', 'Description', 'Source Type', 'Source', 'Target'];
  const rows = [];
  for (const m of doc.metrics || []) {
    const { type, ...sourceRest } = m.source;
    const sourceDetails = Object.entries(sourceRest)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    const targets = (m.targets || []).map(t => {
      const parts = [t.stat];
      if (t.operator) parts.push(t.operator);
      if (t.value != null) parts.push(String(t.value));
      if (t.direction) parts.push(t.direction);
      return parts.join(' ');
    }).join('; ');
    rows.push([m.name || m.id, m.description || '', type, sourceDetails, targets]);
  }
  return csvTable(headers, rows);
}

// ---------------------------------------------------------------------------
// Contract type → file mapping
// ---------------------------------------------------------------------------

function getContractType(doc) {
  const schema = doc.$schema || '';
  if (schema.includes('state-machine-schema')) return 'state-machine';
  if (schema.includes('rules-schema')) return 'rules';
  if (schema.includes('metrics-schema')) return 'metrics';
  return null;
}

function exportStateMachine(doc, outDir) {
  const files = {
    'transitions.csv': renderTransitions(doc),
    'guards.csv': renderGuards(doc),
    'sla.csv': renderSla(doc),
    'request-bodies.csv': renderRequestBodies(doc),
  };
  writeFiles(outDir, files);
  return Object.keys(files);
}

function exportRules(doc, outDir) {
  const files = {};
  for (const ruleSet of doc.ruleSets || []) {
    const suffix = ruleSet.ruleType || ruleSet.id;
    files[`rules-${suffix}.csv`] = renderRuleSet(ruleSet);
  }
  writeFiles(outDir, files);
  return Object.keys(files);
}

function exportMetrics(doc, outDir) {
  const files = { 'metrics.csv': renderMetrics(doc) };
  writeFiles(outDir, files);
  return Object.keys(files);
}

function writeFiles(outDir, files) {
  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(resolve(outDir, name), content, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { specsDir, outDir, singleFile } = parseArgs();
  const contracts = discoverContracts(specsDir, singleFile);

  if (contracts.length === 0) {
    console.log('No behavioral contract files found.');
    process.exit(0);
  }

  let totalFiles = 0;

  for (const { filePath, doc } of contracts) {
    const contractType = getContractType(doc);
    if (!contractType) continue;

    const domain = doc.domain;
    if (!domain) {
      console.warn(`  Skipping ${basename(filePath)}: no domain field`);
      continue;
    }

    const domainDir = resolve(outDir, domain);
    let exported = [];

    switch (contractType) {
      case 'state-machine':
        exported = exportStateMachine(doc, domainDir);
        break;
      case 'rules':
        exported = exportRules(doc, domainDir);
        break;
      case 'metrics':
        exported = exportMetrics(doc, domainDir);
        break;
    }

    for (const f of exported) {
      console.log(`  ${relative(outDir, resolve(domainDir, f))}`);
    }
    totalFiles += exported.length;
  }

  console.log(`\nExported ${totalFiles} CSV file(s) to ${relative(process.cwd(), outDir)}`);
}

main();
