#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { classifyProject } from './classify/classify-all.js';
import { buildDependencyGraph } from '../../graph/build-graph.js';
import { toJson, parseCliArgs } from '../../cli-utils.js';

function printUsage() {
  console.error('Usage: node src/classify-project.js <project.json> [--out <file.json>]');
  console.error('  <project.json> is the output of: node src/ingest-project.js <dir> --out <project.json>');
  console.error('Example: node src/ingest-project.js fixtures/corticon/government/dc-medicaid-chip --out generated/dc-medicaid-chip.json');
  console.error('         node src/classify-project.js generated/dc-medicaid-chip.json --out generated/dc-medicaid-chip-patterns.json');
}

const args = parseCliArgs(process.argv);
if (!args) {
  printUsage();
  process.exit(0);
}

const project = JSON.parse(readFileSync(args.positional, 'utf-8'));
const result = classifyProject(project);

if (args.outFile) {
  const serialized = toJson(result);
  const { ruleflowContext, ...classificationOnly } = serialized;
  writeFileSync(args.outFile, JSON.stringify({
    sourceFile: args.positional,
    sourceType: 'corticon',
    sourceContext: { ruleflowContext },
    classification: classificationOnly,
  }, null, 2));
  console.log(`Wrote classification to ${args.outFile}`);
}

if (args.graphFile) {
  const graph = buildDependencyGraph(project);
  const edges = graph.edges.map(({ from, to, rulesheet, ruleIndex }) => ({
    from, to, ruleId: `${basename(rulesheet)}:${ruleIndex}`,
  }));
  writeFileSync(args.graphFile, JSON.stringify(toJson({ nodes: [...graph.nodes], edges }), null, 2));
  console.log(`Wrote dependency graph to ${args.graphFile}`);
}

console.log(JSON.stringify({ patterns: result.patterns.length, sinkCandidates: Object.keys(result.sinkCandidates).length }, null, 2));
