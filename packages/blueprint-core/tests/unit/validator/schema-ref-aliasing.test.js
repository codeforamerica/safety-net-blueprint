/**
 * Conformance checking across a relative ref.
 *
 * Written contracts carry an absolute `$id` but relative `$ref`s — resolve
 * rewrites canonical blueprint URLs to real paths so file-following tools can
 * read the output. A validator does not follow paths: it resolves a relative
 * ref against the document's own `$id`, producing a URI nothing registered.
 * The schema then fails to compile, and the document is reported as unchecked
 * rather than wrong.
 *
 * That is the dangerous shape — not a failure, an absence. These assert the
 * check actually runs, which a passing suite otherwise cannot distinguish
 * from a check that silently never executed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchemas } from '../../../src/validator/json-schema-validator.js';

const BASE = 'https://blueprint.codeforamerica.org/safety-net';

/** A schema in a sibling directory, referenced by relative path. */
const authSchema = {
  relativePath: 'base/schemas/auth.yaml',
  spec: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://blueprint.codeforamerica.org/base/schemas/auth.yaml',
    $defs: {
      Endpoint: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
};

/** A validation schema whose ref to the above was rewritten to a path. */
const configSchema = {
  relativePath: 'domains/data-exchange/config-schema.yaml',
  spec: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${BASE}/domains/data-exchange/config-schema.yaml`,
    type: 'object',
    properties: {
      endpoint: { $ref: '../../base/schemas/auth.yaml#/$defs/Endpoint' },
    },
    required: ['endpoint'],
  },
};

const configDoc = (endpoint) => ({
  relativePath: 'domains/data-exchange/config.yaml',
  // Documents name their validation schema by filename; the validator
  // matches it against a registered $id ending in that name.
  spec: { $schema: 'config-schema.yaml', endpoint },
});

const resultFor = (specs, relativePath) =>
  validateSchemas(specs).results.find((r) => r.relativePath === relativePath);

describe('conformance across a rewritten relative ref', () => {
  test('the schema compiles — the document is checked, not skipped', () => {
    const result = resultFor([authSchema, configSchema, configDoc({ url: 'https://x' })], 'domains/data-exchange/config.yaml');

    assert.equal(result.uncheckable, undefined, 'must not be reported unchecked');
    assert.equal(result.valid, true);
  });

  test('and the check has teeth — a violation across the ref is an error', () => {
    // Without this the first test passes just as well when nothing ran.
    const result = resultFor([authSchema, configSchema, configDoc({ wrong: 1 })], 'domains/data-exchange/config.yaml');

    assert.equal(result.uncheckable, undefined);
    assert.equal(result.valid, false, 'a document violating the referenced schema must fail');
  });

  test('a ref pointing at nothing is still reported as unchecked', () => {
    // The aliasing must not invent a target. A genuinely missing sibling is
    // still a schema that cannot compile, and saying so is the honest answer.
    const dangling = {
      relativePath: 'domains/data-exchange/config-schema.yaml',
      spec: {
        ...configSchema.spec,
        properties: { endpoint: { $ref: '../../base/schemas/absent.yaml#/$defs/Endpoint' } },
      },
    };
    const result = resultFor([authSchema, dangling, configDoc({ url: 'https://x' })], 'domains/data-exchange/config.yaml');

    assert.ok(result.uncheckable, 'an unresolvable ref must still surface');
  });
});
