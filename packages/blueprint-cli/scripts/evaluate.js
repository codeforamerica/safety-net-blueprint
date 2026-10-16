#!/usr/bin/env node
/**
 * Blueprint Evaluate CLI
 *
 * Evaluates a compiled rules graph — one `blueprint-resolve` built from the
 * whole contract set — against inputs, or against each example a rules
 * examples file declares for its ruleset.
 *
 * It never compiles a ruleset itself. A rules contract refers to schemas in
 * other files, so compiling one file on its own missed them: a date declared
 * in a shared schema reached CEL as a string. A graph is self-contained, so it
 * is what gets evaluated. Examples are ruleset inputs, the same shape a graph
 * takes, so they need no conversion.
 *
 * Usage:
 *   blueprint-evaluate --spec=<graph file>
 *   blueprint-evaluate --spec=<graph file> --input=<JSON>
 *   blueprint-evaluate --spec=<graph file> --examples=<rules examples file>
 *
 * Arguments:
 *   --spec=<path>       A compiled graph (*-graph.yaml).
 *   --input=<JSON>      Inline JSON string of named inputs (e.g. '{"household":{...}}').
 *                       Defaults to empty inputs.
 *   --examples=<path>   A rules examples file (*-rules-examples.yaml). Each example
 *                       it declares for the graph's ruleset is evaluated in turn.
 *
 * Output:
 *   --input:     flat JSON map of fact names to typed nodes
 *   --examples:  JSON array of those maps, one per example
 *
 * Exits 1 when any fact comes back in the `error` state, naming each, so a
 * ruleset that can't evaluate an example fails rather than passing quietly.
 *
 * Examples:
 *   blueprint-evaluate --spec=resolved/domains/intake/intake-interviewFlags-graph.yaml --input='{...}'
 *   blueprint-evaluate --spec=resolved/domains/intake/intake-interviewFlags-graph.yaml \
 *                      --examples=resolved/domains/intake/intake-rules-examples.yaml
 */

import { resolve, basename } from 'path';
import { load } from '@codeforamerica/blueprint-core';
import { evaluate } from '@codeforamerica/blueprint-rules-engine';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { spec: null, input: null, examples: null, help: false };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--spec=')) {
      options.spec = arg.slice('--spec='.length);
    } else if (arg.startsWith('--input=')) {
      options.input = arg.slice('--input='.length);
    } else if (arg.startsWith('--examples=')) {
      options.examples = arg.slice('--examples='.length);
    } else {
      console.error(`Error: Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/**
 * A contract file, identified by core from its `$schema`.
 *
 * @param {string} path
 * @returns {{ type: string, content: object }}
 */
function read(path) {
  const full = resolve(path);
  try {
    return load({ path: full, relativePath: basename(full) });
  } catch (err) {
    fail(`Could not read ${path}: ${err.message}`);
  }
}

/**
 * The examples a rules examples file declares for a graph's ruleset, matched
 * by what both declare — domain and ruleset name — not by where they sit.
 *
 * @param {object} examplesDoc
 * @param {object} graph
 * @param {string} path - For messages
 * @returns {object[]}
 */
function examplesFor(examplesDoc, graph, path) {
  if (examplesDoc.domain && graph.domain && examplesDoc.domain !== graph.domain) {
    fail(`${path} declares examples for domain "${examplesDoc.domain}", but the graph is for "${graph.domain}".`);
  }
  const examples = examplesDoc.rulesets?.[graph.ruleset]?.examples;
  if (!examples?.length) fail(`${path} declares no examples for ruleset "${graph.ruleset}".`);
  return examples;
}

/** Each fact that came back as an error, with where it came from. */
function errorsIn(runs) {
  return runs.flatMap(({ label, nodes }) => Object.entries(nodes)
    .filter(([, node]) => node?.state === 'error')
    .map(([fact, node]) => `${label}: ${fact}: ${node.message ?? 'error'}`));
}

function main() {
  const options = parseArgs();

  if (options.help) {
    console.log('Usage: blueprint-evaluate --spec=<graph file> [--input=<JSON> | --examples=<rules examples file>]');
    process.exit(0);
  }

  if (!options.spec) fail('--spec is required: a compiled graph (*-graph.yaml)');
  if (options.input && options.examples) fail('--input and --examples can\'t be combined');

  const { type, content: graph } = read(options.spec);
  if (type === 'rules' || type === 'rules-examples') {
    fail(`${options.spec} is a ${type} file, which can't be evaluated on its own. Run blueprint-resolve over the contracts and point --spec at the ruleset's compiled graph (*-graph.yaml)${type === 'rules-examples' ? ', with this file as --examples' : ''}.`);
  }
  if (type !== 'graph') fail(`${options.spec} is not a compiled rules graph (*-graph.yaml)`);

  let result;
  let runs;

  if (options.examples) {
    const { type: examplesType, content: examplesDoc } = read(options.examples);
    if (examplesType !== 'rules-examples') fail(`${options.examples} is not a rules examples file (*-rules-examples.yaml)`);
    const examples = examplesFor(examplesDoc, graph, options.examples);
    runs = examples.map((example, i) => ({
      label: `${graph.ruleset} example ${i + 1}${example.description ? ` (${example.description})` : ''}`,
      nodes: evaluate(graph, example.inputs ?? {}),
    }));
    result = runs.map(({ nodes }) => nodes);
  } else {
    let inputs = {};
    if (options.input) {
      try {
        inputs = JSON.parse(options.input);
      } catch (err) {
        fail(`--input is not valid JSON: ${err.message}`);
      }
    }
    result = evaluate(graph, inputs);
    runs = [{ label: graph.ruleset ?? basename(options.spec), nodes: result }];
  }

  console.log(JSON.stringify(result, null, 2));

  const errors = errorsIn(runs);
  if (errors.length > 0) {
    console.error(`\n${errors.length} fact(s) could not be evaluated:`);
    for (const line of errors) console.error(`  ${line}`);
    process.exit(1);
  }
}

main();
