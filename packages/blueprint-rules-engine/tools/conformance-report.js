#!/usr/bin/env node
/**
 * Run engines against the conformance corpus and report what each one does.
 *
 * The corpus states what any engine evaluating a Blueprint graph must
 * produce. This runs engines over it and records the outcome, so the contract
 * is checked against real implementations rather than assumed to be sound.
 *
 * Engines are entries in the list below. Adding one is a few lines: a name, a
 * version, and a function that evaluates a graph. Nothing else in this file
 * is specific to any of them.
 *
 *   node tools/conformance-report.js > CONFORMANCE.md
 *
 * Outcomes per case:
 *
 *   agrees          produced the nodes the corpus requires
 *   differs         produced something else — a question for both sides
 *   cannot express  the graph does not translate to that engine at all
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { evaluate } from '../src/index.js';
import { toFactGraph, evaluateWithFactGraph } from './fact-graph.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');

const corpus = JSON.parse(readFileSync(join(packageRoot, 'tests/conformance/cases.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

/**
 * Identify the vendored FactGraph build from its own header.
 *
 * The bundle carries no version of its own — it is a Scala.js build artifact.
 * Naming the path it sits at would be useless in a dated report, since the
 * path keeps pointing at whatever was vendored last. The upstream commit says
 * what source produced it, and the SHA-256 says which bytes were actually
 * run; `scripts/check-vendor.js` compares the same hash.
 */
function factGraphBuild() {
  const raw = readFileSync(join(packageRoot, 'vendor/fg.js'), 'utf8');
  const header = raw.match(/^\/\*\*[\s\S]*?\*\/\n/)?.[0] ?? '';
  const sha = createHash('sha256').update(raw.replace(header, '')).digest('hex');
  const commit = header.match(/Commit:\s*([0-9a-f]+)/)?.[1];
  const tree = header.match(/Tree:\s*(\S+)/)?.[1];

  const source = commit
    ? `built from [IRS-Public/direct-file@\`${commit}\`](${tree ?? `https://github.com/IRS-Public/direct-file/tree/${commit}`})`
    : 'upstream commit unrecorded';

  return `${source}, SHA-256 \`${sha}\``;
}

/**
 * The engines under comparison.
 *
 * `unsupported(graph)` reports facts the engine cannot represent at all,
 * mapping fact name to the reason. An engine that can express everything
 * returns an empty map.
 */
const engines = [
  {
    name: pkg.name,
    version: pkg.version,
    description:
      'The reference implementation in this repository: a CEL evaluator over the compiled graph, running in Node and the browser.',
    evaluate: (graph, inputs) => evaluate(graph, inputs),
    unsupported: () => new Map(),
  },
  {
    name: 'IRS Direct File FactGraph',
    version: factGraphBuild(),
    description:
      'A Scala engine compiled to JavaScript, and the only widely known prior art for partial evaluation over a dependency graph. Included because an independent implementation is the only way to tell whether the contract is sound or merely self-consistent. It is a comparison, not an authority.\n\n' +
      'The bundle is a Scala.js build artifact rather than an upstream file — Direct File consumes it as the workspace package `@irs/js-factgraph-scala@0.0.1`, which is not published to npm, so the commit above names the source it is built from, not a downloadable file. That source has a single commit: `IRS-Public/direct-file` was published as one drop on 2025-05-29 and `fact-graph-scala` has not changed since, so there is exactly one public version of it. Our copy is vendored at `packages/blueprint-rules-engine/vendor/fg.js` and pinned by SHA-256.',
    evaluate: (graph, inputs) => evaluateWithFactGraph(graph, inputs),
    unsupported: (graph) => {
      const untranslated = new Map();
      toFactGraph(graph, untranslated);
      return untranslated;
    },
    notes: [
      '**A wrong-type input throws rather than reporting.** The type-error case below reads as *agrees*, but only because the bridge in `tools/fact-graph.js` type-checks inputs before seeding and marks the dependent facts itself. Seeded directly, FactGraph raises `ClassCastException` and the whole evaluation is lost, including the facts that would have resolved. Reporting it as a node instead is a deliberate difference, and the reason the bridge exists.',
      '**Graphs are translated, not authored.** FactGraph reads its own XML dictionary, so each graph is converted by `toFactGraph`. A `cannot express` result means the translation has no equivalent for a construct, which is a limit of FactGraph\'s node vocabulary rather than of the corpus.',
      '**This is a development build, not a live instance.** The bundle is Scala.js `fastOptJS` output (7.1 MB), vendored into this repository rather than obtained from a running Direct File deployment. Declared versions upstream are `gov.irs.factgraph:fact-graph:0.1.0-SNAPSHOT` on Scala 3.3.3, exposed to Direct File\'s client as `@irs/js-factgraph-scala@0.0.1` — neither is a release, and both are constant across the repository\'s single code commit, so the commit and hash above are the only real identifiers. Running against a real instance would be the stronger comparison.',
    ],
  },
];

/** Compare one node against what the corpus requires, per corpus.howToRead. */
function matches(actual, expected) {
  if (!actual) return false;

  for (const [field, want] of Object.entries(expected)) {
    if (field === 'messageIncludes') {
      if (!actual.message?.includes(want)) return false;
      continue;
    }
    if (field === 'missing') {
      const got = [...(actual.missing ?? [])].sort();
      if (JSON.stringify(got) !== JSON.stringify([...want].sort())) return false;
      continue;
    }
    if (JSON.stringify(actual[field]) !== JSON.stringify(want)) return false;
  }
  return true;
}

/**
 * Render a value for the report.
 *
 * An engine may hold a number in its own representation — FactGraph returns
 * an exact fraction as its Scala fields, which is unreadable in a table and
 * is usually the point of the finding.
 */
