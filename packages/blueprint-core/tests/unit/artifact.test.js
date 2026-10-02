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
      ['content', 'domain', 'provenance', 'relativePath', 'type']
    );
  });

  test('carries nothing about the machine that built it', () => {
    // The harness artifact is committed and inlined into standalone.html, so
    // an absolute path published the build machine's home directory — and the
    // username in it — once per document. The whole serialized form is checked
    // rather than the `path` field, because the point is that the directory
    // does not appear anywhere.
    const dir = contractsIn(TREE);
    try {
      const artifact = generate(discover(dir).map(load), 'artifact');
      assert.ok(artifact.docs.length > 0);
      for (const doc of artifact.docs) assert.equal(doc.path, undefined);
      assert.ok(!JSON.stringify(artifact).includes(dir), 'artifact names its build directory');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the same contract set serializes to the same bytes', () => {
    // Nothing in here is derived from when or where the build ran, which is
    // what makes a committed artifact reviewable: a diff means a contract
    // changed.
    const { fromDisk } = bothWays(TREE);
    assert.equal(
      JSON.stringify(generate(fromDisk, 'artifact')),
      JSON.stringify(generate(fromDisk, 'artifact'))
    );
  });

  test('a document read back has a path, which is its place in the set', () => {
    // Readers take the last segment of `path` for a filename, so it cannot be
    // undefined just because the artifact does not store one.
    const { fromDisk } = bothWays(TREE);
    const [doc] = extract(generate(fromDisk, 'artifact'), 'docs');
    assert.equal(doc.path, doc.relativePath);
    assert.ok(doc.path);
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

describe('generate(docs, \'artifact\', { domains })', () => {
  /**
   * A set shaped like the real one: a domain whose spec reaches into shared
   * files belonging to no domain, a second domain to exclude, and platform.
   */
  const SPLIT = {
    'base/components/parameters.yaml': { LimitParam: { in: 'query', name: 'limit', schema: { type: 'integer' } } },
    'common/schemas/shared.yaml': {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: { Money: { type: 'object', properties: { cents: { type: 'integer' } } } },
    },
    'domains/intake/intake-openapi.yaml': {
      openapi: '3.1.0',
      info: { title: 'Intake', version: '1.0.0', 'x-domain': 'intake' },
      paths: {
        '/applications': {
          get: {
            operationId: 'listApplications',
            parameters: [{ $ref: '../../base/components/parameters.yaml#/LimitParam' }],
            responses: {},
          },
        },
      },
      components: {
        schemas: { Application: { type: 'object', properties: { fee: { $ref: '../../common/schemas/shared.yaml#/$defs/Money' } } } },
      },
    },
    'domains/intake/intake-mock-data.yaml': { ApplicationExample1: { value: { fee: { cents: 1 } } } },
    'domains/billing/billing-openapi.yaml': {
      openapi: '3.1.0',
      info: { title: 'Billing', version: '1.0.0', 'x-domain': 'billing' },
      paths: { '/invoices': { get: { operationId: 'listInvoices', responses: {} } } },
      components: { schemas: { Invoice: { type: 'object' } } },
    },
    'domains/platform/platform-registry-policies.yaml': {
      $schema: 'https://blueprint.codeforamerica.org/schemas/registry-schema.yaml',
      domain: 'platform',
      type: 'policies',
      entries: { 'a-policy': { title: 'A policy' } },
    },
  };

  const pathsOf = (artifact) => artifact.docs.map((d) => d.relativePath).sort();

  test('keeps the named domain, and the shared files it references', () => {
    const dir = contractsIn(SPLIT);
    try {
      const docs = discover(dir).map(load);
      const kept = pathsOf(generate(docs, 'artifact', { domains: ['intake'] }));

      assert.ok(kept.includes('domains/intake/intake-openapi.yaml'));
      assert.ok(kept.includes('domains/intake/intake-mock-data.yaml'),
        'seed data for the domain must come along, or the store boots empty');
      assert.ok(kept.includes('base/components/parameters.yaml'),
        'a parameter referenced from the spec belongs to no domain and must still be kept');
      assert.ok(kept.includes('common/schemas/shared.yaml'),
        'and so does a schema referenced from components');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('drops a domain that was not asked for', () => {
    const dir = contractsIn(SPLIT);
    try {
      const docs = discover(dir).map(load);
      const kept = pathsOf(generate(docs, 'artifact', { domains: ['intake'] }));
      assert.ok(!kept.includes('domains/billing/billing-openapi.yaml'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('always keeps platform, which nothing references', () => {
    // The mock seeds platform registries and task queues whatever domain is
    // being shown, and no $ref points at them — so a closure alone would
    // never reach them.
    const dir = contractsIn(SPLIT);
    try {
      const docs = discover(dir).map(load);
      const kept = pathsOf(generate(docs, 'artifact', { domains: ['intake'] }));
      assert.ok(kept.includes('domains/platform/platform-registry-policies.yaml'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('every ref in the result resolves within the result', () => {
    // The property that makes this safe. A plain domain filter produces an
    // artifact that parses and then cannot follow a ref, which surfaces at
    // runtime in a page rather than at build time.
    const dir = contractsIn(SPLIT);
    try {
      const docs = discover(dir).map(load);
      const kept = extract(generate(docs, 'artifact', { domains: ['intake'] }), 'docs');

      const dangling = [];
      for (const doc of kept) {
        for (const ref of doc.refs().values()) {
          if (!ref.external || !ref.file) continue;
          if (ref.file.startsWith('http://') || ref.file.startsWith('https://')) continue;
          if (Object.keys(doc.resolveRef(ref.file + '#', kept) ?? {}).length === 0) {
            dangling.push(`${doc.relativePath} → ${ref.file}`);
          }
        }
      }
      assert.deepEqual(dangling, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('no domains means the whole set', () => {
    const dir = contractsIn(SPLIT);
    try {
      const docs = discover(dir).map(load);
      assert.equal(generate(docs, 'artifact').docs.length, docs.length);
      assert.equal(generate(docs, 'artifact', { domains: [] }).docs.length, docs.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
