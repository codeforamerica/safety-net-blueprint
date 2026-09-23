#!/usr/bin/env node
/**
 * Blueprint Evaluate CLI
 *
 * Evaluates a compiled graph or rules file against a set of inputs.
 * When given a rules-examples file, runs all rulesets/examples in batch mode.
 *
 * Usage:
 *   blueprint-evaluate --spec=<path> [--ruleset=<name>] [--input=<JSON>] [--engine=cel|fact-graph]
 *
 * Arguments:
 *   --spec=<path>      Path to a compiled graph (*-graph.yaml), rules file (*-rules.yaml),
 *                      or rules examples file (*-rules-examples.yaml).
 *                      Type is detected automatically from the file's $schema field.
 *   --input=<JSON>     Inline JSON string of named inputs (e.g. '{"household":{...}}').
 *                      Defaults to empty inputs when omitted.
 *   --ruleset=<name>   Which ruleset to evaluate (rules files only; defaults to the first).
 *   --engine=<name>    Evaluation engine: cel (default) or fact-graph.
 *
 * Output:
 *   Graph/rules:         flat JSON map of fact names to typed nodes
 *   Rules-examples file: { [ruleset]: [ ...per-example node maps ] }
 *
 * Examples:
 *   blueprint-evaluate --spec=snap-graph.yaml --input='{"household":{"size":4}}'
 *   blueprint-evaluate --spec=snap-rules.yaml --ruleset=snapProbes
 *   blueprint-evaluate --spec=snap-rules-examples.yaml
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { generate } from '@codeforamerica/blueprint-core';
import { evaluate } from '@codeforamerica/blueprint-rules-engine';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { spec: null, input: null, ruleset: null, engine: 'cel', help: false };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--spec=')) {
      options.spec = arg.slice('--spec='.length);
    } else if (arg.startsWith('--input=')) {
      options.input = arg.slice('--input='.length);
    } else if (arg.startsWith('--ruleset=')) {
      options.ruleset = arg.slice('--ruleset='.length);
    } else if (arg.startsWith('--engine=')) {
      options.engine = arg.slice('--engine='.length);
    } else {
      console.error(`Error: Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

function loadFile(path) {
  try {
    return yaml.load(readFileSync(resolve(path), 'utf8'));
  } catch (err) {
    console.error(`Error: Could not read ${path}: ${err.message}`);
    process.exit(1);
  }
}

function detectType(doc) {
  const schema = doc.$schema ?? '';
  if (schema.includes('graph-schema')) return 'graph';
  if (schema.includes('rules-examples-schema')) return 'examples';
  if (schema.includes('rules-schema')) return 'rules';
  return null;
}

function evaluateGraph(graph, inputs) {
  return evaluate(graph, inputs);
}

/**
 * The compiled graph for one ruleset.
 *
 * Compilation is `generate`'s job; it returns a graph per ruleset with the
 * name it came from, so there is nothing to compile here.
 *
 * @param {object} rulesDoc - Parsed rules contract
 * @param {string} rulesetName
 * @returns {object}
 */
function graphFor(rulesDoc, rulesetName) {
  const graphs = generate([
    { path: 'rules.yaml', relativePath: 'rules.yaml', type: 'rules', content: rulesDoc,
      refs: () => new Map(), model: () => null, domain: rulesDoc.domain ?? null,
      resolved: false, provenance: null },
  ], 'graph');
  const found = graphs.find((g) => g.graph.ruleset === rulesetName);
  if (!found) {
    console.error(`Error: Ruleset "${rulesetName}" produced no graph`);
    process.exit(1);
  }
  return found.graph;
}

function evaluateRules(doc, inputs, rulesetName) {
  const rulesets = doc.rulesets ?? {};
  const name = rulesetName ?? Object.keys(rulesets)[0];
  const ruleset = rulesets[name];
  if (!ruleset) {
    console.error(`Error: Ruleset "${name}" not found`);
    process.exit(1);
  }
  return evaluate(graphFor(doc, name), inputs);
}

function evaluateExamples(doc, specPath) {
  // Discover companion *-rules.yaml in the same directory
  const companionPath = specPath.replace(/-rules-examples\.yaml$/, '-rules.yaml');
  const rulesDoc = loadFile(companionPath);
  const rulesets = rulesDoc.rulesets ?? {};

  const result = {};
  for (const [rulesetName, rulesetExamples] of Object.entries(doc.rulesets ?? {})) {
    const ruleset = rulesets[rulesetName];
    if (!ruleset) {
      console.error(`Error: Ruleset "${rulesetName}" not found in companion rules file`);
      process.exit(1);
    }
    const graph = graphFor(rulesDoc, rulesetName);
    const examples = rulesetExamples.examples ?? [];
    result[rulesetName] = examples.map(example => evaluate(graph, example.inputs ?? {}));
  }
  return result;
}

function main() {
  const options = parseArgs();

  if (options.help) {
    console.log('Usage: blueprint-evaluate --spec=<path> [--input=<JSON>] [--ruleset=<name>] [--engine=cel|fact-graph]');
    process.exit(0);
  }

  if (!options.spec) {
    console.error('Error: <file> is required');
    process.exit(1);
  }

  if (options.engine !== 'cel' && options.engine !== 'fact-graph') {
    console.error(`Error: --engine must be "cel" or "fact-graph", got "${options.engine}"`);
    process.exit(1);
  }

  const doc = loadFile(options.spec);
  const type = detectType(doc);

  if (!type) {
    console.error(`Error: ${options.spec} is not a recognized blueprint contract file (no $schema field)`);
    process.exit(1);
  }

  // Parse inputs (examples mode ignores --input; each example carries its own)
  let inputs = {};
  if (options.input) {
    try {
      inputs = JSON.parse(options.input);
    } catch (err) {
      console.error(`Error: --input is not valid JSON: ${err.message}`);
      process.exit(1);
    }
  }

  let result;
  if (type === 'graph') {
    result = evaluateGraph(doc, inputs);
  } else if (type === 'rules') {
    result = evaluateRules(doc, inputs, options.ruleset);
  } else {
    // examples — batch mode
    result = evaluateExamples(doc, resolve(options.spec));
  }

  console.log(JSON.stringify(result, null, 2));
}

main();
