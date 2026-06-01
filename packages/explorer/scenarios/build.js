#!/usr/bin/env node
/**
 * build.js
 *
 * Reads all scenario files from packages/contracts/scenarios/, parses each
 * Postman v2.1 collection, and renders:
 *   - A service blueprint HTML (using the scenario step model from parseScenario)
 *   - A sequence diagram HTML (using the flow format from postmanToFlow + renderFlow)
 */

import { readdirSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { parseScenario } from './src/parse-scenario.js';
import { postmanToFlow } from './src/postman-to-flow.js';
import { renderBlueprintHtml } from './src/render-blueprint.js';
import { renderFlow } from '../context-map/src/render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenariosDir = resolve(__dirname, '..', '..', 'contracts', 'scenarios');
const outputDir    = resolve(__dirname, 'output');

const pkgConfig = yaml.load(
  readFileSync(resolve(__dirname, '..', 'src', 'config.yaml'), 'utf8')
);

if (!existsSync(scenariosDir)) {
  console.error(`Scenarios directory not found: ${scenariosDir}`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

const jsonFiles = readdirSync(scenariosDir).filter(f => f.endsWith('.json'));

if (jsonFiles.length === 0) {
  console.log('No scenario files found.');
  process.exit(0);
}

function collectBroken(steps) {
  const broken = [];
  for (const step of steps) {
    if (step.broken) broken.push(step);
    if (step.steps)   broken.push(...collectBroken(step.steps));
    if (step.operands) for (const op of step.operands) broken.push(...collectBroken(op.steps || []));
  }
  return broken;
}

let hasErrors = false;

for (const file of jsonFiles) {
  const stem = basename(file, '.json');
  const filePath = join(scenariosDir, file);
  const collection = JSON.parse(readFileSync(filePath, 'utf8'));
  console.log(`Processing ${file}...`);

  const scenario = parseScenario(filePath);
  const blueprintPath = join(outputDir, `${stem}-blueprint.html`);
  writeFileSync(blueprintPath, renderBlueprintHtml(scenario));
  console.log(`  Wrote ${blueprintPath}`);

  const flow = postmanToFlow(collection, pkgConfig);

  const broken = collectBroken(flow.steps);
  if (broken.length > 0) {
    for (const step of broken) {
      console.error(`  ERROR: ${step.broken_description} (step: "${step.label}")`);
    }
    hasErrors = true;
    continue;
  }

  const sequencePath = join(outputDir, `${stem}-sequence.html`);
  const sequenceDiv = renderFlow(flow, pkgConfig);
  writeFileSync(sequencePath, `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>* { box-sizing:border-box; margin:0; padding:0; } body { background:#f5f5f5; padding:24px; }</style>
</head>
<body>${sequenceDiv}</body>
</html>`);
  console.log(`  Wrote ${sequencePath}`);
}

if (hasErrors) {
  console.error('\nBuild failed: scenario steps reference endpoints not defined in any contract.');
  console.error('Either add the endpoint to the relevant OpenAPI spec or state machine, or remove test assertions from the Postman request to mark it as an intentional gap.');
  process.exit(1);
}

console.log(`\nDone. ${jsonFiles.length} scenario(s) rendered to ${outputDir}`);
