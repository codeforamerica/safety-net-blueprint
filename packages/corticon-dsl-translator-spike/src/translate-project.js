#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { buildFacts } from './translate/build-facts.js';
import { ENGINES, DEFAULT_ENGINE, resolveEngine } from './engines.js';
import { toJson, parseCliArgs } from './cli-utils.js';

function printUsage() {
  console.error('Usage: node src/translate-project.js <project.classified.json> [--engine <name>] [--out <file.json>]');
  console.error('  <project.classified.json> is the output of: node src/classify-project.js <project.graph.json> --out <project.classified.json>');
  console.error(`  --engine defaults to "${DEFAULT_ENGINE}". Known engines: ${Object.keys(ENGINES).join(', ')}`);
  console.error('  --out writes two files: <file>.json (the Fact declarations) and <file>.crosswalk.json (the Vocabulary<->Fact mapping)');
  console.error('Example: node src/classify-project.js generated/dc-medicaid-chip.graph.json --out generated/dc-medicaid-chip.classified.json');
  console.error('         node src/translate-project.js generated/dc-medicaid-chip.classified.json --out generated/dc-medicaid-chip.translated.json');
}

/** <name>.translated.json -> <name>.translated.crosswalk.json -- a sibling file, not a suffix replacing .json, so both remain obviously related by name. */
function crosswalkPathFor(outFile) {
  return outFile.endsWith('.json') ? `${outFile.slice(0, -'.json'.length)}.crosswalk.json` : `${outFile}.crosswalk.json`;
}

function summarize({ facts, crosswalk }) {
  const crosswalkByKind = {};
  for (const entry of crosswalk) {
    crosswalkByKind[entry.kind] = (crosswalkByKind[entry.kind] ?? 0) + 1;
  }
  return {
    factCount: facts.length,
    writableFactCount: facts.filter((f) => f.writable).length,
    derivedFactCount: facts.filter((f) => f.derived !== undefined).length,
    crosswalkCount: crosswalk.length,
    crosswalkByKind,
  };
}

const args = parseCliArgs(process.argv);
if (!args) {
  printUsage();
  process.exit(0);
}

let parseExpression;
try {
  ({ parseExpression } = await resolveEngine(args.engine ?? DEFAULT_ENGINE));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const { project, graph, classification } = JSON.parse(readFileSync(args.positional, 'utf-8'));
const translation = buildFacts(project, graph, classification, { parseExpression });
const summary = summarize(translation);

if (args.outFile) {
  const crosswalkOutFile = crosswalkPathFor(args.outFile);
  writeFileSync(args.outFile, JSON.stringify(toJson({ facts: translation.facts }), null, 2));
  writeFileSync(crosswalkOutFile, JSON.stringify(toJson({ crosswalk: translation.crosswalk }), null, 2));
  console.log(`Wrote Facts to ${args.outFile}`);
  console.log(`Wrote the Vocabulary<->Fact crosswalk to ${crosswalkOutFile}`);
}
console.log(JSON.stringify(summary, null, 2));
