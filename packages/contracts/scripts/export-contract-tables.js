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
    console.log('  --spec=<file|dir>  Path to spec file or directory (default: contracts package root)');
    console.log('  --out=<dir>    Output directory (default: ../../docs/contract-tables)');
    console.log('  --file=<name>  Export only this contract file');
    console.log('  -h, --help     Show this help message');
    process.exit(0);
  }

  // Check for unknown arguments
  const unknown = args.filter(a =>
    a !== '--help' && a !== '-h' &&
    !a.startsWith('--spec=') && !a.startsWith('--out=') && !a.startsWith('--file=')
  );
  if (unknown.length > 0) {
    console.error(`Error: Unknown argument(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  const packageRoot = resolve(__dirname, '..');
  const specArg = args.find(a => a.startsWith('--spec='));
  const outArg = args.find(a => a.startsWith('--out='));
  const fileArg = args.find(a => a.startsWith('--file='));
  const specPath = specArg ? resolve(specArg.split('=')[1]) : packageRoot;
  const isSingleFile = statSync(specPath).isFile();

  return {
    specDir: isSingleFile ? dirname(specPath) : specPath,
    outDir: outArg ? resolve(outArg.split('=')[1]) : resolve(packageRoot, '../../docs/contract-tables'),
    singleFile: isSingleFile ? basename(specPath) : (fileArg ? fileArg.split('=')[1] : null),
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

function discoverContracts(specDir, singleFile) {
  const yamlFiles = singleFile
    ? [resolve(specDir, singleFile)]
    : findYamlFiles(specDir);

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
// Format detection
// ---------------------------------------------------------------------------

/** True when the document uses the machines/handlers/actions format. */
function isMachinesFormat(doc) {
  return Array.isArray(doc.machines);
}

// ---------------------------------------------------------------------------
// State machine → CSV renderers (shared helpers)
// ---------------------------------------------------------------------------

/** Format a `from` value — arrays become "state1 | state2" to avoid CSV ambiguity. */
function formatFrom(from) {
  if (Array.isArray(from)) return from.join(' | ');
  return from || '';
}

// ---------------------------------------------------------------------------
// New format renderers (machines/handlers/actions)
// ---------------------------------------------------------------------------

/** Describe a single step from a then: list. */
function describeStepItem(item) {
  if (!item || typeof item !== 'object') return '';
  const keys = Object.keys(item).filter(k => k !== 'when' && k !== 'description');
  if (keys.length === 0) return '';
  const key = keys[0];
  const val = item[key];
  switch (key) {
    case 'set': {
      const v = val?.value === null ? 'nothing *(clears field)*'
        : val?.value === '$now' ? 'current time'
        : val?.value === '$caller.id' ? "caller's ID"
        : `\`${val?.value}\``;
      return `Set \`${val?.field}\` → ${v}`;
    }
    case 'emit': {
      const event = typeof val === 'string' ? val : val?.event;
      return `Emit \`${event}\` event`;
    }
    case 'evaluate':
      return `Evaluate \`${val}\``;
    case 'invoke': {
      if (typeof val === 'string') return `Invoke \`${val}\``;
      const method = 'POST' in val ? 'POST' : 'PATCH' in val ? 'PATCH' : 'INVOKE';
      const path = val[method] || '';
      return `${method} \`${path}\``;
    }
    default:
      return `Call \`${key}\``;
  }
}

/** Format a guards.conditions list (strings and any/all composition objects). */
function formatConditions(conditions) {
  if (!conditions || conditions.length === 0) return '';
  return conditions.map(c => {
    if (typeof c === 'string') return c;
    if (c.any) return `any: ${c.any.join(', ')}`;
    if (c.all) return `all: ${c.all.join(', ')}`;
    return JSON.stringify(c);
  }).join('; ');
}

function renderTriggers(doc) {
  const headers = ['Machine', 'Trigger Type', 'Name / Event', 'From', 'To', 'After', 'Relative To', 'Calendar', 'Guards', 'Steps'];
  const rows = [];

  for (const machine of doc.machines || []) {
    const t = machine.triggers || {};

    if (t.onCreate) {
      const actors = (t.onCreate.actors || []).join('; ');
      const steps = (t.onCreate.then || []).map(describeStepItem).filter(Boolean).join('; ');
      rows.push([machine.object, 'onCreate', '', '', machine.initialState || '', '', '', '', actors, steps]);
    }

    if (t.onUpdate) {
      const fields = (t.onUpdate.fields || []).join(', ');
      const steps = (t.onUpdate.then || []).map(describeStepItem).filter(Boolean).join('; ');
      rows.push([machine.object, 'onUpdate', `fields: ${fields || '(any)'}`, '', '', '', '', '', '', steps]);
    }

    for (const evt of t.onEvent || []) {
      const conditions = formatConditions(evt.guards?.conditions);
      const from = evt.transition ? formatFrom(evt.transition.from) : '';
      const to = evt.transition?.to || '';
      const steps = (evt.then || []).map(describeStepItem).filter(Boolean).join('; ');
      rows.push([machine.object, 'onEvent', evt.name || '', from, to, '', '', '', conditions, steps]);
    }

    for (const timer of t.onTimer || []) {
      const from = timer.transition ? formatFrom(timer.transition.from) : '';
      const to = timer.transition?.to || '';
      const steps = (timer.then || []).map(describeStepItem).filter(Boolean).join('; ');
      rows.push([machine.object, 'onTimer', '', from, to, timer.after || '', timer.relativeTo || '', timer.calendarType || 'calendar', '', steps]);
    }
  }

  return csvTable(headers, rows);
}

