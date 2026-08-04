#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { classifyProject } from './classify/classify-all.js';
import { toJson, parseCliArgs } from './cli-utils.js';

function printUsage() {
  console.error('Usage: node src/classify-project.js <project.json> [--out <file.json>]');
  console.error('  <project.json> is the output of: node src/ingest-project.js <dir> --out <project.json>');
  console.error('Example: node src/ingest-project.js fixtures/dc-medicaid-chip --out generated/dc-medicaid-chip.json');
  console.error('         node src/classify-project.js generated/dc-medicaid-chip.json --out generated/dc-medicaid-chip.classified.json');
}

function summarize(classification) {
  return Object.fromEntries(
    Object.entries(classification).map(([key, value]) => [key, Array.isArray(value) ? value.length : value])
  );
}

const args = parseCliArgs(process.argv);
if (!args) {
  printUsage();
  process.exit(0);
}

const project = JSON.parse(readFileSync(args.positional, 'utf-8'));
const classification = classifyProject(project);

if (args.outFile) {
  // Carries project through alongside the classification -- Phase 4 translation needs
  // the original rule/condition/action text to actually parse and compile expressions,
  // which the classification findings alone don't retain, and each phase's script
  // takes only the *previous* phase's output as input.
  writeFileSync(args.outFile, JSON.stringify({ project: toJson(project), classification: toJson(classification) }, null, 2));
  console.log(`Wrote project + classification to ${args.outFile}`);
}
console.log(JSON.stringify(summarize(classification), null, 2));
