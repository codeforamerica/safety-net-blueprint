#!/usr/bin/env node
/**
 * validate-definitions.js
 *
 * Validates a blueprint definitions YAML file against definitions-schema.json.
 *
 * Usage:
 *   node validate-definitions.js src/blueprints/intake-definitions.yaml
 *   npm run validate -- src/blueprints/intake-definitions.yaml
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Ajv from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node validate-definitions.js <definitions.yaml>');
  process.exit(1);
}

const schemaPath = resolve(__dirname, 'src/blueprints/definitions-schema.json');

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
  const actorToLane = new Map();
  for (const lane of definitions.lanes) {
    for (const actor of (lane.actors ?? [])) {
      actorToLane.set(actor, lane.id);
    }
  }

  for (const phase of definitions.phases) {
    // Check extras reference valid lane IDs
    for (const laneId of Object.keys(phase.extras ?? {})) {
      if (!laneIds.has(laneId)) {
        warnings.push(`Phase '${phase.id}': extras references unknown lane '${laneId}'`);
      }
    }

    // Check person-action cards in extras have actor field
    for (const [laneId, cards] of Object.entries(phase.extras ?? {})) {
      for (const card of cards) {
        if (card.type === 'person-action' && !card.actor) {
          warnings.push(`Phase '${phase.id}', lane '${laneId}': person-action card "${card.text}" is missing 'actor' field`);
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