function renderOperations(doc) {
  const headers = ['Machine', 'Name', 'From', 'To', 'Actors', 'Conditions', 'Steps'];
  const rows = [];

  for (const machine of doc.machines || []) {
    for (const op of machine.operations || []) {
      const actors = (op.guards?.actors || []).join('; ');
      const conditions = formatConditions(op.guards?.conditions);
      const from = op.transition ? formatFrom(op.transition.from) : '';
      const to = op.transition?.to || '';
      const steps = (op.then || []).map(describeStepItem).filter(Boolean).join('; ');
      rows.push([machine.object, op.name || '', from, to, actors, conditions, steps]);
    }
  }

  return csvTable(headers, rows);
}

function renderRules(doc) {
  const headers = ['Rule ID', 'Evaluation', 'Conditions'];
  const rows = [];
  for (const rule of doc.rules || []) {
    const conditions = (rule.conditions || []).map(c => {
      const id = c.id ? `[${c.id}] ` : '';
      const cond = c.condition === true || c.condition === undefined ? 'true'
        : typeof c.condition === 'object' ? JSON.stringify(c.condition)
        : String(c.condition);
      return `${id}${cond}`;
    }).join('; ');
    rows.push([rule.id || '', rule.evaluation || 'first-match-wins', conditions]);
  }
  return csvTable(headers, rows);
}

function renderStatesSla(doc) {
  const headers = ['Machine', 'State', 'SLA Clock'];
  const rows = [];
  for (const machine of doc.machines || []) {
    for (const state of machine.states || []) {
      rows.push([machine.object, state.id, state.slaClock || '']);
    }
  }
  return csvTable(headers, rows);
}

// ---------------------------------------------------------------------------
// Old format renderers (transitions/effects) — kept for any unmigrated files
// ---------------------------------------------------------------------------

/** Format a single effect as a readable expression */
function formatEffect(e) {
  if (e.type === 'set' && e.field) {
    const val = e.value === null ? 'null' : (e.value != null ? String(e.value) : '');
    return `set ${e.field} = ${val}`;
  }
  return e.type || '';
}

/** Format a single guard item — string guards stay as-is; composition objects become "any: g1, g2". */
function formatGuardItem(g) {
  if (typeof g === 'string') return g;
  if (g && g.any) return `any: ${g.any.join(', ')}`;
  if (g && g.all) return `all: ${g.all.join(', ')}`;
  return String(g);
}

function renderTransitions(doc) {
  const headers = ['From', 'To', 'Trigger', 'On', 'After', 'RelativeTo', 'CalendarType', 'Actors', 'Guards', 'Effects'];
  const rows = [];

  // onCreate as a pseudo-transition (no "from" state)
  if (doc.onCreate) {
    const actors = (doc.onCreate.actors || []).join('; ');
    const effects = (doc.onCreate.effects || []).map(formatEffect).join('; ');
    rows.push(['(create)', doc.initialState || '', 'create', '', '', '', '', actors, '', effects]);
  }

  for (const t of doc.transitions || []) {
    const actors = (t.actors || []).join('; ');
    const guards = (t.guards || []).map(formatGuardItem).join('; ');
    const effects = (t.effects || []).map(formatEffect).join('; ');
    rows.push([
      formatFrom(t.from),
      t.to,
      t.trigger,
      t.on || '',
      t.after || '',
      t.relativeTo || '',
      t.calendarType || '',
      actors,
      guards,
      effects,
    ]);
  }

  return csvTable(headers, rows);
}

function renderGuards(doc) {
  const headers = ['Guard Name', 'Field', 'Operator', 'Value'];
  const rows = [];
  for (const g of doc.guards || []) {
    // Only JSON.stringify objects/arrays; leave strings and numbers as-is
    let value = '';
    if (g.value != null) {
      value = typeof g.value === 'object' ? JSON.stringify(g.value) : String(g.value);
    }
    rows.push([g.id, g.field || '', g.operator || '', value]);
  }
  return csvTable(headers, rows);
}

function renderSla(doc) {
  const headers = ['State', 'SLA Clock'];
  const rows = [];
  for (const state of doc.states || []) {
    rows.push([state.id, state.slaClock || '']);
  }
  return csvTable(headers, rows);
}

