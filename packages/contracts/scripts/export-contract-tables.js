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
// State machine → CSV renderers
// ---------------------------------------------------------------------------

/** Format a single effect as a readable expression (e.g., "set assignedToId = $caller.id") */
function formatEffect(e) {
  if (e.type === 'set' && e.field) {
    const val = e.value === null ? 'null' : (e.value != null ? String(e.value) : '');
    return `set ${e.field} = ${val}`;
  }
  // Fall back to type for unknown effect types
  return e.type || '';
}

/** Format a single guard item — string guards stay as-is; composition objects become "any: g1, g2". */
function formatGuardItem(g) {
  if (typeof g === 'string') return g;
  if (g && g.any) return `any: ${g.any.join(', ')}`;
  if (g && g.all) return `all: ${g.all.join(', ')}`;
  return String(g);
}

/** Format a `from` value — arrays become "state1 | state2" to avoid CSV ambiguity. */
function formatFrom(from) {
  if (Array.isArray(from)) return from.join(' | ');
  return from || '';
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
    case 'in':  return `${jsonLogicToFeel(args[0])} in [${args[1].map(v => jsonLogicToFeel(v)).join(', ')}]`;
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
  const obj = smDoc.object || 'Object';

  lines.push(`# ${obj} Workflow — Contract Overview`);
  lines.push('');
  lines.push('> Generated from source YAML files. Do not edit this file directly — changes will be overwritten on the next export.');
  lines.push('');
  lines.push(`This document describes the complete behavioral contract for the **${obj}** resource. It is intended for product owners, policy staff, and other non-technical reviewers who need to understand or propose changes to task lifecycle behavior.`);
  lines.push('');
  lines.push('## How to read this document');
  lines.push('');
  lines.push(`- **States** — the lifecycle stages a ${obj} can be in, and how each affects SLA tracking.`);
  lines.push('- **Transitions** — the actions that move a task from one state to another. Actor-triggered transitions are called explicitly by a person or system; timer-triggered transitions fire automatically after a set amount of time. Each transition lists who can trigger it (via guards), and what happens when it fires (effects).');
  lines.push('- **Guards** — named conditions that control who can perform a transition. If a guard fails, the transition is rejected.');
  lines.push('- **Request bodies** — the data a caller must (or may) include when triggering a transition.');
  lines.push(`- **Rules** — automated logic that runs at key moments (task creation, field updates, certain transitions) to assign tasks to queues and set their priority. Rules are evaluated in order; the first matching rule wins.`);
  lines.push('');
  lines.push('To propose a change — for example, adding a new state, changing who can escalate a task, or adjusting a routing rule — there are two paths:');
  lines.push('- **Non-technical:** Edit the CSV files in this folder and ask a developer to run `npm run contract-tables:import` to apply your changes to the source YAML.');
  lines.push('- **Technical:** Edit the source YAML files directly and submit a pull request.');
  lines.push('');

  // ── States ──────────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## States');
  lines.push('');
  lines.push('Tasks move through a defined set of states. The **SLA clock** tracks time toward resolution:');
  lines.push('- **Running** — time is counting toward the SLA deadline');
  lines.push('- **Paused** — time is not counting (task is blocked, waiting on external input)');
  lines.push('- **Stopped** — work is complete; SLA is no longer tracked');
  lines.push('');
  lines.push('| State | SLA Clock |');
  lines.push('|-------|-----------|');
  for (const [name, state] of Object.entries(smDoc.states || {})) {
    const clock = state.slaClock
      ? state.slaClock.charAt(0).toUpperCase() + state.slaClock.slice(1)
      : '';
    lines.push(`| ${mdCell(name)} | ${mdCell(clock)} |`);
  }
  lines.push('');

  // ── Transitions ─────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
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
  lines.push('These transitions fire when a caseworker, supervisor, or the system calls the corresponding endpoint (`POST /tasks/{id}/{trigger}`).');
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
  lines.push('These transitions fire automatically based on elapsed time — no actor action is required.');
  lines.push('');
  lines.push('| Trigger | From | To | After | Relative To | Calendar | Effects |');
  lines.push('|---------|------|----|-------|-------------|----------|---------|');
  for (const t of timerTransitions) {
    const effects = (t.effects || []).map(e => mdCell(describeEffect(e))).join('<br>');
    lines.push(`| \`${t.trigger}\` | ${mdCell(t.from)} | ${mdCell(t.to)} | ${mdCell(t.after)} | ${mdCell(t.relativeTo)} | ${mdCell(t.calendarType || 'calendar')} | ${effects} |`);
  }
  lines.push('');

  // ── Guards ───────────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Guards');
  lines.push('');
  lines.push('Guards are conditions checked before a transition fires. A transition will not execute unless all of its guards pass. Multiple guards on a transition use AND logic; `any of:` within a guard uses OR logic.');
  lines.push('');
  lines.push('| Guard | Condition |');
  lines.push('|-------|-----------|');
  for (const [name, g] of Object.entries(smDoc.guards || {})) {
    lines.push(`| \`${mdCell(name)}\` | ${mdCell(describeNamedGuard(g))} |`);
  }
  lines.push('');

  // ── Request Bodies ───────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Request Bodies');
  lines.push('');
  lines.push('Data sent when calling a trigger endpoint. Required fields must always be included; optional fields may be omitted.');
  lines.push('');
  lines.push('| Trigger | Required | Optional |');
  lines.push('|---------|----------|----------|');
  for (const [trigger, body] of Object.entries(smDoc.requestBodies || {})) {
    if (!body || !body.properties) {
      lines.push(`| \`${trigger}\` | — | — |`);
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
      lines.push(`| \`${trigger}\` | ${reqFields || '—'} | ${optFields || '—'} |`);
    }
  }
  lines.push('');

  // ── Rules ────────────────────────────────────────────────────────────────
  if (rulesDoc && (rulesDoc.ruleSets || []).length > 0) {
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
  const files = { 'overview.md': renderOverview(smDoc, rulesDoc, slaTypesDoc, metricsDoc) };
  writeFiles(outDir, files);
  return Object.keys(files);
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
