#!/usr/bin/env node
/**
 * validate-definitions.js
 *
 * Validates a blueprint context YAML file against definitions-schema.json.
 *
 * Usage:
 *   node validate-definitions.js ../config/intake-context.yaml
 *   npm run validate -- ../config/intake-context.yaml
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Ajv from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node validate-definitions.js <context.yaml>');
  process.exit(1);
}

const schemaPath = resolve(__dirname, 'definitions-schema.json');

let definitions, schema;

try {
  definitions = yaml.load(readFileSync(resolve(inputPath), 'utf8'));
} catch (err) {
  console.error(`Failed to parse ${inputPath}: ${err.message}`);
  process.exit(1);
}

try {
  schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
} catch (err) {
  console.error(`Failed to load schema: ${err.message}`);
  process.exit(1);
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
const valid = validate(definitions);

if (valid) {
  console.log(`✓ ${inputPath} is valid`);

  // Additional semantic checks beyond JSON Schema
  const warnings = [];

  const laneIds = new Set(definitions.lanes.map(l => l.id));

  for (const phase of definitions.phases) {
    for (const subPhase of (phase.subPhases ?? [])) {

      // Check cards reference valid lane IDs
      for (const laneId of Object.keys(subPhase.cards ?? {})) {
        if (!laneIds.has(laneId)) {
          warnings.push(`Sub-phase '${subPhase.id}': cards references unknown lane '${laneId}'`);
        }
      }

      // Check explicit person-action cards have an actor field
      for (const [laneId, cardItems] of Object.entries(subPhase.cards ?? {})) {
        for (const item of cardItems) {
          if (item.type === 'person-action' && !item.actor) {
            warnings.push(`Sub-phase '${subPhase.id}', lane '${laneId}': person-action card "${item.text}" is missing 'actor' field`);
          }
        }
      }
    }
  }

  if (warnings.length > 0) {
    console.warn('\nWarnings:');
    for (const w of warnings) console.warn(`  ⚠ ${w}`);
    process.exit(0);
  }
} else {
  console.error(`✗ ${inputPath} is invalid:\n`);
  for (const err of validate.errors) {
    const path = err.instancePath || '(root)';
    console.error(`  ${path}: ${err.message}`);
  }
  process.exit(1);
}