function renderRequestBodies(doc) {
  const headers = ['Trigger', 'Fields'];
  const rows = [];
  for (const body of doc.requestBodies || []) {
    if (!body || !body.properties) {
      rows.push([body.trigger, '(none)']);
    } else {
      const required = new Set(body.required || []);
      const fields = Object.entries(body.properties).map(([name, prop]) => {
        const req = required.has(name) ? ' (required)' : '';
        return `${name}: ${prop.type || 'any'}${req}`;
      });
      rows.push([body.trigger, fields.join('; ')]);
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
  const headers = [
    'id', 'name', 'description', 'aggregate',
    'source.collection', 'source.filter',
    'total.collection', 'total.filter',
    'from.collection', 'from.filter',
    'to.collection', 'to.filter',
    'pairBy', 'targets'
  ];
  const rows = [];
  for (const m of doc.metrics || []) {
    const targets = (m.targets || []).map(t => {
      const parts = [t.stat];
      if (t.operator) parts.push(t.operator);
      if (t.amount != null) parts.push(String(t.amount));
      if (t.unit) parts.push(t.unit);
      if (t.direction) parts.push(t.direction);
      return parts.join(' ');
    }).join('; ');
    rows.push([
      m.id || '',
      m.name || '',
      m.description || '',
      m.aggregate || '',
      m.source?.collection || '',
      m.source?.filter ? JSON.stringify(m.source.filter) : '',
      m.total?.collection || '',
      m.total?.filter ? JSON.stringify(m.total.filter) : '',
      m.from?.collection || '',
      m.from?.filter ? JSON.stringify(m.from.filter) : '',
      m.to?.collection || '',
      m.to?.filter ? JSON.stringify(m.to.filter) : '',
      m.pairBy || '',
      targets
    ]);
  }
  return csvTable(headers, rows);
}

function renderSlaTypes(doc) {
  const headers = [
    'id', 'name', 'duration.amount', 'duration.unit',
    'warningThresholdPercent',
    'autoAssignWhen', 'startWhen', 'pauseWhen', 'resumeWhen', 'completedWhen', 'resetWhen'
  ];
  const rows = [];
  for (const t of doc.slaTypes || []) {
    rows.push([
      t.id || '',
      t.name || '',
      t.duration?.amount != null ? String(t.duration.amount) : '',
      t.duration?.unit || '',
      t.warningThresholdPercent != null ? String(t.warningThresholdPercent) : '',
      t.autoAssignWhen ? JSON.stringify(t.autoAssignWhen) : '',
      t.startWhen ? JSON.stringify(t.startWhen) : '',
      t.pauseWhen ? JSON.stringify(t.pauseWhen) : '',
      t.resumeWhen ? JSON.stringify(t.resumeWhen) : '',
      t.completedWhen ? JSON.stringify(t.completedWhen) : '',
      t.resetWhen ? JSON.stringify(t.resetWhen) : ''
    ]);
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
  if (schema.includes('sla-types-schema')) return 'sla-types';
  return null;
}

// ---------------------------------------------------------------------------
// Multi-machine CSV renderers (Object column prepended)
// ---------------------------------------------------------------------------

function renderMultiMachineTransitions(machines) {
  const headers = ['Object', 'From', 'To', 'Trigger', 'On', 'After', 'RelativeTo', 'CalendarType', 'Actors', 'Guards', 'Effects'];
  const rows = [];
  for (const machine of machines) {
    if (machine.onCreate) {
      const actors = (machine.onCreate.actors || []).join('; ');
      const effects = (machine.onCreate.effects || []).map(formatEffect).join('; ');
      rows.push([machine.object, '(create)', machine.initialState || '', 'create', '', '', '', '', actors, '', effects]);
    }
    for (const t of machine.transitions || []) {
      const actors = (t.actors || []).join('; ');
      const guards = (t.guards || []).map(formatGuardItem).join('; ');
      const effects = (t.effects || []).map(formatEffect).join('; ');
      rows.push([machine.object, formatFrom(t.from), t.to, t.trigger, t.on || '', t.after || '', t.relativeTo || '', t.calendarType || '', actors, guards, effects]);
    }
  }
  return csvTable(headers, rows);
}

function renderMultiMachineGuards(machines) {
  const headers = ['Object', 'Guard Name', 'Field', 'Operator', 'Value'];
  const rows = [];
  for (const machine of machines) {
    for (const g of machine.guards || []) {
      let value = '';
      if (g.value != null) {
        value = typeof g.value === 'object' ? JSON.stringify(g.value) : String(g.value);
      }
      rows.push([machine.object, g.id, g.field || '', g.operator || '', value]);
    }
  }
  return csvTable(headers, rows);
}

function renderMultiMachineSla(machines) {
  const headers = ['Object', 'State', 'SLA Clock'];
  const rows = [];
  for (const machine of machines) {
    for (const state of machine.states || []) {
      rows.push([machine.object, state.id, state.slaClock || '']);
    }
  }
  return csvTable(headers, rows);
}

function renderMultiMachineRequestBodies(machines) {
  const headers = ['Object', 'Trigger', 'Fields'];
  const rows = [];
  for (const machine of machines) {
    for (const body of machine.requestBodies || []) {
      if (!body || !body.properties) {
        rows.push([machine.object, body.trigger, '(none)']);
      } else {
        const required = new Set(body.required || []);
        const fields = Object.entries(body.properties).map(([name, prop]) => {
          const req = required.has(name) ? ' (required)' : '';
          return `${name}: ${prop.type || 'any'}${req}`;
        });
        rows.push([machine.object, body.trigger, fields.join('; ')]);
      }
    }
  }
  return csvTable(headers, rows);
}

function exportStateMachine(doc, outDir) {
  if (isMachinesFormat(doc)) {
    const files = {
      'triggers.csv': renderTriggers(doc),
      'operations.csv': renderOperations(doc),
      'guards.csv': renderGuards(doc),
      'rules.csv': renderRules(doc),
      'slas.csv': renderStatesSla(doc),
    };
    writeFiles(outDir, files);
    return Object.keys(files);
  }
  // Old format
  const files = {
    'transitions.csv': renderTransitions(doc),
    'guards.csv': renderGuards(doc),
    'slas.csv': renderSla(doc),
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

function exportSlaTypes(doc, outDir) {
  const files = { 'sla-types.csv': renderSlaTypes(doc) };
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
// Overview Markdown renderer
// ---------------------------------------------------------------------------

/** Escape pipe characters in Markdown table cell content. */
function mdCell(val) {
  return String(val ?? '').replace(/\|/g, '\\|');
}

/** Describe a single effect in plain English. */
function describeEffect(e) {
  if (e.type === 'set') {
    const val = e.value === null ? 'nothing *(clears field)*'
      : e.value === '$now' ? 'current time'
      : e.value === '$caller.id' ? "caller's ID"
      : `\`${e.value}\``;
    return `Set \`${e.field}\` → ${val}`;
  }
  if (e.type === 'event') return `Emit \`${e.action}\` event`;
  if (e.type === 'evaluate-rules') return `Re-evaluate ${e.ruleType} rules`;
  if (e.type === 'create') {
    const cond = e.when ? ' *(when requested)*' : '';
    return `Create \`${e.entity}\`${cond}`;
  }
  if (e.type === 'lookup') return `Look up \`${e.entity}\``;
  return e.type || '';
}

/** Format a guard reference in a transition (string or any/all composition). */
function formatTransitionGuardRef(g) {
  if (typeof g === 'string') return g;
  if (g && g.any) return `any of: ${g.any.join(', ')}`;
  if (g && g.all) return `all of: ${g.all.join(', ')}`;
  return JSON.stringify(g);
}

/** Describe a named guard definition in plain English. */
function describeNamedGuard(g) {
  const f = `\`${g.field}\``;
  switch (g.operator) {
    case 'is_null': return `${f} is not set`;
    case 'is_not_null': return `${f} is set`;
    case 'equals': return `${f} = \`${g.value}\``;
    case 'not_equals': return `${f} ≠ \`${g.value}\``;
    case 'contains_all': return `${f} contains all of \`${g.value}\``;
    case 'contains_any': return `${f} contains any of \`${g.value}\``;
    default: return `${g.field} ${g.operator} ${g.value}`;
  }
}

/** Convert a JSON Logic expression to a FEEL-style string. */
function jsonLogicToFeel(expr) {
  if (expr === null || expr === undefined) return 'null';
  if (typeof expr === 'boolean') return String(expr);
  if (typeof expr === 'number') return String(expr);
  if (typeof expr === 'string') return `"${expr}"`;
  if (typeof expr !== 'object') return String(expr);

  const op = Object.keys(expr)[0];
  const args = expr[op];

  switch (op) {
    case 'var': {
      const name = Array.isArray(args) ? args[0] : args;
      return name || 'null';
    }
    case '==': return `${jsonLogicToFeel(args[0])} = ${jsonLogicToFeel(args[1])}`;
    case '!=': return `${jsonLogicToFeel(args[0])} != ${jsonLogicToFeel(args[1])}`;
    case '>':  return `${jsonLogicToFeel(args[0])} > ${jsonLogicToFeel(args[1])}`;
    case '>=': return `${jsonLogicToFeel(args[0])} >= ${jsonLogicToFeel(args[1])}`;
    case '<':  return `${jsonLogicToFeel(args[0])} < ${jsonLogicToFeel(args[1])}`;
    case '<=': return `${jsonLogicToFeel(args[0])} <= ${jsonLogicToFeel(args[1])}`;
    case 'and': return (Array.isArray(args) ? args : [args]).map(jsonLogicToFeel).join(' and ');
    case 'or':  return (Array.isArray(args) ? args : [args]).map(jsonLogicToFeel).join(' or ');
    case 'not': return `not(${jsonLogicToFeel(Array.isArray(args) ? args[0] : args)})`;
    case '!':   return `not(${jsonLogicToFeel(Array.isArray(args) ? args[0] : args)})`;
    case 'in':  return Array.isArray(args[1])
      ? `${jsonLogicToFeel(args[0])} in [${args[1].map(v => jsonLogicToFeel(v)).join(', ')}]`
      : `${jsonLogicToFeel(args[0])} in ${jsonLogicToFeel(args[1])}`;
    default: return JSON.stringify(expr);
  }
}

/** Describe a rule action object in plain English. */
function describeRuleAction(action) {
  if (!action || typeof action !== 'object') return String(action ?? '');
  const [key, val] = Object.entries(action)[0] || [];
  if (!key) return '';
  switch (key) {
    case 'assignToQueue': return `Assign to **${val}** queue`;
    case 'setPriority':   return `Set priority to **${val}**`;
    default: return `${key}: ${JSON.stringify(val)}`;
  }
}

function renderOverview(smDoc, rulesDoc, slaTypesDoc = null, metricsDoc = null) {
  const lines = [];
  const isMachines = isMachinesFormat(smDoc);
  const domainLabel = isMachines
    ? (smDoc.machines || []).map(m => m.object).join(' / ')
    : (smDoc.object || 'Object');

  lines.push(`# ${domainLabel} — Contract Overview`);
  lines.push('');
  lines.push('> Generated from source YAML files. Do not edit this file directly — changes will be overwritten on the next export.');
  lines.push('');
  lines.push(`This document describes the complete behavioral contract for the **${domainLabel}** resource${isMachines && (smDoc.machines || []).length > 1 ? 's' : ''}. It is intended for product owners, policy staff, and other non-technical reviewers.`);
  lines.push('');
  lines.push('## How to read this document');
  lines.push('');
  if (isMachines) {
    lines.push('- **States** — the lifecycle stages each resource can be in, and how each affects SLA tracking.');
    lines.push('- **Triggers** — automatic reactions to lifecycle events: object creation, field changes, external events, and timers (onCreate, onUpdate, onEvent, onTimer).');
    lines.push('- **Operations** — actor- or system-triggered actions that can move a resource to a new state or update it in place.');
    lines.push('- **Guards** — named conditions that control who can trigger an operation. If a guard fails, the request is rejected.');
    lines.push('- **Rules** — named procedures that handle logic spanning multiple resources or that apply in several places.');
  } else {
    lines.push(`- **States** — the lifecycle stages a ${smDoc.object || 'resource'} can be in, and how each affects SLA tracking.`);
    lines.push('- **Transitions** — the actions that move a resource from one state to another.');
    lines.push('- **Guards** — named conditions that control who can perform a transition. If a guard fails, the transition is rejected.');
    lines.push('- **Request bodies** — the data a caller must (or may) include when triggering a transition.');
    lines.push('- **Rules** — automated logic that runs at key lifecycle moments.');
  }
  lines.push('');
  lines.push('To propose a change, there are two paths:');
  lines.push('- **Non-technical:** Edit the CSV files in this folder and ask a developer to run `npm run contract-tables:import` to apply your changes to the source YAML.');
  lines.push('- **Technical:** Edit the source YAML files directly and submit a pull request.');
  lines.push('');

  // ── States ──────────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## States');
  lines.push('');
  lines.push('The **SLA clock** tracks time toward resolution:');
  lines.push('- **Running** — time is counting toward the SLA deadline');
  lines.push('- **Paused** — time is not counting (resource is blocked, waiting on external input)');
  lines.push('- **Stopped** — work is complete; SLA is no longer tracked');
  lines.push('');

  if (isMachines) {
    for (const machine of smDoc.machines || []) {
      lines.push(`### ${machine.object}`);
      lines.push('');
      lines.push('| State | SLA Clock |');
      lines.push('|-------|-----------|');
      for (const state of machine.states || []) {
        const clock = state.slaClock ? state.slaClock.charAt(0).toUpperCase() + state.slaClock.slice(1) : '';
        lines.push(`| ${mdCell(state.id)} | ${mdCell(clock)} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('| State | SLA Clock |');
    lines.push('|-------|-----------|');
    for (const state of smDoc.states || []) {
      const clock = state.slaClock ? state.slaClock.charAt(0).toUpperCase() + state.slaClock.slice(1) : '';
      lines.push(`| ${mdCell(state.id)} | ${mdCell(clock)} |`);
    }
    lines.push('');
  }

  // ── Handlers / Transitions ───────────────────────────────────────────────
  lines.push('---');
  lines.push('');

  if (isMachines) {
    lines.push('## Triggers');
    lines.push('');
    lines.push('Triggers are automatic reactions to lifecycle events. Each lists what fires it and what steps run.');
    lines.push('');

    for (const machine of smDoc.machines || []) {
      lines.push(`### ${machine.object}`);
      lines.push('');
      const t = machine.triggers || {};

      if (t.onCreate) {
        lines.push('**On create** — runs when a new record is created:');
        lines.push('');
        for (const step of t.onCreate.then || []) {
          const desc = step.description || describeStepItem(step);
          if (desc) lines.push(`- ${desc}`);
        }
        lines.push('');
      }

      if (t.onUpdate) {
        const fields = t.onUpdate.fields;
        const fieldStr = fields && fields.length > 0
          ? `when any of the following fields change: ${fields.map(f => `\`${f}\``).join(', ')}`
          : 'when any field changes';
        lines.push(`**On update** — runs ${fieldStr}:`);
        lines.push('');
        for (const step of t.onUpdate.then || []) {
          const desc = step.description || describeStepItem(step);
          if (desc) lines.push(`- ${desc}`);
        }
        lines.push('');
      }

      const events = t.onEvent || [];
      if (events.length > 0) {
        lines.push('**Events** — triggered when an external domain event arrives:');
        lines.push('');
        lines.push('| Event | From | To | Conditions | Steps |');
        lines.push('|-------|------|----|------------|-------|');
        for (const evt of events) {
          const from = evt.transition ? mdCell(formatFrom(evt.transition.from)) : '—';
          const to = evt.transition?.to ? mdCell(evt.transition.to) : '—';
          const conditions = mdCell(formatConditions(evt.guards?.conditions || [])) || '—';
          const steps = (evt.then || []).map(s => mdCell(s.description || describeStepItem(s))).filter(Boolean).join('<br>');
          lines.push(`| \`${evt.name}\` | ${from} | ${to} | ${conditions} | ${steps} |`);
        }
        lines.push('');
      }

      const timers = t.onTimer || [];
      if (timers.length > 0) {
        lines.push('**Timers** — fire automatically after a duration elapses:');
        lines.push('');
        lines.push('| From | To | After | Relative To | Calendar | Steps |');
        lines.push('|------|----|-------|-------------|----------|-------|');
        for (const timer of timers) {
          const from = timer.transition ? mdCell(formatFrom(timer.transition.from)) : '—';
          const to = timer.transition?.to ? mdCell(timer.transition.to) : '—';
          const steps = (timer.then || []).map(s => mdCell(s.description || describeStepItem(s))).filter(Boolean).join('<br>');
          lines.push(`| ${from} | ${to} | ${mdCell(timer.after)} | ${mdCell(timer.relativeTo)} | ${mdCell(timer.calendarType || 'calendar')} | ${steps} |`);
        }
        lines.push('');
      }
    }

    lines.push('---');
    lines.push('');
    lines.push('## Operations');
    lines.push('');
    lines.push('Operations are actor- or system-triggered actions. Each lists who can trigger it, what state change it causes, and what steps run.');
    lines.push('');

    for (const machine of smDoc.machines || []) {
      const ops = machine.operations || [];
      if (ops.length === 0) continue;
      lines.push(`### ${machine.object}`);
      lines.push('');
      lines.push('| Name | From | To | Actors | Conditions | Steps |');
      lines.push('|------|------|----|--------|------------|-------|');
      for (const op of ops) {
        const from = op.transition ? mdCell(formatFrom(op.transition.from)) : '—';
        const to = op.transition?.to ? mdCell(op.transition.to) : '—';
        const actors = (op.guards?.actors || []).join(', ') || '—';
        const conditions = mdCell(formatConditions(op.guards?.conditions || [])) || '—';
        const steps = (op.then || []).map(s => mdCell(s.description || describeStepItem(s))).filter(Boolean).join('<br>');
        lines.push(`| \`${op.name}\` | ${from} | ${to} | ${mdCell(actors)} | ${conditions} | ${steps} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('## Transitions');
    lines.push('');

    if (smDoc.onCreate) {
      lines.push('### On Create');
      lines.push('');
      lines.push('The following effects run automatically when a task is first created:');
      lines.push('');
      for (const e of smDoc.onCreate.effects || []) {
        lines.push(`- ${describeEffect(e)}`);
      }
      lines.push('');
    }

    if (smDoc.onUpdate) {
      lines.push('### On Update');
      lines.push('');
      const fields = smDoc.onUpdate.fields;
      const fieldStr = fields && fields.length > 0
        ? `when any of the following fields change: ${fields.map(f => `\`${f}\``).join(', ')}`
        : 'when any field changes';
      lines.push(`The following effects run ${fieldStr}:`);
      lines.push('');
      for (const e of smDoc.onUpdate.effects || []) {
        lines.push(`- ${describeEffect(e)}`);
      }
      lines.push('');
    }

    const allTransitions = smDoc.transitions || [];
    const actorTransitions = allTransitions.filter(t => !t.on);
    const timerTransitions = allTransitions.filter(t => t.on === 'timer');

    lines.push('### Actor-triggered');
    lines.push('');
    lines.push('| Trigger | From | To | Guards | Effects |');
    lines.push('|---------|------|----|--------|---------|');
    for (const t of actorTransitions) {
      const from = Array.isArray(t.from) ? t.from.join(', ') : (t.from || '');
      const guards = (t.guards || []).map(g => mdCell(formatTransitionGuardRef(g))).join('<br>');
      const effects = (t.effects || []).map(e => mdCell(describeEffect(e))).join('<br>');
      lines.push(`| \`${t.trigger}\` | ${mdCell(from)} | ${mdCell(t.to)} | ${guards} | ${effects} |`);
    }
    lines.push('');

    lines.push('### Timer-triggered');
    lines.push('');
    lines.push('| Trigger | From | To | After | Relative To | Calendar | Effects |');
    lines.push('|---------|------|----|-------|-------------|----------|---------|');
    for (const t of timerTransitions) {
      const effects = (t.effects || []).map(e => mdCell(describeEffect(e))).join('<br>');
      lines.push(`| \`${t.trigger}\` | ${mdCell(t.from)} | ${mdCell(t.to)} | ${mdCell(t.after)} | ${mdCell(t.relativeTo)} | ${mdCell(t.calendarType || 'calendar')} | ${effects} |`);
    }
    lines.push('');
  }

  // ── Guards ───────────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Guards');
  lines.push('');
  lines.push('Guards are conditions checked before a transition fires. A transition will not execute unless all of its guards pass. Multiple guards on a transition use AND logic; `any of:` within a guard uses OR logic.');
  lines.push('');
  lines.push('| Guard | Condition |');
  lines.push('|-------|-----------|');
  for (const g of smDoc.guards || []) {
    lines.push(`| \`${mdCell(g.id)}\` | ${mdCell(describeNamedGuard(g))} |`);
  }
  lines.push('');

  // ── Request Bodies (old format only) ─────────────────────────────────────
  if (!isMachines) {
    lines.push('---');
    lines.push('');
    lines.push('## Request Bodies');
    lines.push('');
    lines.push('Data sent when calling a trigger endpoint. Required fields must always be included; optional fields may be omitted.');
    lines.push('');
    lines.push('| Trigger | Required | Optional |');
    lines.push('|---------|----------|----------|');
    for (const body of smDoc.requestBodies || []) {
      if (!body || !body.properties) {
        lines.push(`| \`${body.trigger}\` | — | — |`);
      } else {
        const required = new Set(body.required || []);
        const reqFields = Object.entries(body.properties)
          .filter(([n]) => required.has(n))
          .map(([n, p]) => `\`${n}\` *(${p.type || 'any'})*`)
          .join(', ');
        const optFields = Object.entries(body.properties)
          .filter(([n]) => !required.has(n))
          .map(([n, p]) => `\`${n}\` *(${p.type || 'any'})*`)
          .join(', ');
        lines.push(`| \`${body.trigger}\` | ${reqFields || '—'} | ${optFields || '—'} |`);
      }
    }
    lines.push('');
  }

  // ── Rules ────────────────────────────────────────────────────────────────
  if (isMachines && (smDoc.rules || []).length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Rules');
    lines.push('');
    lines.push('Rules are named procedures called from trigger and operation steps. They handle logic that spans multiple resources or applies in several places.');
    lines.push('');

    for (const rule of smDoc.rules) {
      lines.push(`### \`${rule.id}\``);
      lines.push('');
      lines.push(`Evaluation: **${rule.evaluation || 'first-match-wins'}**`);
      lines.push('');
      lines.push('| # | Condition | Steps |');
      lines.push('|---|-----------|-------|');
      for (const cond of rule.conditions || []) {
        const order = cond.order != null ? String(cond.order) : '';
        const condStr = cond.condition === true || cond.condition === undefined ? 'always'
          : typeof cond.condition === 'object' ? jsonLogicToFeel(cond.condition)
          : String(cond.condition);
        const steps = (cond.then || []).map(s => mdCell(s.description || describeStepItem(s))).filter(Boolean).join('<br>');
        lines.push(`| ${order} | ${mdCell(condStr)} | ${steps} |`);
      }
      lines.push('');
    }
  } else if (!isMachines && rulesDoc && (rulesDoc.ruleSets || []).length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Rules');
    lines.push('');
    lines.push('Rules are evaluated automatically at key lifecycle moments (on create, on update, and after certain transitions). They determine how tasks are routed and prioritized.');
    lines.push('');

    for (const ruleSet of rulesDoc.ruleSets) {
      const title = ruleSet.ruleType
        ? ruleSet.ruleType.charAt(0).toUpperCase() + ruleSet.ruleType.slice(1).replace(/-/g, ' ')
        : (ruleSet.id || 'Rules');
      lines.push(`### ${title}`);
      lines.push('');
      if (ruleSet.description) {
        lines.push(ruleSet.description);
        lines.push('');
      }
      lines.push(`Evaluation strategy: **${ruleSet.evaluation || 'first-match-wins'}**`);
      lines.push('');
      lines.push('| # | Condition | Action | Fallback |');
      lines.push('|---|-----------|--------|----------|');
      for (const rule of ruleSet.rules || []) {
        const cond = typeof rule.condition === 'object'
          ? jsonLogicToFeel(rule.condition)
          : String(rule.condition || '');
        const action = describeRuleAction(rule.action);
        const fallback = rule.fallbackAction ? describeRuleAction(rule.fallbackAction) : '—';
        lines.push(`| ${rule.order} | ${mdCell(cond)} | ${mdCell(action)} | ${mdCell(fallback)} |`);
      }
      lines.push('');
    }
  }

  // ── SLA Types ────────────────────────────────────────────────────────────
  if (slaTypesDoc && (slaTypesDoc.slaTypes || []).length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## SLA Types');
    lines.push('');
    lines.push('SLA types define the deadlines and clock behavior for each class of work. The SLA clock tracks progress toward resolution; `pauseWhen` conditions temporarily stop the clock while the task is blocked on external input.');
    lines.push('');
    lines.push('JSON Logic conditions are serialized as JSON. See [#108](https://github.com/codeforamerica/safety-net-blueprint/issues/108) for planned improvements to the editing experience.');
    lines.push('');
    lines.push('| ID | Name | Duration | Warning at | Pause when |');
    lines.push('|----|------|----------|------------|------------|');
    for (const t of slaTypesDoc.slaTypes) {
      const duration = t.duration ? `${t.duration.amount} ${t.duration.unit}` : '';
      const warning = t.warningThresholdPercent != null ? `${t.warningThresholdPercent}%` : '—';
      const pause = t.pauseWhen ? `\`${JSON.stringify(t.pauseWhen)}\`` : '—';
      lines.push(`| \`${mdCell(t.id)}\` | ${mdCell(t.name)} | ${mdCell(duration)} | ${mdCell(warning)} | ${pause} |`);
    }
    lines.push('');
  }

  // ── Metrics ──────────────────────────────────────────────────────────────
  if (metricsDoc && (metricsDoc.metrics || []).length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Metrics');
    lines.push('');
    lines.push('Metrics are computed on demand from the tasks and events collections. Values are available at `GET /workflow/metrics`.');
    lines.push('');
    lines.push('| ID | Name | Aggregate | Target |');
    lines.push('|----|------|-----------|--------|');
    for (const m of metricsDoc.metrics) {
      const target = (m.targets || []).map(t => {
        const parts = [t.stat];
        if (t.operator) parts.push(t.operator);
        if (t.amount != null) parts.push(String(t.amount));
        if (t.unit) parts.push(t.unit);
        if (t.direction) parts.push(t.direction);
        return parts.join(' ');
      }).join('; ');
      lines.push(`| \`${mdCell(m.id)}\` | ${mdCell(m.name)} | ${mdCell(m.aggregate)} | ${mdCell(target || '—')} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function exportOverview(smDoc, rulesDoc, slaTypesDoc, metricsDoc, outDir) {
  let content;
  if (smDoc.machines && smDoc.machines.length > 0) {
    content = smDoc.machines
      .map(machine => renderOverview(machine, rulesDoc, slaTypesDoc, metricsDoc))
      .join('\n\n---\n\n');
  } else {
    content = renderOverview(smDoc, rulesDoc, slaTypesDoc, metricsDoc);
  }
  writeFiles(outDir, { 'overview.md': content });
  return ['overview.md'];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { specDir, outDir, singleFile } = parseArgs();
  const contracts = discoverContracts(specDir, singleFile);

  if (contracts.length === 0) {
    console.log('No behavioral contract files found.');
    process.exit(0);
  }

  // Group contracts by domain so the overview can combine state machine + rules
  const byDomain = new Map();
  for (const { filePath, doc } of contracts) {
    const contractType = getContractType(doc);
    if (!contractType) continue;
    const domain = doc.domain;
    if (!domain) {
      console.warn(`  Skipping ${basename(filePath)}: no domain field`);
      continue;
    }
    if (!byDomain.has(domain)) byDomain.set(domain, { domain, stateMachine: null, rules: null, metrics: null, slaTypes: null });
    const group = byDomain.get(domain);
    if (contractType === 'state-machine') group.stateMachine = doc;
    else if (contractType === 'rules') group.rules = doc;
    else if (contractType === 'metrics') group.metrics = doc;
    else if (contractType === 'sla-types') group.slaTypes = doc;
  }

  let totalFiles = 0;

  for (const [, group] of byDomain) {
    const { domain, stateMachine, rules, metrics, slaTypes } = group;
    const domainDir = resolve(outDir, domain);
    const exported = [];

    if (stateMachine) exported.push(...exportStateMachine(stateMachine, domainDir));
    if (rules) exported.push(...exportRules(rules, domainDir));
    if (metrics) exported.push(...exportMetrics(metrics, domainDir));
    if (slaTypes) exported.push(...exportSlaTypes(slaTypes, domainDir));
    if (stateMachine) exported.push(...exportOverview(stateMachine, rules, slaTypes, metrics, domainDir));

    for (const f of exported) {
      console.log(`  ${relative(outDir, resolve(domainDir, f))}`);
    }
    totalFiles += exported.length;
  }

  console.log(`\nExported ${totalFiles} file(s) to ${relative(process.cwd(), outDir)}`);
}

main();
