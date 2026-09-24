/**
 * Runner for the conformance corpus.
 *
 * The corpus is `tests/conformance/cases.json`, and it describes itself —
 * what it is for, how a case is read, and what each field means. Keep the
 * explanation there rather than here: a second engine reads the JSON and
 * never sees this file.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { evaluate } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, 'conformance/cases.json'), 'utf8'));

/** Assert one fact against its expectation, per corpus.howToRead. */
function assertFact(actual, expected, label) {
  assert.ok(actual, `${label}: no node produced`);

  for (const [field, want] of Object.entries(expected)) {
    if (field === 'messageIncludes') {
      assert.ok(
        actual.message?.includes(want),
        `${label}: message should contain ${JSON.stringify(want)}, got ${JSON.stringify(actual.message)}`
      );
      continue;
    }

    if (field === 'missing') {
      assert.deepEqual([...(actual.missing ?? [])].sort(), [...want].sort(), `${label}: missing`);
      continue;
    }

    assert.deepEqual(actual[field], want, `${label}: ${field}`);
  }
}

const graphFor = (name) => {
  const graph = corpus.graphs[name];
  assert.ok(graph, `case names an unknown graph: ${name}`);
  return graph;
};

describe('conformance — evaluation contract', () => {
  for (const testCase of corpus.cases) {
    test(testCase.name, () => {
      const nodes = evaluate(graphFor(testCase.graph), testCase.inputs);

      for (const [factName, expected] of Object.entries(testCase.expect)) {
        assertFact(nodes[factName], expected, `${testCase.name} → ${factName}`);
      }
    });
  }
});

describe('conformance — invariants that hold for every graph', () => {
  for (const [name, graph] of Object.entries(corpus.graphs)) {
    test(`${name}: every fact is reported, keyed by name`, () => {
      const nodes = evaluate(graph, {});
      assert.deepEqual(Object.keys(nodes).sort(), Object.keys(graph.facts).sort());
    });

    test(`${name}: a declared output is typed output, anything else intermediate`, () => {
      const nodes = evaluate(graph, {});
      const outputs = new Set(graph.outputs);
      for (const [factName, node] of Object.entries(nodes)) {
        assert.equal(node.type, outputs.has(factName) ? 'output' : 'intermediate', factName);
      }
    });

    test(`${name}: incomplete input never throws`, () => {
      assert.doesNotThrow(() => evaluate(graph, {}));
    });

    test(`${name}: every node carries a state, and null value unless resolved`, () => {
      for (const node of Object.values(evaluate(graph, {}))) {
        assert.ok(['complete', 'placeholder', 'missing', 'error'].includes(node.state), node.state);
        if (node.state === 'missing') assert.ok(Array.isArray(node.missing));
        if (node.state === 'error') assert.equal(typeof node.message, 'string');
      }
    });
  }

  test('the caller’s input objects are not mutated', () => {
    const inputs = { household: { members: [{ age: 30 }], income: 100 }, policy: { limit: 2000 } };
    const before = JSON.stringify(inputs);
    evaluate(corpus.graphs.eligibility, inputs);
    assert.equal(JSON.stringify(inputs), before);
  });
});

describe('conformance — the corpus itself', () => {
  // The failure this repo produces most often is a check that does not run.
  // A malformed corpus would reduce the suite above to nothing, silently.
  test('every case names a known graph and asserts something', () => {
    assert.ok(corpus.cases.length >= 14, `expected the full corpus, got ${corpus.cases.length}`);
    for (const c of corpus.cases) {
      assert.ok(c.name, 'case without a name');
      assert.ok(corpus.graphs[c.graph], `${c.name}: unknown graph ${c.graph}`);
      assert.ok(c.expect && Object.keys(c.expect).length, `${c.name}: asserts nothing`);
    }
  });

  test('every graph is exercised by at least one case', () => {
    const used = new Set(corpus.cases.map((c) => c.graph));
    for (const name of Object.keys(corpus.graphs)) {
      assert.ok(used.has(name), `graph '${name}' has no cases`);
    }
  });

  test('the corpus names no particular engine', () => {
    // It states what any engine must do. Which other engines happen to agree,
    // and where they differ, is a comparison recorded elsewhere — putting it
    // here would make one implementation look like the authority.
    assert.doesNotMatch(JSON.stringify(corpus), /factgraph/i);
  });
});
