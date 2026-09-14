#!/usr/bin/env node
/**
 * Blueprint Evaluate CLI
 *
 * Evaluates a compiled graph or rules file against one or more input files.
 *
 * Usage:
 *   blueprint-evaluate --graph <path> [--inputs <path>]... [--ruleset <name>] [--engine cel|fact-graph]
 *
 * Arguments:
 *   --graph <path>     Path to a compiled graph (*-graph.yaml) or rules file (*-rules.yaml).
 *                      Type is detected automatically from the file's $schema field.
 *   --inputs <path>    Path to a JSON file of named inputs (repeatable).
 *                      Multiple --inputs files are merged in order.
 *   --ruleset <name>   Which ruleset to evaluate (rules files only; defaults to the first).
 *   --engine <name>    Evaluation engine: cel (default) or fact-graph.
 *
 * Output:
 *   JSON object with four buckets: complete, placeholder, missing, errors.
 *
 * Examples:
 *   blueprint-evaluate --graph snap-interview-probes-graph.yaml --inputs household.json
 *   blueprint-evaluate --graph snap-interview-probes-rules.yaml --inputs household.json --ruleset snapInterviewProbes
 *   blueprint-evaluate --graph snap-interview-probes-graph.yaml --inputs household.json --engine fact-graph
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { detectType } from '@codeforamerica/blueprint-core';
import { validateContract } from '@codeforamerica/blueprint-core/contract-validator';
import { evaluate, evaluateGraph } from '@codeforamerica/blueprint-rules-engine';
import { evaluateWithFactGraph, evaluateGraphWithFactGraph } from '@codeforamerica/blueprint-rules-engine/fact-graph';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { graph: null, inputs: [], ruleset: null, engine: 'cel', help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--graph=')) {
      options.graph = arg.slice('--graph='.length);
    } else if (arg === '--graph') {
      options.graph = args[++i];
    } else if (arg.startsWith('--inputs=')) {
      options.inputs.push(arg.slice('--inputs='.length));
    } else if (arg === '--inputs') {
      options.inputs.push(args[++i]);
    } else if (arg.startsWith('--ruleset=')) {
      options.ruleset = arg.slice('--ruleset='.length);
    } else if (arg === '--ruleset') {
      options.ruleset = args[++i];
    } else if (arg.startsWith('--engine=')) {
      options.engine = arg.slice('--engine='.length);
    } else if (arg === '--engine') {
      options.engine = args[++i];
    } else {
      console.error(`Error: Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

function main() {
  const options = parseArgs();

  if (options.help) {
    console.log('Usage: blueprint-evaluate --graph <path> [--inputs <path>]... [--ruleset <name>] [--engine cel|fact-graph]');
    process.exit(0);
  }

  if (!options.graph) {
    console.error('Error: --graph is required');
    process.exit(1);
  }

  if (options.engine !== 'cel' && options.engine !== 'fact-graph') {
    console.error(`Error: --engine must be "cel" or "fact-graph", got "${options.engine}"`);
    process.exit(1);
  }

  // Load the graph/rules file
  const graphPath = resolve(options.graph);
  let doc;
  try {
    doc = yaml.load(readFileSync(graphPath, 'utf8'));
  } catch (err) {
    console.error(`Error: Could not read ${options.graph}: ${err.message}`);
    process.exit(1);
  }

  const filename = graphPath.split('/').pop();
  const type = detectType(filename, doc);

  if (type !== 'graph' && type !== 'rules') {
    console.error(`Error: ${options.graph} is not a rules or compiled graph file (detected type: ${type || 'unknown'})`);
    process.exit(1);
  }

  // Validate before evaluating
  const validationErrors = validateContract(doc, filename);
  if (validationErrors.length > 0) {
    for (const { rule, message, path } of validationErrors) {
      console.error(`[${rule}] ${message}`);
      if (path) console.error(`  at: ${path}`);
    }
    process.exit(1);
  }

  // Merge all --inputs files into a single inputs object
  const inputs = {};
  for (const inputPath of options.inputs) {
    let inputDoc;
    try {
      inputDoc = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
    } catch (err) {
      console.error(`Error: Could not read ${inputPath}: ${err.message}`);
      process.exit(1);
    }
    Object.assign(inputs, inputDoc);
  }

  // Evaluate
  let result;
  if (type === 'graph') {
    result = options.engine === 'fact-graph'
      ? evaluateGraphWithFactGraph(doc, inputs)
      : evaluateGraph(doc, inputs);
  } else {
    result = options.engine === 'fact-graph'
      ? evaluateWithFactGraph(doc, inputs, options.ruleset)
      : evaluate(doc, inputs, options.ruleset);
  }

  console.log(JSON.stringify(result, null, 2));
}

main();
