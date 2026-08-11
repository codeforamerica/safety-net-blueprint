#!/usr/bin/env node
/**
 * Rulespec → blueprint-dsl translator (CLI entry point).
 *
 * Usage: node src/sources/rulespec/translate-rulespec.js <rulespec.json> --out <blueprint-dsl.json>
 *
 * Reads the normalized rulespec.json produced by ingest-rulespec.js and
 * writes a blueprint-dsl.json with facts and translationLog, matching the
 * same output format as the Corticon translate-project.js pipeline stage.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildFacts } from './translate/build-facts.js';
import { parseCliArgs } from '../../cli-utils.js';

const args = parseCliArgs(process.argv);
if (!args) {
  console.error('Usage: node src/sources/rulespec/translate-rulespec.js <rulespec.json> --out <blueprint-dsl.json>');
  process.exit(1);
}

const rulespec = JSON.parse(readFileSync(args.positional, 'utf-8'));
// Restore Maps from plain objects (JSON serialization flattens them).
rulespec.types = new Map(Object.entries(rulespec.types ?? {}));

const result = buildFacts(rulespec, args.domain, args.graphName);

writeFileSync(args.outFile, JSON.stringify(result, null, 2));
console.log(`Wrote ${result.facts.length} facts to ${args.outFile}`);
