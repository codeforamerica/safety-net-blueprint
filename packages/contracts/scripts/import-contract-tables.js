#!/usr/bin/env node
/**
 * Import Contract Tables
 * Reads CSV tables and merges them back into behavioral contract YAML files.
 * Validates the output against JSON Schemas.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, basename, relative, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Import Contract Tables\n');
    console.log('Usage: node scripts/import-contract-tables.js [options]\n');
    console.log('Reads CSV tables and produces valid behavioral contract YAML.\n');
    console.log('Merges into existing YAML when found, or creates a new state machine\n');
    console.log('when --name and --resource are provided.\n');
    console.log('Options:');
    console.log('  --tables=<dir>     CSV tables directory (default: ../../docs/contract-tables)');
    console.log('  --out=<dir>        YAML output directory (default: contracts package root)');
    console.log('  --name=<domain>    Domain name, kebab-case (e.g., pizza-shop). Creates new YAML if none exists.');
    console.log('  --resource=<Name>  Resource name, PascalCase (e.g., Pizza). Required with --name.');
    console.log('  --schema=<path>    Path to state machine JSON Schema for $schema field and validation.');
    console.log('                     Default: ./schemas/state-machine-schema.yaml (relative to output)');
    console.log('  --file=<path>      Import only this CSV file');
    console.log('  -h, --help         Show this help message');
    process.exit(0);
  }

  // Check for unknown arguments
  const unknown = args.filter(a =>
    a !== '--help' && a !== '-h' &&
    !a.startsWith('--tables=') && !a.startsWith('--out=') && !a.startsWith('--file=') &&
    !a.startsWith('--name=') && !a.startsWith('--resource=') && !a.startsWith('--schema=')
  );
  if (unknown.length > 0) {
    console.error(`Error: Unknown argument(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  const packageRoot = resolve(__dirname, '..');
  const tablesArg = args.find(a => a.startsWith('--tables='));
  const outArg = args.find(a => a.startsWith('--out='));
  const fileArg = args.find(a => a.startsWith('--file='));
  const nameArg = args.find(a => a.startsWith('--name='));
  const resourceArg = args.find(a => a.startsWith('--resource='));
  const schemaArg = args.find(a => a.startsWith('--schema='));

  return {
    tablesDir: tablesArg ? resolve(tablesArg.split('=')[1]) : resolve(packageRoot, '../../docs/contract-tables'),
    outDir: outArg ? resolve(outArg.split('=')[1]) : packageRoot,
    singleFile: fileArg ? resolve(fileArg.split('=')[1]) : null,
    name: nameArg ? nameArg.split('=')[1] : null,
    resource: resourceArg ? resourceArg.split('=')[1] : null,
    schema: schemaArg ? schemaArg.split('=')[1] : null,
  };
}

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields with commas, newlines, and escaped quotes)
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        current.push(field);
        field = '';
        i++;
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field);
        field = '';
        rows.push(current);
        current = [];
        i += ch === '\r' ? 2 : 1;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Last field/row
  if (field || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  if (rows.length === 0) return { headers: [], data: [] };
  const headers = rows[0];
  const data = rows.slice(1).filter(r => r.some(c => c.trim() !== ''));
  return { headers, data };
}

// ---------------------------------------------------------------------------
// YAML file discovery
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

/** Find the YAML file in outDir whose domain matches and whose $schema matches the expected type. */
function findYamlForDomain(outDir, domain, schemaKeyword) {
  const yamlFiles = findYamlFiles(outDir);
  for (const filePath of yamlFiles) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const doc = yaml.load(content);
      if (
        doc && typeof doc === 'object' &&
        doc.domain === domain &&
        doc.$schema && doc.$schema.includes(schemaKeyword)
      ) {
        return { filePath, doc, rawContent: content };
      }
    } catch {
      // skip
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CSV → YAML section converters
// ---------------------------------------------------------------------------

function parseJsonField(val) {
  if (!val || val === '') return undefined;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

/**
 * Parse a `from` cell — "state1 | state2" becomes an array; plain strings stay as-is.
 * Also handles legacy comma-separated values (old format before pipe separator).
 */
function parseFrom(from) {
  if (!from) return '';
  if (from.includes(' | ')) return from.split(' | ').map(s => s.trim());
  return from;
}

/**
 * Parse a single guard string — "any: g1, g2" becomes { any: ['g1', 'g2'] },
 * "all: g1, g2" becomes { all: ['g1', 'g2'] }, otherwise returns the string as-is.
 */
function parseGuardItem(g) {
  const trimmed = g.trim();
  const anyMatch = trimmed.match(/^any:\s*(.+)$/);
  if (anyMatch) return { any: anyMatch[1].split(',').map(s => s.trim()) };
  const allMatch = trimmed.match(/^all:\s*(.+)$/);
  if (allMatch) return { all: allMatch[1].split(',').map(s => s.trim()) };
  return trimmed;
}

/** Normalize a `from` value to a string for comparison (arrays sorted and joined). */
function normalizeFrom(from) {
  if (Array.isArray(from)) return [...from].sort().join(' | ');
  return from || '';
}

function importTransitions(csvData, existingDoc) {
  const doc = { ...existingDoc };
  const transitions = [];
  let onCreate = null;

  // Detect whether CSV uses new format (with On/After/RelativeTo/CalendarType columns)
  const headers = csvData.headers || [];
  const hasTimerColumns = headers.includes('On');

  for (const row of csvData.data) {
    let from, to, trigger, on, after, relativeTo, calendarType, actors, guards;

    if (hasTimerColumns) {
      [from, to, trigger, on, after, relativeTo, calendarType, actors, guards] = row;
    } else {
      // Legacy 6-column format: From, To, Trigger, Actors, Guards, Effects
      [from, to, trigger, actors, guards] = row;
    }

    if (from === '(create)') {
      onCreate = {
        actors: actors ? actors.split('; ').map(a => a.trim()).filter(Boolean) : [],
        effects: existingDoc.onCreate?.effects || [],
      };
      continue;
    }

    const parsedFrom = parseFrom(from);

    // Find matching existing transition to preserve full effects
    const existingTransition = (existingDoc.transitions || []).find(t =>
      t.trigger === trigger &&
      normalizeFrom(t.from) === normalizeFrom(parsedFrom) &&
      t.to === to
    );

    const transition = {
      trigger,
      from: parsedFrom,
      to,
    };

    // Preserve timer fields from CSV (new format) or existing YAML (legacy format)
    const timerOn = on || existingTransition?.on;
    if (timerOn) {
      transition.on = timerOn;
      transition.after = after || existingTransition?.after;
      transition.relativeTo = relativeTo || existingTransition?.relativeTo;
      if (calendarType || existingTransition?.calendarType) {
        transition.calendarType = calendarType || existingTransition?.calendarType;
      }
    }

    transition.actors = actors ? actors.split('; ').map(a => a.trim()).filter(Boolean) : [];

    const parsedGuards = guards
      ? guards.split('; ').map(parseGuardItem).filter(Boolean)
      : (existingTransition?.guards || []);
    if (parsedGuards.length > 0) transition.guards = parsedGuards;

    transition.effects = existingTransition?.effects || [];

    transitions.push(transition);
  }

  doc.transitions = transitions;
  if (onCreate) {
    doc.onCreate = onCreate;
  }
  return doc;
}

function importGuards(csvData, existingDoc) {
  const doc = { ...existingDoc };
  const guards = {};
  for (const row of csvData.data) {
    const [name, field, operator, value] = row;
    const guard = { field };
    if (operator) guard.operator = operator;
    const parsed = parseJsonField(value);
    if (parsed !== undefined && parsed !== '') guard.value = parsed;
    guards[name] = guard;
  }
  doc.guards = guards;
  return doc;
}

function importSla(csvData, existingDoc) {
  const doc = { ...existingDoc };
  const states = { ...(existingDoc.states || {}) };
  for (const row of csvData.data) {
    const [name, slaClock] = row;
    if (!states[name]) states[name] = {};
    if (slaClock) {
      states[name] = { ...states[name], slaClock };
    }
  }
  doc.states = states;
  return doc;
}

function importRequestBodies(csvData, existingDoc) {
  const doc = { ...existingDoc };
  const requestBodies = {};
  for (const row of csvData.data) {
    const [trigger, fields] = row;
    if (fields === '(none)' || !fields) {
      requestBodies[trigger] = {};
    } else {
      // Preserve existing request body structure — the CSV is lossy for full schemas
      requestBodies[trigger] = existingDoc.requestBodies?.[trigger] || {};
    }
  }
  doc.requestBodies = requestBodies;
  return doc;
}

function importRuleSet(csvData, existingDoc, ruleType) {
  const doc = { ...existingDoc };
  const ruleSets = [...(existingDoc.ruleSets || [])];

  // Find existing ruleSet to preserve metadata
  const existingIdx = ruleSets.findIndex(rs => rs.ruleType === ruleType);
  const existingRuleSet = existingIdx >= 0 ? ruleSets[existingIdx] : {};

  const rules = csvData.data.map(row => {
    const [order, condition, action, fallback, description] = row;
    const existingRule = (existingRuleSet.rules || []).find(r => r.order === Number(order));
    const rule = {
      id: existingRule?.id || `rule-${order}`,
      order: Number(order),
      condition: parseJsonField(condition),
      action: parseJsonField(action),
    };
    const fb = parseJsonField(fallback);
    if (fb !== undefined && fb !== '') rule.fallbackAction = fb;
    if (description) rule.description = description;
    return rule;
  });

  const newRuleSet = {
    ...existingRuleSet,
    ruleType,
    evaluation: existingRuleSet.evaluation || 'first-match-wins',
    rules,
  };

  if (existingIdx >= 0) {
    ruleSets[existingIdx] = newRuleSet;
  } else {
    ruleSets.push(newRuleSet);
  }

  doc.ruleSets = ruleSets;
  return doc;
}

function importMetrics(csvData, existingDoc) {
  const doc = { ...existingDoc };

  // Support both old format (5 columns: name, description, sourceType, sourceDetails, targets)
  // and new format (14 columns: id, name, description, aggregate, source.*, total.*, from.*, to.*, pairBy, targets)
  const isNewFormat = csvData.data.length > 0 && csvData.data[0].length >= 6;

  const metrics = csvData.data.map(row => {
    if (isNewFormat) {
      const [
        id, name, description, aggregate,
        sourceCollection, sourceFilter,
        totalCollection, totalFilter,
        fromCollection, fromFilter,
        toCollection, toFilter,
        pairBy, targetStr
      ] = row;

      const parseSource = (collection, filter) => {
        if (!collection) return undefined;
        const s = { collection };
        if (filter) {
          try { s.filter = JSON.parse(filter); } catch { /* leave as string */ }
        }
        return s;
      };

      const targets = targetStr ? targetStr.split('; ').map(t => {
        const parts = t.trim().split(' ');
        const target = { stat: parts[0] };
        if (parts.length >= 3) {
          target.operator = parts[1];
          const num = parseFloat(parts[2]);
          target.amount = isNaN(num) ? parts[2] : num;
          if (parts[3]) target.unit = parts[3];
        } else if (parts.length === 2) {
          target.direction = parts[1];
        }
        return target;
      }) : [];

      const metric = {
        id: id || name.toLowerCase().replace(/\s+/g, '_'),
        name,
        description: description || undefined,
        aggregate
      };
      const source = parseSource(sourceCollection, sourceFilter);
      if (source) metric.source = source;
      const total = parseSource(totalCollection, totalFilter);
      if (total) metric.total = total;
      const from = parseSource(fromCollection, fromFilter);
      if (from) metric.from = from;
      const to = parseSource(toCollection, toFilter);
      if (to) metric.to = to;
      if (pairBy) metric.pairBy = pairBy;
      if (targets.length > 0) metric.targets = targets;

      return metric;
    } else {
      // Legacy format
      const [name, description, sourceType, sourceDetails, targetStr] = row;
      const existing = (existingDoc.metrics || []).find(m => (m.name || m.id) === name);
      const source = { type: sourceType };
      if (sourceDetails) {
        for (const pair of sourceDetails.split('; ')) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx > 0) {
            source[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
          }
        }
      }
      const targets = targetStr ? targetStr.split('; ').map(t => {
        const parts = t.split(' ');
        const target = { stat: parts[0] };
        if (parts.length >= 3) { target.operator = parts[1]; target.value = parts[2]; }
        else if (parts.length === 2) { target.direction = parts[1]; }
        return target;
      }) : [];
      return {
        id: existing?.id || name.toLowerCase().replace(/\s+/g, '_'),
        name, description: description || undefined, source, targets
      };
    }
  });

  doc.metrics = metrics;
  return doc;
}

function importSlaTypes(csvData, existingDoc) {
  const doc = { ...existingDoc };

  const slaTypes = csvData.data.map(row => {
    const [
      id, name, durationAmount, durationUnit,
      warningThresholdPercent,
      autoAssignWhen, startWhen, pauseWhen, resumeWhen, completedWhen, resetWhen
    ] = row;

    const parseCondition = (val) => {
      if (!val) return undefined;
      try { return JSON.parse(val); } catch { return val; }
    };

    const slaType = { id, name };
    if (durationAmount && durationUnit) {
      slaType.duration = { amount: parseFloat(durationAmount), unit: durationUnit };
    }
    if (warningThresholdPercent) slaType.warningThresholdPercent = parseInt(warningThresholdPercent, 10);
    const auto = parseCondition(autoAssignWhen);
    if (auto !== undefined) slaType.autoAssignWhen = auto;
    const start = parseCondition(startWhen);
    if (start !== undefined) slaType.startWhen = start;
    const pause = parseCondition(pauseWhen);
    if (pause !== undefined) slaType.pauseWhen = pause;
    const resume = parseCondition(resumeWhen);
    if (resume !== undefined) slaType.resumeWhen = resume;
    const completed = parseCondition(completedWhen);
    if (completed !== undefined) slaType.completedWhen = completed;
    const reset = parseCondition(resetWhen);
    if (reset !== undefined) slaType.resetWhen = reset;

    return slaType;
  });

  doc.slaTypes = slaTypes;
  return doc;
}

// ---------------------------------------------------------------------------
// Determine what CSV file maps to which contract type and section
// ---------------------------------------------------------------------------

function classifyCsvFile(csvFilename) {
  if (csvFilename === 'transitions.csv') return { schemaKey: 'state-machine-schema', section: 'transitions' };
  if (csvFilename === 'guards.csv') return { schemaKey: 'state-machine-schema', section: 'guards' };
  if (csvFilename === 'sla.csv') return { schemaKey: 'state-machine-schema', section: 'sla' };
  if (csvFilename === 'request-bodies.csv') return { schemaKey: 'state-machine-schema', section: 'request-bodies' };
  if (csvFilename.startsWith('rules-') && csvFilename.endsWith('.csv')) return { schemaKey: 'rules-schema', section: 'rules', ruleType: csvFilename.slice(6, -4) };
  if (csvFilename === 'metrics.csv') return { schemaKey: 'metrics-schema', section: 'metrics' };
  if (csvFilename === 'sla-types.csv') return { schemaKey: 'sla-types-schema', section: 'sla-types' };
  return null;
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

function validateAgainstSchema(doc, schemaPath) {
  try {
    const schemaContent = readFileSync(schemaPath, 'utf8');
    const schema = yaml.load(schemaContent);
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);
    const { $schema, ...data } = doc;
    const valid = validate(data);
    if (!valid) {
      return validate.errors.map(e => `${e.instancePath || '(root)'}: ${e.message}`);
    }
  } catch (err) {
    return [err.message];
  }
  return [];
}

// ---------------------------------------------------------------------------
// YAML serializer — preserves comment header
// ---------------------------------------------------------------------------

function serializeYaml(doc) {
  return yaml.dump(doc, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
}

function writeYaml(filePath, doc, originalContent) {
  // Preserve the comment header from the original file
  const headerLines = [];
  for (const line of (originalContent || '').split('\n')) {
    if (line.startsWith('#') || line.trim() === '') {
      headerLines.push(line);
    } else {
      break;
    }
  }
  const header = headerLines.length > 0 ? headerLines.join('\n') + '\n' : '';
  const body = serializeYaml(doc);
  writeFileSync(filePath, header + body, 'utf8');
}

// ---------------------------------------------------------------------------
// Discover CSV files to import
// ---------------------------------------------------------------------------

function discoverCsvFiles(tablesDir, flatDomain) {
  const results = [];
  if (!existsSync(tablesDir)) return results;

  // When flatDomain is provided, also look for CSVs directly in tablesDir
  if (flatDomain) {
    for (const file of readdirSync(tablesDir)) {
      if (file.endsWith('.csv') && statSync(resolve(tablesDir, file)).isFile()) {
        results.push({ domain: flatDomain, csvFile: file, csvPath: resolve(tablesDir, file) });
      }
    }
    if (results.length > 0) return results;
  }

  // Default: look in domain subdirectories
  for (const domain of readdirSync(tablesDir)) {
    const domainDir = resolve(tablesDir, domain);
    if (!statSync(domainDir).isDirectory()) continue;
    for (const file of readdirSync(domainDir)) {
      if (file.endsWith('.csv')) {
        results.push({ domain, csvFile: file, csvPath: resolve(domainDir, file) });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Skeleton creation for new state machines
// ---------------------------------------------------------------------------

/**
 * Extract unique states from a transitions CSV and build a skeleton YAML doc.
 * The first "from" state in the CSV becomes the initialState.
 */
function createStateMachineSkeleton(domain, resource, csvs, schemaRef) {
  const states = new Set();
  let initialState = null;

  // Find the transitions CSV and extract states from it
  const transitionsCsv = csvs.find(c => c.section === 'transitions');
  if (transitionsCsv) {
    const content = readFileSync(transitionsCsv.csvPath, 'utf8');
    const parsed = parseCsv(content);
    for (const row of parsed.data) {
      const [from, to] = row;
      if (from && from !== '(create)') {
        states.add(from);
        if (!initialState) initialState = from;
      }
      if (to) states.add(to);
    }
  }

  const statesObj = {};
  for (const s of states) {
    statesObj[s] = {};
  }

  return {
    $schema: schemaRef,
    version: '1.0',
    object: resource,
    domain,
    apiSpec: `${domain}-openapi.yaml`,
    states: statesObj,
    initialState: initialState || 'pending',
    guards: {},
    transitions: [],
    requestBodies: {},
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { tablesDir, outDir, singleFile, name, resource, schema } = parseArgs();
  const schemaRef = schema || './schemas/state-machine-schema.yaml';

  // Determine which CSV files to process
  let csvFiles;
  if (singleFile) {
    const csvFile = basename(singleFile);
    // Domain is the parent directory name
    const domain = basename(dirname(singleFile));
    csvFiles = [{ domain, csvFile, csvPath: singleFile }];
  } else {
    csvFiles = discoverCsvFiles(tablesDir, name);
  }

  if (csvFiles.length === 0) {
    console.log('No CSV files found to import.');
    process.exit(0);
  }

  // Group by domain + schema type for batch processing
  const groups = new Map();
  for (const { domain, csvFile, csvPath } of csvFiles) {
    const classification = classifyCsvFile(csvFile);
    if (!classification) {
      console.warn(`  Skipping unrecognized CSV: ${csvFile}`);
      continue;
    }
    const key = `${domain}:${classification.schemaKey}`;
    if (!groups.has(key)) {
      groups.set(key, { domain, schemaKey: classification.schemaKey, csvs: [] });
    }
    groups.get(key).csvs.push({ ...classification, csvPath, csvFile });
  }

  let hasErrors = false;

  for (const [, group] of groups) {
    const { domain, schemaKey, csvs } = group;

    // Find the target YAML file, or create a new one if --name/--resource provided
    let found = findYamlForDomain(outDir, domain, schemaKey);
    if (!found) {
      if (schemaKey === 'state-machine-schema') {
        const effectiveName = name || domain;
        const effectiveResource = resource || 'RESOURCE';
        if (!name || !resource) {
          console.warn(`  Warning: --name and --resource not provided. Using placeholders (object: "${effectiveResource}", apiSpec: "${effectiveName}-openapi.yaml"). Edit the YAML to fix these.`);
        }
        const skeleton = createStateMachineSkeleton(effectiveName, effectiveResource, csvs, schemaRef);
        const filePath = resolve(outDir, `${effectiveName}-state-machine.yaml`);
        mkdirSync(dirname(filePath), { recursive: true });
        const content = serializeYaml(skeleton);
        writeFileSync(filePath, content, 'utf8');
        found = { filePath, doc: skeleton, rawContent: content };
        console.log(`  Created ${relative(outDir, filePath)}`);
      } else {
        console.error(`  No YAML file found for domain="${domain}" with schema containing "${schemaKey}"`);
        hasErrors = true;
        continue;
      }
    }

    let doc = { ...found.doc };

    // Apply each CSV to the document
    for (const csv of csvs) {
      const content = readFileSync(csv.csvPath, 'utf8');
      const parsed = parseCsv(content);

      switch (csv.section) {
        case 'transitions':
          doc = importTransitions(parsed, doc);
          break;
        case 'guards':
          doc = importGuards(parsed, doc);
          break;
        case 'sla':
          doc = importSla(parsed, doc);
          break;
        case 'request-bodies':
          doc = importRequestBodies(parsed, doc);
          break;
        case 'rules':
          doc = importRuleSet(parsed, doc, csv.ruleType);
          break;
        case 'metrics':
          doc = importMetrics(parsed, doc);
          break;
        case 'sla-types':
          doc = importSlaTypes(parsed, doc);
          break;
      }

      console.log(`  ${domain}/${csv.csvFile} → ${relative(outDir, found.filePath)}`);
    }

    // Validate against schema (skip if schema file not found)
    const schemaPath = resolve(dirname(found.filePath), doc.$schema);
    if (existsSync(schemaPath)) {
      const errors = validateAgainstSchema(doc, schemaPath);
      if (errors.length > 0) {
        console.error(`  Validation errors in ${relative(outDir, found.filePath)}:`);
        for (const err of errors) {
          console.error(`    - ${err}`);
        }
        hasErrors = true;
      }
    } else {
      console.log(`  Schema not found at ${doc.$schema}, skipping validation`);
    }

    // Write the updated YAML
    writeYaml(found.filePath, doc, found.rawContent);
  }

  if (hasErrors) {
    console.error('\nImport completed with errors.');
    process.exit(1);
  }

  console.log('\nImport completed successfully.');
}

main();
