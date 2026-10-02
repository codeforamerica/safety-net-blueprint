/**
 * Serializing a contract set and reading it back.
 *
 * `generate(docs, 'artifact')` and `extract(artifact, 'docs')` are a pair, and
 * what has to hold is that the second undoes the first — a page boots from the
 * artifact and must get documents indistinguishable from the ones Node built
 * by walking a directory (#448).
 *
 * The case that matters most is the methods. JSON cannot carry a function, so
 * a document read back from an artifact is data only unless something rebuilds
 * them. Nothing in the mock server's browser path called `model()` when this
 * was written, which is exactly why it needs a test: the failure would appear
 * the first time someone added an `extract(docs, 'relationships')` call, in a
 * page, and not in Node.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { discover } from '../../src/discover.js';
import { load } from '../../src/load.js';
import { extract } from '../../src/extract.js';
import { generate } from '../../src/generate.js';
import { ARTIFACT_VERSION } from '../../src/artifact.js';

function contractsIn(tree) {
  const dir = mkdtempSync(join(tmpdir(), 'artifact-test-'));
  for (const [relativePath, content] of Object.entries(tree)) {
    const file = join(dir, relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, yaml.dump(content), 'utf8');
  }
  return dir;
}

const TREE = {
  'domains/intake/intake-openapi.yaml': {
    openapi: '3.1.0',
    info: { title: 'Intake', version: '1.0.0', 'x-domain': 'intake' },
    paths: { '/applications': { get: { operationId: 'listApplications', responses: {} } } },
    components: { schemas: { Application: { type: 'object', properties: { id: { type: 'string' } } } } },
  },
  'domains/intake/intake-state-machine.yaml': {
    $schema: 'state-machine-schema.yaml',
    version: '1.0',
    domain: 'intake',
    apiSpec: 'intake-openapi.yaml',
    machines: [{
      object: 'Application',
      initialState: 'draft',
      states: [
        { id: 'draft', slaClock: 'stopped' },
        { id: 'submitted', slaClock: 'running' },
      ],
      actions: [{
        id: 'submit',
        transition: { from: 'draft', to: 'submitted' },
        steps: [{ set: { field: 'submittedAt', value: '$now' } }],
      }],
    }],
  },
  'domains/intake/intake-metrics.yaml': {
    $schema: 'https://blueprint.codeforamerica.org/schemas/metrics-schema.yaml',
    domain: 'intake',
    metrics: { applicationsReceived: { title: 'Applications received', unit: 'count' } },
  },
};

/** The two paths a set of documents can arrive by. */
function bothWays(tree) {
  const dir = contractsIn(tree);
  try {
    const fromDisk = discover(dir).map(load);
    const fromArtifact = extract(generate(fromDisk, 'artifact'), 'docs');
    return { fromDisk, fromArtifact };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('generate(docs, \'artifact\') and extract(artifact, \'docs\')', () => {

  test('round-trips through JSON, which is the only form a page can receive', () => {
    const dir = contractsIn(TREE);
    try {
      const docs = discover(dir).map(load);
      // Through an actual serialize/parse, not just the object — a value that
      // survives in memory but not through JSON would pass a weaker test.
      const artifact = JSON.parse(JSON.stringify(generate(docs, 'artifact')));
      const rebuilt = extract(artifact, 'docs');

      assert.equal(rebuilt.length, docs.length);
      assert.deepEqual(
        rebuilt.map((d) => d.relativePath).sort(),
        docs.map((d) => d.relativePath).sort()
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rebuilt documents carry the methods JSON dropped', () => {
    const { fromArtifact } = bothWays(TREE);
    for (const doc of fromArtifact) {
      for (const method of ['refs', 'externalRefs', 'resolveRef', 'model']) {
        assert.equal(typeof doc[method], 'function', `${doc.relativePath} should have ${method}()`);
      }
    }
  });

  test('model() gives the same normalized machine either way', () => {
    // The specific landmine: extract(docs, 'relationships') calls model(), and
    // a plain JSON document would throw rather than return null.
    const { fromDisk, fromArtifact } = bothWays(TREE);
    const machineOf = (docs) =>
      docs.find((d) => d.type === 'state-machine').model();

    assert.deepEqual(machineOf(fromArtifact), machineOf(fromDisk));
    // Non-null, so the comparison above is not two nulls agreeing.
    assert.equal(machineOf(fromArtifact).machines[0].object, 'Application');
  });

  test('extract reads the same facts from either source', () => {
    const { fromDisk, fromArtifact } = bothWays(TREE);
    for (const type of ['state-machines', 'metrics', 'config', 'sla-types', 'examples']) {
      assert.deepEqual(extract(fromArtifact, type), extract(fromDisk, type),
        `extract(docs, '${type}') must not depend on how the documents arrived`);
    }
  });

  test('relationships works from an artifact, which needs model()', () => {
    const { fromDisk, fromArtifact } = bothWays(TREE);
    assert.deepEqual(
      [...extract(fromArtifact, 'relationships').entries()],
      [...extract(fromDisk, 'relationships').entries()]
    );
  });

  test('the artifact carries no derived facts and no hash', () => {
    // Stated as a test because both were deliberately removed: derived data
    // would version-lock the file to the library that derived it, and a hash
    // covers bytes, which this does not have.
    const { fromDisk } = bothWays(TREE);
    const artifact = generate(fromDisk, 'artifact');

    assert.deepEqual(Object.keys(artifact).sort(), ['artifactVersion', 'docs']);
    assert.equal(artifact.artifactVersion, ARTIFACT_VERSION);
  });

  test('a document in the artifact is data only', () => {
    const { fromDisk } = bothWays(TREE);
    const [doc] = generate(fromDisk, 'artifact').docs;
    assert.deepEqual(
      Object.keys(doc).sort(),
      ['content', 'domain', 'path', 'provenance', 'relativePath', 'type']
    );
  });

  describe('refuses an artifact it cannot read', () => {
    const cases = [
      ['a non-object', 'nonsense'],
      ['null', null],
      ['an array', []],
      ['a future version', { artifactVersion: 99, docs: [{}] }],
      ['no documents', { artifactVersion: ARTIFACT_VERSION, docs: [] }],
      ['docs that are not an array', { artifactVersion: ARTIFACT_VERSION, docs: {} }],
    ];

    for (const [name, value] of cases) {
      test(name, () => {
        assert.throws(() => extract(value, 'docs'), /artifact/i,
          'the message must say what is wrong with the artifact, not fail deeper in');
      });
    }
  });
});
