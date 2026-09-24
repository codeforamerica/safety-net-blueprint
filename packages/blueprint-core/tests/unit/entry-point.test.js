/**
 * The package's public surface.
 *
 * Everything below goes through the entry point rather than reaching into a
 * module, because the point of these is to catch a change that breaks a
 * consumer — which is exactly what internal tests miss.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';

import { discover, load, generate, extract, resolve, validate } from '../../src/index.js';

/**
 * Write a contract set to a temp directory.
 *
 * @param {Record<string, object>} files - Relative path to document content
 * @returns {string} The directory
 */
function contractsIn(files) {
  const dir = mkdtempSync(join(tmpdir(), 'core-surface-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const full = join(dir, relativePath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, yaml.dump(content));
  }
  return dir;
}

const openapi = (extra = {}) => ({
  openapi: '3.1.0',
  info: { title: 'Intake', version: '1.0.0', 'x-domain': 'intake', ...extra.info },
  paths: { '/applications': { get: { responses: {} } } },
  ...extra,
});

describe('discover', () => {
  test('reports each file with its position, type and domain', () => {
    const dir = contractsIn({ 'domains/intake/intake-openapi.yaml': openapi() });
    try {
      const [file] = discover(dir);
      assert.equal(file.relativePath, 'domains/intake/intake-openapi.yaml');
      assert.equal(file.type, 'openapi');
      assert.equal(file.domain, 'intake');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('takes domain from a path segment when the document does not state one', () => {
    // The last fallback needs the Domain enum, which only the whole set has.
    const dir = contractsIn({
      'schemas/domain.yaml': { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: { Domain: { enum: ['intake'] } } },
      'intake/notes.yaml': { anything: true },
    });
    try {
      const found = discover(dir).find((f) => f.relativePath === 'intake/notes.yaml');
      assert.equal(found.domain, 'intake');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('skips deprecated documents', () => {
    // Every caller filtered these out immediately; discover does it once.
    const dir = contractsIn({
      'a-openapi.yaml': openapi(),
      'b-openapi.yaml': openapi({ info: { 'x-status': 'deprecated' } }),
    });
    try {
      assert.deepEqual(discover(dir).map((f) => f.relativePath), ['a-openapi.yaml']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('filters to one type', () => {
    const dir = contractsIn({
      'intake-openapi.yaml': openapi(),
      'intake-rules.yaml': { $schema: 'rules-schema.yaml', domain: 'intake', rulesets: {} },
    });
    try {
      assert.deepEqual(discover(dir, 'rules').map((f) => f.type), ['rules']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('load', () => {
  test('discover(dir).map(load) carries position and domain through', () => {
    const dir = contractsIn({ 'domains/intake/intake-openapi.yaml': openapi() });
    try {
      const [doc] = discover(dir).map(load);
      assert.equal(doc.relativePath, 'domains/intake/intake-openapi.yaml');
      assert.equal(doc.domain, 'intake');
      assert.equal(doc.type, 'openapi');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a bare path has no position, but still reports the domain it states', () => {
    const dir = contractsIn({ 'intake-openapi.yaml': openapi() });
    try {
      const doc = load(join(dir, 'intake-openapi.yaml'));
      assert.equal(doc.relativePath, null);
      assert.equal(doc.domain, 'intake');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refs() names the schema each ref points at', () => {
    const dir = contractsIn({
      'intake-openapi.yaml': openapi({
        components: { schemas: { Application: { properties: { x: { $ref: '#/components/schemas/Member' } }, }, Member: { type: 'object' } } },
      }),
    });
    try {
      const doc = load(join(dir, 'intake-openapi.yaml'));
      assert.equal(doc.refs().get('#/components/schemas/Member').name, 'Member');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('externalRefs() returns the sibling documents a spec points at', () => {
    const dir = contractsIn({
      'domains/intake/intake-openapi.yaml': openapi({
        components: { schemas: { Application: { $ref: '../../common/shared.yaml#/$defs/Base' } } },
      }),
      'common/shared.yaml': { $defs: { Base: { type: 'object' } } },
    });
    try {
      const docs = discover(dir).map(load);
      const spec = docs.find((d) => d.type === 'openapi');
      const siblings = spec.externalRefs(docs);
      assert.deepEqual([...siblings.keys()], ['../../common/shared.yaml']);
      assert.ok(siblings.get('../../common/shared.yaml').$defs.Base);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('externalRefs() skips canonical https refs', () => {
    // Those resolve through the schema registry, not the file tree.
    const dir = contractsIn({
      'intake-openapi.yaml': openapi({
        components: { schemas: { A: { $ref: 'https://blueprint.codeforamerica.org/base/x.yaml#/Y' } } },
      }),
    });
    try {
      const docs = discover(dir).map(load);
      assert.equal(docs[0].externalRefs(docs).size, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('resolveRef() follows an external ref to the schema it names', () => {
    const dir = contractsIn({
      'domains/intake/intake-openapi.yaml': openapi(),
      'common/shared.yaml': { $defs: { Base: { type: 'object', title: 'Base' } } },
    });
    try {
      const docs = discover(dir).map(load);
      const spec = docs.find((d) => d.type === 'openapi');
      const found = spec.resolveRef('common/shared.yaml#/$defs/Base', docs);
      assert.equal(found.title, 'Base');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('generate', () => {
  test('rejects an unknown artifact type by name', () => {
    assert.throws(() => generate([], 'nonsense'), /unknown artifact type "nonsense"/);
  });

  test('graph produces one compiled graph per ruleset, saying which', () => {
    const dir = contractsIn({
      'intake-rules.yaml': {
        $schema: 'rules-schema.yaml',
        domain: 'intake',
        rulesets: {
          expedited: {
            inputs: { household: { type: 'object', properties: { income: { type: 'number' } } } },
            outputs: { type: 'object', properties: { eligible: { type: 'boolean' } } },
            facts: [{ path: 'eligible', expression: 'household.income < 150', type: { type: 'boolean' } }],
          },
        },
      },
    });
    try {
      const [entry] = generate(discover(dir).map(load), 'graph');
      assert.equal(entry.path, 'intake-expedited-graph.yaml');
      assert.equal(entry.graph.ruleset, 'expedited');
      assert.equal(entry.graph.domain, 'intake');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('examples group by the schema each record exemplifies', () => {
    // Prefixes nest: ApplicationMember1 must not also land under Application.
    // Grouping is by schema, not by collection — naming a collection is the
    // mock server's business, and core holding that rule too is what let the
    // two drift.
    const dir = contractsIn({
      'intake-openapi.yaml': {
        ...openapi(),
        paths: { '/applications': { get: {} }, '/application-members': { get: {} } },
        components: {
          schemas: { Application: { type: 'object' }, ApplicationMember: { type: 'object' } },
          examples: {
            Application1: { value: { id: 'a1' } },
            ApplicationMember1: { value: { id: 'm1' } },
          },
        },
      },
    });
    try {
      const grouped = generate(discover(dir).map(load), 'examples');
      assert.deepEqual(grouped['Application'].map((r) => r.data.id), ['a1']);
      assert.deepEqual(grouped['ApplicationMember'].map((r) => r.data.id), ['m1']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('postman produces a collection with a folder per API', () => {
    const dir = contractsIn({ 'intake-openapi.yaml': openapi() });
    try {
      const collection = generate(discover(dir).map(load), 'postman', { baseUrl: 'http://example.test' });
      assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
      assert.ok(Array.isArray(collection.item));
      assert.ok(collection.variable.some((v) => v.value === 'http://example.test'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses a document that does not know where it sits', () => {
    // An overlay addresses its target by relative path, so a document loaded
    // outside a set cannot be projected.
    const dir = contractsIn({
      'intake-compositions.yaml': { $schema: 'compositions-schema.yaml', domain: 'intake', compositions: { x: {} } },
    });
    try {
      const orphan = load(join(dir, 'intake-compositions.yaml'));
      assert.throws(() => generate([orphan], 'overlay'), /position within the contract set/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('extract', () => {
  test('rejects an unknown type by name', () => {
    assert.throws(() => extract([], 'nonsense'), /unknown type "nonsense"/);
  });

  test('relationships indexes endpoints by the artifact that generated them', () => {
    const dir = contractsIn({
      'intake-openapi.yaml': openapi({
        paths: {
          '/applications/{id}/submit': {
            post: { 'x-relationship': { type: 'state-machine-action', domain: 'intake', id: 'submit' } },
          },
        },
      }),
    });
    try {
      const index = extract(discover(dir).map(load), 'relationships');
      assert.deepEqual(index.get('state-machine-action:intake:submit'), {
        path: '/applications/{id}/submit',
        method: 'post',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('skips field-level fk relationships', () => {
    const dir = contractsIn({
      'intake-openapi.yaml': openapi({
        paths: { '/applications': { get: { 'x-relationship': { type: 'fk', domain: 'intake', id: 'x' } } } },
      }),
    });
    try {
      assert.equal(extract(discover(dir).map(load), 'relationships').size, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the pipeline end to end', () => {
  test('discover, resolve and validate compose over one contract set', () => {
    const dir = contractsIn({
      'domains/intake/intake-openapi.yaml': openapi({
        servers: [{ url: 'https://api.example.com', 'x-environments': ['production'] },
                  { url: 'https://dev.example.com', 'x-environments': ['dev'] }],
      }),
    });
    try {
      const docs = discover(dir).map(load);
      const resolved = resolve(docs, { envTarget: 'production' });

      assert.equal(resolved.docs[0].content.servers.length, 1);
      assert.equal(resolved.docs[0].content.servers[0].url, 'https://api.example.com');
      assert.equal(resolved.manifest.envTarget, 'production');

      // The resolved document reports its own state, not the one it was
      // loaded with — the reason refs() and model() are methods.
      assert.equal(resolved.docs[0].refs().size, 0);

      assert.equal(typeof validate(resolved.docs).ok, 'boolean');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
