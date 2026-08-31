#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { buildDependencyGraph, findCrossRulesheetAssembly, findCycles } from './build-graph.js';
import { toJson, parseCliArgs } from '../cli-utils.js';

function printUsage() {
  console.error('Usage: node src/graph-project.js <project.json> [--out <file.json>]');
  console.error('  <project.json> is the output of: node src/ingest-project.js <dir> --out <project.json>');
  console.error('Example: node src/ingest-project.js fixtures/corticon/government/dc-medicaid-chip --out generated/dc-medicaid-chip.json');
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
  // Carries the full Phase 1 project through alongside the derived graph, not just
  // the graph alone -- Phase 3 classification needs the original rule/ruleflow
  // detail (condition text, iterative flags, BranchContainer/connectorList shape)
  // that the graph itself doesn't retain, and each phase's script takes only the
  // *previous* phase's output as its input, so this file has to be a superset
  // rather than Phase 3 reaching back to Phase 1's output directly.
  writeFileSync(args.outFile, JSON.stringify({ project: toJson(project), graph: toJson(graph) }, null, 2));
  console.log(`Wrote project + full dependency graph to ${args.outFile}`);
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(JSON.stringify(summary, null, 2));
}
