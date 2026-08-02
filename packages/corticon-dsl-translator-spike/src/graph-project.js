#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { buildDependencyGraph, findCrossRulesheetAssembly, findCycles } from './graph/build-graph.js';
import { toJson, parseCliArgs } from './cli-utils.js';

function printUsage() {
  console.error('Usage: node src/graph-project.js <project.json> [--out <file.json>]');
  console.error('  <project.json> is the output of: node src/ingest-project.js <dir> --out <project.json>');
  console.error('Example: node src/ingest-project.js fixtures/dc-medicaid-chip --out generated/dc-medicaid-chip.json');
  console.error('         node src/graph-project.js generated/dc-medicaid-chip.json --out generated/dc-medicaid-chip.graph.json');
}

function summarize(graph) {
  return {
    nodeCount: graph.nodes.size,
    edgeCount: graph.edges.length,
    // Structural cycle candidates only -- not all of these are a genuine Decision 9
    // cycle needing manual redesign. See the comment on findCycles in build-graph.js.
    cycleCandidates: findCycles(graph),
    crossRulesheetAssembly: findCrossRulesheetAssembly(graph),
  };
}

const args = parseCliArgs(process.argv);
if (!args) {
  printUsage();
  process.exit(0);
}

const project = JSON.parse(readFileSync(args.positional, 'utf-8'));
const graph = buildDependencyGraph(project);
const summary = summarize(graph);

if (args.outFile) {
  writeFileSync(args.outFile, JSON.stringify(toJson(graph), null, 2));
  console.log(`Wrote full dependency graph to ${args.outFile}`);
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(JSON.stringify(summary, null, 2));
}
