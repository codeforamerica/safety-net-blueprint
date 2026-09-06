#!/usr/bin/env node
/**
 * Rulespec ingest (CLI entry point).
 *
 * Usage: node src/sources/rulespec/ingest-rulespec.js <rulespec.yaml> --out <rulespec.json>
 *
 * Reads a rulespec/v1 YAML file and writes a normalized rulespec.json,
 * matching the role of ingest-project.js in the Corticon pipeline.
 */
import { writeFileSync } from 'node:fs';
import { toJson, parseCliArgs } from '../../cli-utils.js';
import { loadRulespec } from './project.js';

const args = parseCliArgs(process.argv);
if (!args) {
  console.error('Usage: node src/sources/rulespec/ingest-rulespec.js <rulespec.yaml> --out <rulespec.json>');
  process.exit(1);
}

const rulespec = loadRulespec(args.positional);

if (args.outFile) {
  writeFileSync(args.outFile, JSON.stringify(toJson(rulespec), null, 2));
  console.log(`Wrote rulespec model to ${args.outFile}`);
  console.log(JSON.stringify({
    parameters: rulespec.parameters.length,
    dataRelations: rulespec.dataRelations.length,
    derivedRules: rulespec.derivedRules.length,
    types: rulespec.types.size,
  }, null, 2));
} else {
  console.log(JSON.stringify(toJson(rulespec), null, 2));
}
