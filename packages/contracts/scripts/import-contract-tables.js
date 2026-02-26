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
    console.log('  --file=<path>      Import only this CSV file');
    console.log('  -h, --help         Show this help message');
    process.exit(0);
  }

  // Check for unknown arguments
  const unknown = args.filter(a =>
    a !== '--help' && a !== '-h' &&
    !a.startsWith('--tables=') && !a.startsWith('--out=') && !a.startsWith('--file=') &&
    !a.startsWith('--name=') && !a.startsWith('--resource=')
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

  return {
    tablesDir: tablesArg ? resolve(tablesArg.split('=')[1]) : resolve(packageRoot, '../../docs/contract-tables'),
    outDir: outArg ? resolve(outArg.split('=')[1]) : packageRoot,
    singleFile: fileArg ? resolve(fileArg.split('=')[1]) : null,
    name: nameArg ? nameArg.split('=')[1] : null,
    resource: resourceArg ? resourceArg.split('=')[1] : null,
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

function importTransitions(csvData, existingDoc) {
  const doc = { ...existingDoc };
  const transitions = [];
  let onCreate = null;

  for (const row of csvData.data) {
    const [from, to, trigger, actors, guards, effects] = row;

    if (from === '(create)') {
      onCreate = {
        actors: actors ? actors.split('; ').map(a => a.trim()).filter(Boolean) : [],
        effects: existingDoc.onCreate?.effects || [],
      };
      continue;
    }

    // Find matching existing transition to preserve full effects
    const existingTransition = (existingDoc.transitions || []).find(
      t => t.trigger === trigger && t.from === from && t.to === to
    );

    transitions.push({
      trigger,
      from,
      to,
      actors: actors ? actors.split('; ').map(a => a.trim()).filter(Boolean) : [],
      guards: guards ? guards.split('; ').map(g => g.trim()).filter(Boolean) : [],
      effects: existingTransition?.effects || [],
    });
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
  const metrics = csvData.data.map(row => {
    const [name, description, sourceType, sourceDetails, targetStr] = row;

    // Find existing metric to preserve id and full structure
    const existing = (existingDoc.metrics || []).find(m => (m.name || m.id) === name);

    // Parse source details (key=value pairs separated by '; ')
    const source = { type: sourceType };
    if (sourceDetails) {
      for (const pair of sourceDetails.split('; ')) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0) {
          source[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
        }
      }
    }

    // Parse targets (e.g., "p95 < 4h; trend down")
    const targets = targetStr ? targetStr.split('; ').map(t => {
      const parts = t.split(' ');
      const target = { stat: parts[0] };
      if (parts.length >= 3) {
        target.operator = parts[1];
        target.value = parts[2];
      } else if (parts.length === 2) {
        target.direction = parts[1];
      }
      return target;
    }) : [];

    return {
      id: existing?.id || name.toLowerCase().replace(/\s+/g, '_'),
      name,
      description: description || undefined,
      source,
      targets,
    };
  });

  doc.metrics = metrics;
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
function createStateMachineSkeleton(domain, resource, csvs) {
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
    $schema: './schemas/state-machine-schema.yaml',
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
  const { tablesDir, outDir, singleFile, name, resource } = parseArgs();

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
        const skeleton = createStateMachineSkeleton(effectiveName, effectiveResource, csvs);
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
