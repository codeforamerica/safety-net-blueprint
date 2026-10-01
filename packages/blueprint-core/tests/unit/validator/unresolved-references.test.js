/**
 * References that name something not in the contract set.
 *
 * Three rules, one idea: a contract that names another document, schema or
 * definition by name is making a claim, and an unresolvable claim is a broken
 * contract rather than a degraded one. Each of these had a way of going
 * unnoticed:
 *
 *   unresolved-fragment-ref          existed, untested
 *   unresolved-external-ref          did not exist — 56 refs across eight
 *                                    AsyncAPI documents named files that were
 *                                    not there, because no pass ever followed
 *                                    a ref in an AsyncAPI file
 *   unresolved-relationship-resource existed only as a `resolve` warning, which
 *                                    is how the five in #447 survived
 *
 * Findings are filtered by rule rather than asserted through `ok`, so an
 * unrelated error in a fixture cannot make one of these look present.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';

import { discover, load, validate } from '../../../src/index.js';

function setOf(files) {
  const dir = mkdtempSync(join(tmpdir(), 'core-unresolved-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const full = join(dir, relativePath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, yaml.dump(content));
  }
  return discover(dir).map(load);
}

/** Findings of one rule across the whole set. */
function findings(docs, rule) {
  return validate(docs).results.flatMap((r) => (r.errors ?? []).filter((e) => e.rule === rule));
}

const spec = (extra = {}) => ({
  openapi: '3.1.0',
  info: { title: 'Intake', version: '1.0.0', 'x-domain': 'intake' },
  paths: {},
  ...extra,
});

describe('unresolved-external-ref', () => {
  test('a ref naming a document in the set resolves', () => {
    const docs = setOf({
      'domains/intake/shared.yaml': { $defs: { Member: { type: 'object' } } },
      'domains/intake/intake-openapi.yaml': spec({
        components: { schemas: { Application: { $ref: './shared.yaml#/$defs/Member' } } },
      }),
    });

    assert.deepEqual(findings(docs, 'unresolved-external-ref'), []);
  });

  test('a ref naming a document not in the set is an error', () => {
    const docs = setOf({
      'domains/intake/intake-openapi.yaml': spec({
        components: { schemas: { Application: { $ref: './absent.yaml#/$defs/Member' } } },
      }),
    });

    const found = findings(docs, 'unresolved-external-ref');
    assert.equal(found.length, 1);
    assert.match(found[0].message, /names no document in the contract set/);
  });

  test('a path missing a directory segment is an error — the shape of the 56', () => {
    // `../../schemas/events.yaml` where the file is at `base/schemas/events.yaml`.
    const docs = setOf({
      'base/schemas/events.yaml': { $defs: { Event: { type: 'object' } } },
      'domains/intake/intake-asyncapi.yaml': {
        asyncapi: '3.0.0',
        info: { title: 'Intake events', version: '1.0.0' },
        channels: { thing: { messages: { m: { $ref: '../../schemas/events.yaml#/$defs/Event' } } } },
      },
    });

    assert.equal(findings(docs, 'unresolved-external-ref').length, 1);
  });

  test('the same ref with the segment present resolves', () => {
    const docs = setOf({
      'base/schemas/events.yaml': { $defs: { Event: { type: 'object' } } },
      'domains/intake/intake-asyncapi.yaml': {
        asyncapi: '3.0.0',
        info: { title: 'Intake events', version: '1.0.0' },
        channels: { thing: { messages: { m: { $ref: '../../base/schemas/events.yaml#/$defs/Event' } } } },
      },
    });

    assert.deepEqual(findings(docs, 'unresolved-external-ref'), []);
  });

  test('a canonical https ref is left alone — it resolves through the registry', () => {
    const docs = setOf({
      'domains/intake/intake-asyncapi.yaml': {
        asyncapi: '3.0.0',
        info: { title: 'Intake events', version: '1.0.0' },
        channels: {
          thing: {
            messages: {
              m: { $ref: 'https://blueprint.codeforamerica.org/base/schemas/events.yaml#/$defs/Event' },
            },
          },
        },
      },
    });

    assert.deepEqual(findings(docs, 'unresolved-external-ref'), []);
  });

  test('an overlay is exempt — it references its target by design', () => {
    const docs = setOf({
      'overlays/thing-overlay.yaml': {
        overlay: '1.0.0',
        info: { title: 'Thing', version: '1.0.0' },
        actions: [{ target: '$.components.schemas', update: { X: { $ref: './absent.yaml#/$defs/Y' } } }],
      },
    });

    assert.deepEqual(findings(docs, 'unresolved-external-ref'), []);
  });
});

describe('unresolved-relationship-resource', () => {
  const withRelationship = (resource) =>
    setOf({
      'domains/intake/intake-openapi.yaml': spec({
        components: {
          schemas: {
            Application: {
              type: 'object',
              properties: { memberId: { type: 'string', 'x-relationship': { resource } } },
            },
            Member: { type: 'object' },
          },
        },
      }),
    });

  test('a resource naming a schema in the set resolves', () => {
    assert.deepEqual(findings(withRelationship('Member'), 'unresolved-relationship-resource'), []);
  });

  test('a resource naming no schema is an error', () => {
    const found = findings(withRelationship('Absent'), 'unresolved-relationship-resource');
    assert.equal(found.length, 1);
    assert.match(found[0].message, /names no schema in the contract set/);
  });

  test('a domain/collection path is an error — the shape of #447', () => {
    const found = findings(withRelationship('intake/members'), 'unresolved-relationship-resource');
    assert.equal(found.length, 1);
    assert.match(found[0].message, /PascalCase/);
  });

  test('reserved values name no schema by definition and are not errors', () => {
    for (const reserved of ['External', 'Polymorphic']) {
      assert.deepEqual(
        findings(withRelationship(reserved), 'unresolved-relationship-resource'),
        [],
        reserved
      );
    }
  });
});

describe('unresolved-fragment-ref', () => {
  test('a same-document ref pointing nowhere is an error', () => {
    const docs = setOf({
      'domains/intake/intake-openapi.yaml': spec({
        components: { schemas: { Application: { $ref: '#/components/schemas/Absent' } } },
      }),
    });

    assert.equal(findings(docs, 'unresolved-fragment-ref').length, 1);
  });

  test('a same-document ref that resolves is not', () => {
    const docs = setOf({
      'domains/intake/intake-openapi.yaml': spec({
        components: { schemas: { Application: { $ref: '#/components/schemas/Member' }, Member: { type: 'object' } } },
      }),
    });

    assert.deepEqual(findings(docs, 'unresolved-fragment-ref'), []);
  });
});
