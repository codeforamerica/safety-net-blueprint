#!/usr/bin/env node
/**
 * Rulespec classifier (CLI entry point).
 *
 * Usage: node src/sources/rulespec/classify-rulespec.js <rulespec.json> --out <patterns.json> [--graph <graph.json>]
 *
 * Reads the normalized rulespec.json produced by ingest-rulespec.js,
 * builds the dependency graph, identifies sink candidates, and writes
 * a patterns.json compatible with visualize-graph-html.js.
 * Optionally writes the dependency graph to a separate graph.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { toJson, parseCliArgs } from '../../cli-utils.js';
import { classifyRulespec } from './classify/classify-all.js';
import { buildSchemaGraph } from './classify/build-schema-graph.js';

const args = parseCliArgs(process.argv);
if (!args) {
  console.error('Usage: node src/sources/rulespec/classify-rulespec.js <rulespec.json> --out <patterns.json> [--graph <graph.json>]');
  process.exit(1);
}

const rulespec = JSON.parse(readFileSync(args.positional, 'utf-8'));
// Restore types Map from plain object
rulespec.types = new Map(Object.entries(rulespec.types ?? {}));

const { graph, sinkCandidates, patterns } = classifyRulespec(rulespec);

const output = {
  sourceFile: args.positional,
  sourceType: 'rulespec',
  classification: { sinkCandidates, patterns },
};

writeFileSync(args.outFile, JSON.stringify(toJson(output), null, 2));
console.log(`Wrote ${Object.keys(sinkCandidates).length} sink candidates and ${patterns.length} patterns to ${args.outFile}`);

if (args.graphFile) {
  writeFileSync(args.graphFile, JSON.stringify(toJson(graph), null, 2));
  console.log(`Wrote dependency graph to ${args.graphFile}`);
}

const schemaGraphIdx  = process.argv.indexOf('--schema-graph');
const schemaGraphFile = schemaGraphIdx >= 0 ? process.argv[schemaGraphIdx + 1] : null;
if (schemaGraphFile) {
  const schemaGraph = buildSchemaGraph(rulespec);
  writeFileSync(schemaGraphFile, JSON.stringify(schemaGraph, null, 2));
  console.log(`Wrote schema-conformant graph to ${schemaGraphFile}`);
}

const translationLogIdx  = process.argv.indexOf('--translation-log');
const translationLogFile = translationLogIdx >= 0 ? process.argv[translationLogIdx + 1] : null;
if (translationLogFile) {
  // Map pattern findings to the translation-log entry shape the visualizer expects.
  // If a node has both a generic pattern (expression/membership-test) AND a more
  // specific structural pattern (scalar-accumulator, composition, etc.), drop the
  // generic entry — the specific one is the meaningful classification.
  const GENERIC_PATTERNS = new Set(['expression', 'membership-test']);
  const nodesWithSpecific = new Set(
    patterns.filter(p => !GENERIC_PATTERNS.has(p.pattern)).map(p => p.node).filter(Boolean)
  );
  // A node is "translated" if the schema graph actually produced an expression for it.
  const schemaGraphForLog = buildSchemaGraph(rulespec);
  const schemaNodes = schemaGraphForLog.nodes ?? {};
  function findSchemaNode(nodeName) {
    const entry = Object.entries(schemaNodes).find(
      ([k]) => k === nodeName || k.endsWith('.' + nodeName)
    );
    return entry ? entry[1] : null;
  }
  function hasExpression(nodeName) {
    const n = findSchemaNode(nodeName);
    return !!(n?.expression);
  }
  const groupedEntries = {};
  for (const p of patterns.filter(p => !(GENERIC_PATTERNS.has(p.pattern) && nodesWithSpecific.has(p.node)))) {
    const schemaNode = findSchemaNode(p.node ?? '');
    const isTranslated = !!(schemaNode?.expression);
    const patternName = p.pattern ?? 'unknown';

    const rawObj = {};
    if (p.expression) rawObj.expression = p.expression;
    if (schemaNode?.type) rawObj.type = schemaNode.type;
    if (schemaNode?.default !== undefined) rawObj.default = schemaNode.default;

    const entry = {
      pattern:   patternName,
      node:      p.node ?? '',
      translated: isTranslated,
      status:    isTranslated ? 'confirmed' : 'unsupported',
      ...(p.variant ? { variant: p.variant } : {}),
      ...(Object.keys(rawObj).length ? { raw: rawObj } : {}),
      ...(schemaNode?.expression ? { compiled: { ...(schemaNode.type ? { type: schemaNode.type } : {}), expression: schemaNode.expression } } : {}),
    };

    if (!groupedEntries[patternName]) groupedEntries[patternName] = [];
    groupedEntries[patternName].push(entry);
  }
  // sinkCandidates left empty: visualizer auto-derives from graph edges (rulespec classifier
  // uses bare names, not the fully-qualified paths the schema requires).
  const translationLog = { entries: groupedEntries, sinkCandidates: {} };
  writeFileSync(translationLogFile, JSON.stringify(toJson(translationLog), null, 2));
  console.log(`Wrote translation log to ${translationLogFile}`);
}

console.log(JSON.stringify({ patterns: patterns.length, sinkCandidates: Object.keys(sinkCandidates).length }, null, 2));
