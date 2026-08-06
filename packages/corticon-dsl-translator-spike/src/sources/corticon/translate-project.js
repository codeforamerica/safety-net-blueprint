#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { buildDependencyGraph } from '../../graph/build-graph.js';
import { buildFacts } from './translate/build-facts.js';
import { ENGINES, DEFAULT_ENGINE, resolveEngine } from '../../engines.js';
import { toJson, parseCliArgs } from '../../cli-utils.js';

function printUsage() {
  console.error('Usage: node src/translate-project.js <project.patterns.json> [--engine <name>] [--out <file.json>]');
  console.error('  <project.patterns.json> is the output of: node src/classify-project.js <project.json> --out <project.patterns.json>');
  console.error(`  --engine defaults to "${DEFAULT_ENGINE}". Known engines: ${Object.keys(ENGINES).join(', ')}`);
  console.error('  --out writes two files: <file>.json (facts) and <file>.translation-log.json (translation log)');
  console.error('Example: node src/classify-project.js generated/dc-medicaid-chip.json --out generated/dc-medicaid-chip.patterns.json');
  console.error('         node src/translate-project.js generated/dc-medicaid-chip.patterns.json --out generated/dc-medicaid-chip.dsl.json');
}

function graphPathFor(outFile) {
  if (outFile.endsWith('-blueprint-dsl.json'))
    return outFile.slice(0, -'blueprint-dsl.json'.length) + 'graph.json';
  return outFile.endsWith('.json') ? `${outFile.slice(0, -5)}.graph.json` : `${outFile}.graph.json`;
}

function summarize({ facts, translationLog }) {
  const byPattern = {};
  for (const entry of translationLog) {
    byPattern[entry.pattern] = (byPattern[entry.pattern] ?? 0) + 1;
  }
  return {
    factCount: facts.length,
    writableFactCount: facts.filter((f) => f.writable).length,
    derivedFactCount: facts.filter((f) => f.expression !== undefined).length,
    translationLogCount: translationLog.length,
    byPattern,
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

const { sourceFile, classification } = JSON.parse(readFileSync(args.positional, 'utf-8'));
const project = JSON.parse(readFileSync(sourceFile, 'utf-8'));
const graph = buildDependencyGraph(project);
const translation = buildFacts(project, graph, classification, { parseExpression });
const summary = summarize(translation);

if (args.outFile) {
  const graphOutFile = graphPathFor(args.outFile);

  // Attach per-fact meta (pattern, ruleId, note) and fold in translation log
  const translationByPath = new Map();
  for (const entry of translation.translationLog) {
    if (entry.factPath && !translationByPath.has(entry.factPath)) {
      translationByPath.set(entry.factPath, entry);
    }
  }
  const factsWithMeta = translation.facts.map((fact) => {
    const logEntry = translationByPath.get(fact.path);
    if (!logEntry) return fact;
    const { pattern, note, ruleId, sourcePath } = logEntry;
    return { ...fact, meta: Object.fromEntries(Object.entries({ pattern, ruleId, sourcePath, note }).filter(([, v]) => v != null)) };
  });

  writeFileSync(args.outFile, JSON.stringify(toJson({ facts: factsWithMeta, translationLog: translation.translationLog }), null, 2));

  const edges = graph.edges.map(({ from, to, rulesheet, ruleIndex }) => ({ from, to, ruleId: `${rulesheet}:${ruleIndex}` }));

  writeFileSync(graphOutFile, JSON.stringify(toJson({
    nodes: [...graph.nodes],
    edges,
  }), null, 2));

  console.log(`Wrote blueprint-dsl to ${args.outFile}`);
  console.log(`Wrote graph to ${graphOutFile}`);
}
console.log(JSON.stringify(summary, null, 2));