function show(value) {
  if (value && typeof value === 'object') {
    const n = value['Lgov_irs_factgraph_types_Rational__f_n'];
    const d = value['Lgov_irs_factgraph_types_Rational__f_d'];
    if (n !== undefined && d !== undefined) return `${n}/${d} (exact fraction)`;
  }
  return JSON.stringify(value);
}

function runCase(engine, testCase) {
  const graph = corpus.graphs[testCase.graph];
  const asserted = Object.keys(testCase.expect);

  const unsupported = engine.unsupported(graph);
  const blocked = asserted.filter((fact) => unsupported.has(fact));
  if (blocked.length) {
    return {
      outcome: 'cannot express',
      detail: blocked.map((f) => `\`${f}\`: ${unsupported.get(f).split(' in:')[0]}`).join('; '),
    };
  }

  let nodes;
  try {
    nodes = engine.evaluate(graph, testCase.inputs);
  } catch (err) {
    return { outcome: 'differs', detail: `threw: ${(err.message ?? String(err)).slice(0, 120)}` };
  }

  const wrong = asserted.filter((fact) => !matches(nodes[fact], testCase.expect[fact]));
  if (!wrong.length) return { outcome: 'agrees', detail: '' };

  const detail = wrong
    .map((f) => {
      const want = Object.entries(testCase.expect[f])
        .map(([k, v]) => `${k}=${show(v)}`)
        .join(', ');
      const actual = nodes[f];
      const got = [
        `state=${JSON.stringify(actual?.state)}`,
        actual?.value !== undefined ? `value=${show(actual.value)}` : null,
        actual?.missing ? `missing=${JSON.stringify(actual.missing)}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return `\`${f}\` — required ${want}; produced ${got}`;
    })
    .join('; ');

  return { outcome: 'differs', detail };
}

// The FactGraph bundle logs "Parsing N facts" to stdout as it imports a
// dictionary, which lands in the middle of the report. Silence console output
// while the engines run; the report is written to stdout directly at the end.
const realLog = console.log;
console.log = () => {};

const report = engines.map((engine) => ({
  engine,
  results: corpus.cases.map((testCase) => ({ testCase, ...runCase(engine, testCase) })),
}));

console.log = realLog;

const lines = [];
const p = (s = '') => lines.push(s);
const tally = (results, outcome) => results.filter((r) => r.outcome === outcome).length;

p('# Rules conformance report');
p();
p('> Generated by `packages/blueprint-rules-engine/tools/conformance-report.js`. Do not edit by hand — re-run it.');
p();
p(`**Run:** ${new Date().toISOString().slice(0, 10)}  `);
p(`**Corpus:** \`packages/blueprint-rules-engine/tests/conformance/cases.json\` — ${corpus.cases.length} cases over ${Object.keys(corpus.graphs).length} graphs`);
p();
p('## What this is');
p();
p('The conformance corpus states what *any* engine evaluating a Blueprint graph must produce. It names no particular engine. This report is the result of running engines against it.');
p();
p('The blueprint does not mandate an evaluation engine — the reference implementation is replaceable by any engine that satisfies the contract. That claim is only meaningful if there is something concrete to satisfy, and something that reports whether an engine does. This is that report.');
p();
p('**The design of conformance as a contract artifact is still a work in progress.** The corpus currently lives as JSON inside the reference implementation\'s tests rather than as a first-class contract artifact with a schema, a naming convention, and validation alongside the other contract types. Treat its location and format as provisional; the behaviours it pins are not.');
p();
p('## Method');
p();
p('Each case names a graph, the inputs to evaluate it against, and the nodes an engine must produce. Each engine is given the same graph and inputs, and its output is compared against the same expectations, using the corpus\'s own matching rules — only the fields a case lists are asserted, `missing` is compared as a set, and `messageIncludes` is a substring check.');
p();
p('| outcome | meaning |');
p('|---|---|');
p('| **agrees** | produced the nodes the corpus requires |');
p('| **differs** | produced something else |');
p('| **cannot express** | the graph does not translate to that engine, so the case cannot be run |');
p();
p('A `differs` result is a question, not a verdict. It may mean the engine is wrong, or that the corpus has encoded something it should not.');
p();
p('## Summary');
p();
p('| engine | agrees | differs | cannot express | total |');
p('|---|---|---|---|---|');
for (const { engine, results } of report) {
  p(`| ${engine.name} | ${tally(results, 'agrees')} | ${tally(results, 'differs')} | ${tally(results, 'cannot express')} | ${results.length} |`);
}
p();

for (const { engine, results } of report) {
  p(`## ${engine.name}`);
  p();
  p(`**Version:** ${engine.version}`);
  p();
  p(engine.description);
  p();
  if (engine.notes?.length) {
    p('### Notes on this comparison');
    p();
    for (const note of engine.notes) p(`- ${note}`);
    p();
  }
  p('| case | graph | outcome | detail |');
  p('|---|---|---|---|');
  for (const r of results) {
    p(`| ${r.testCase.name} | ${r.testCase.graph} | ${r.outcome} | ${r.detail || '—'} |`);
  }
  p();

  const notable = results.filter((r) => r.outcome !== 'agrees');
  if (!notable.length) {
    p('Every case in the corpus passes.');
    p();
    continue;
  }

  p(`### Findings`);
  p();
  for (const r of notable) {
    p(`#### ${r.testCase.name}`);
    p();
    p(`**Outcome:** ${r.outcome}  `);
    p(`**Detail:** ${r.detail}`);
    p();
    if (r.testCase.note) {
      p(`**Why the corpus requires this:** ${r.testCase.note}`);
      p();
    }
  }
}

process.stdout.write(lines.join('\n'));
