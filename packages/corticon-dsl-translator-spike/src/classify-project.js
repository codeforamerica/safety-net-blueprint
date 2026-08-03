#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { findCrossRulesheetAssembly } from './graph/build-graph.js';
import { resolveRuleflowContext } from './classify/ruleflow-context.js';
import { classifySelfLoops, classifyMultiHopCycles } from './classify/cycle-classifier.js';
import { classifyEntityCreation } from './classify/entity-creation-classifier.js';
import { classifyServiceCallouts } from './classify/service-callout-classifier.js';
import { classifyDecisionTableCombinatorics } from './classify/decision-table-classifier.js';
import { classifyFilters } from './classify/filter-classifier.js';
import { classifyExpressionPatterns } from './classify/expression-patterns.js';
import { toJson, parseCliArgs } from './cli-utils.js';

function printUsage() {
  console.error('Usage: node src/classify-project.js <project.graph.json> [--out <file.json>]');
  console.error('  <project.graph.json> is the output of: node src/graph-project.js <project.json> --out <project.graph.json>');
  console.error('Example: node src/graph-project.js generated/dc-medicaid-chip.json --out generated/dc-medicaid-chip.graph.json');
  console.error('         node src/classify-project.js generated/dc-medicaid-chip.graph.json --out generated/dc-medicaid-chip.classified.json');
}

/**
 * Runs every Phase 3 classifier against a Phase 2 {project, graph} model, matching
 * issue #388's pattern table: ruleflow-invocation-context-dependent classifications
 * (self-loops, multi-hop cycles) alongside classifications that only need the raw
 * graph (cross-rulesheet assembly, decision-table combinatorics) or only the project's
 * rulesheets/ruleflows directly (entity creation, service call-outs, filters, the
 * remaining expression patterns).
 */
function classify(project, graph) {
  const ruleflowContext = resolveRuleflowContext(project);
  return {
    ruleflowContext: {
      roots: ruleflowContext.roots,
      unreachableRulesheets: ruleflowContext.unreachable,
      multiInvokedRulesheets: ruleflowContext.multiInvoked,
    },
    selfLoops: classifySelfLoops(project, graph, ruleflowContext),
    multiHopCycles: classifyMultiHopCycles(graph, ruleflowContext),
    crossRulesheetAssembly: findCrossRulesheetAssembly(graph),
    decisionTableCombinatorics: classifyDecisionTableCombinatorics(graph),
    entityCreation: classifyEntityCreation(project),
    serviceCallouts: classifyServiceCallouts(project),
    filters: classifyFilters(project),
    expressionPatterns: classifyExpressionPatterns(project),
  };
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

const { project, graph } = JSON.parse(readFileSync(args.positional, 'utf-8'));
const classification = classify(project, graph);

if (args.outFile) {
  writeFileSync(args.outFile, JSON.stringify(toJson(classification), null, 2));
  console.log(`Wrote classification to ${args.outFile}`);
}
console.log(JSON.stringify(summarize(classification), null, 2));
