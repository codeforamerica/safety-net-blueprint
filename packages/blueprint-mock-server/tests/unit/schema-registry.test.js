/**
 * Resolving schema refs without dereferencing, and the four bugs that cost.
 *
 * Every case here is a regression test for something that got through the
 * existing suites and was caught only by running the server against the real
 * contract set (#448). That is the finding worth encoding: `tests/fixtures`
 * and `tests/functional/resolved` are already dereferenced, so they cannot
 * exercise ref resolution at all, and passed in every broken state below.
 *
 * So these build their own contract set, deliberately *unresolved* — schemas
 * in one document, referenced across files from another — which is the shape
 * the server actually meets and the fixtures never do.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { discover, load } from '@codeforamerica/blueprint-core';
import { createAjv, registerDocuments, validatorFor, validatorForRef } from '../../src/schema-registry.js';
import { apiSpecsFromDocs } from '../../src/spec-loader.js';
import { extractRequiredDefaults } from '../../src/route-generator.js';

/** A contract set on disk, loaded as documents. Caller removes the directory. */
function contractSet(files) {
  const dir = mkdtempSync(join(tmpdir(), 'schema-registry-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const file = join(dir, relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, yaml.dump(content), 'utf8');
  }
  return { dir, docs: discover(dir).map(load), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const SHARED_SCHEMAS = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    DocumentRequest: {
      type: 'object',
      properties: { id: { type: 'string' }, status: { type: 'string' } },
      required: ['id'],
    },
    Verification: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        // The field whose default went missing: required, an array, and only
        // visible by following a ref out of the OpenAPI document.
        documentRequests: { type: 'array', items: { $ref: '#/$defs/DocumentRequest' } },
        // Nullable with a sibling type: ajv widens the type to allow null.
        closedAt: { type: 'string', format: 'date-time', nullable: true },
      },
      required: ['id', 'documentRequests'],
    },
  },
};

/** An OpenAPI document whose schemas reach into the shared file above. */
const SPEC = {
  openapi: '3.1.0',
  info: { title: 'Verifications', version: '1.0.0', 'x-domain': 'verification' },
  servers: [{ url: 'http://localhost:1080/verification' }],
  paths: {
    '/verifications': {
      post: {
        operationId: 'createVerification',
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/VerificationCreate' } } },
        },
        responses: {
          201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Verification' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      // Composed across files, which is the case that stopped working.
      Verification: { allOf: [{ $ref: '../../shared/shared-schema.yaml#/$defs/Verification' }] },
      VerificationCreate: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      // `nullable` with nothing to qualify. ajv throws on this one for want
      // of a sibling `type`, which is why the keyword is dropped here only.
      MaybeVerification: {
        allOf: [{ $ref: '../../shared/shared-schema.yaml#/$defs/Verification' }],
        nullable: true,
      },
    },
  },
};

const FILES = {
  'shared/shared-schema.yaml': SHARED_SCHEMAS,
  'domains/verification/verification-openapi.yaml': SPEC,
  // A blueprint contract, not JSON Schema. Its top-level `type: policies`
  // reads as the JSON Schema `type` keyword and ajv rejects it as an unknown
  // type — so registration must not try.
  'registries/policies.yaml': {
    $schema: 'https://blueprint.codeforamerica.org/schemas/registry-schema.yaml',
    type: 'policies',
    entries: { 'some-policy': { title: 'Some policy' } },
  },
};

/** Run a body against the fixture set, cleaning up after. */
function withSet(body) {
  const set = contractSet(FILES);
  try {
    return body(set);
  } finally {
    set.cleanup();
  }
}

describe('registerDocuments', () => {

  test('registers the documents a $ref can name, and skips the ones it cannot', () => {
    withSet(({ docs }) => {
      const ajv = createAjv();
      const { registered, skipped } = registerDocuments(ajv, docs);

      assert.deepEqual(skipped, [], 'nothing should fail to register');
      assert.equal(registered, 2,
        'the OpenAPI document and the shared schema — not the registry, which is not JSON Schema');
    });
  });

  test('a registry document does not break registration', () => {
    // It declares `type: policies`. Registering it raised "data/type must be
    // equal to one of the allowed values", because ajv read that as the JSON
    // Schema `type` keyword.
    withSet(({ docs }) => {
      const ajv = createAjv();
      assert.doesNotThrow(() => registerDocuments(ajv, docs));
    });
  });

  test('calling createAjv more than once does not throw', () => {
    // It did: createAjv adds the format validators, and adding them twice
    // fails on the second `formatMaximum` registration.
    assert.doesNotThrow(() => {
      createAjv();
      createAjv();
    });
  });
});

describe('resolving a cross-file $ref', () => {

  test('compiles a schema composed from another document', () => {
    // The failure that started this: "can't resolve reference
    // ../../shared/shared-schema.yaml#/$defs/Verification from id #".
    withSet(({ docs }) => {
      const ajv = createAjv();
      registerDocuments(ajv, docs);

      const validateFn = validatorFor(
        ajv,
        'domains/verification/verification-openapi.yaml',
        '/components/schemas/Verification'
      );
      assert.ok(validateFn, 'the composed schema should compile');

      assert.ok(validateFn({ id: 'v1', documentRequests: [{ id: 'd1' }] }),
        'a valid record should pass through the cross-file ref');
      assert.equal(validateFn({ documentRequests: [] }), false,
        'the required field declared in the other document should still be enforced');
    });
  });

  describe('resolves both forms of ref from one call', () => {
    const cases = [
      ['a same-document ref', '#/components/schemas/VerificationCreate'],
      ['a cross-file ref', '../../shared/shared-schema.yaml#/$defs/Verification'],
    ];
    for (const [name, ref] of cases) {
      test(name, () => {
        withSet(({ docs }) => {
          const ajv = createAjv();
          registerDocuments(ajv, docs);
          assert.ok(
            validatorForRef(ajv, 'domains/verification/verification-openapi.yaml', ref),
            `${ref} should resolve`
          );
        });
      });
    }
  });

  test('a ref naming nothing resolves to null rather than throwing', () => {
    withSet(({ docs }) => {
      const ajv = createAjv();
      registerDocuments(ajv, docs);
      assert.equal(
        validatorForRef(ajv, 'domains/verification/verification-openapi.yaml', '../nowhere.yaml#/$defs/Gone'),
        null
      );
    });
  });
});

describe('nullable', () => {

  test('a nullable field with a type still accepts null', () => {
    // Stripping `nullable` wholesale broke this: ajv honours
    // `{ type: string, nullable: true }` by widening the type, so removing it
    // rejected the null the field exists to allow. Five Application date
    // fields and two Users failed this way.
    withSet(({ docs }) => {
      const ajv = createAjv();
      registerDocuments(ajv, docs);

      const validateFn = validatorFor(
        ajv,
        'domains/verification/verification-openapi.yaml',
        '/components/schemas/Verification'
      );
      assert.ok(validateFn({ id: 'v1', documentRequests: [], closedAt: null }),
        'closedAt is nullable, so null must validate');
      assert.equal(validateFn({ id: 'v1', documentRequests: [], closedAt: 42 }), false,
        'but it is still a string otherwise');
    });
  });

  test('nullable with no type to qualify does not break compilation', () => {
    // `{ allOf: [$ref], nullable: true }` is where ajv throws, for want of a
    // sibling type. Dropping the keyword there is what keeps this compiling.
    withSet(({ docs }) => {
      const ajv = createAjv();
      registerDocuments(ajv, docs);
      assert.ok(
        validatorFor(ajv, 'domains/verification/verification-openapi.yaml', '/components/schemas/MaybeVerification'),
        'should compile rather than throw'
      );
    });
  });
});

describe('extractRequiredDefaults', () => {

  test('follows a ref to find a required array', () => {
    // The quiet one. The allOf member is a ref, so without following it there
    // are no properties to read, no default is produced, and a required array
    // field comes back undefined instead of []. Nothing failed loudly.
    withSet(({ docs }) => {
      const [api] = apiSpecsFromDocs(docs);
      const endpoint = api.endpoints.find((e) => e.method === 'POST');

      const defaults = extractRequiredDefaults(endpoint.responseSchema, api.resolve.schema);
      assert.deepEqual(defaults.documentRequests, [],
        'a required array behind a cross-file ref should default to []');
    });
  });

  test('without a resolver, a ref yields no defaults', () => {
    // Stated so the dependency is explicit rather than incidental: this is
    // exactly the old behaviour, and exactly the bug.
    withSet(({ docs }) => {
      const [api] = apiSpecsFromDocs(docs);
      const endpoint = api.endpoints.find((e) => e.method === 'POST');

      assert.deepEqual(extractRequiredDefaults(endpoint.responseSchema), {},
        'no resolver means the composed schema is opaque');
    });
  });
});

describe('apiSpecsFromDocs', () => {

  test('reads an API without dereferencing it', () => {
    withSet(({ docs }) => {
      const [api] = apiSpecsFromDocs(docs);

      assert.equal(api.name, 'verification');
      assert.equal(api.serverBasePath, '/verification');
      assert.equal(api.relativePath, 'domains/verification/verification-openapi.yaml',
        'the document is named, so ajv can resolve refs against it');
      assert.equal(typeof api.resolve.schema, 'function');

      // The composed schema is still composed: nothing was flattened into it.
      assert.ok(api.schemas.Verification.allOf, 'allOf should survive');
      assert.ok(api.schemas.Verification.allOf[0].$ref, 'and still be a ref');
    });
  });

  test('the request schema is followed one hop, so a caller has the object', () => {
    withSet(({ docs }) => {
      const [api] = apiSpecsFromDocs(docs);
      const endpoint = api.endpoints.find((e) => e.method === 'POST');

      assert.equal(endpoint.requestSchemaRef, '#/components/schemas/VerificationCreate',
        'the ref is kept, so ajv knows where to resolve from');
      assert.deepEqual(endpoint.requestSchema.required, ['id'],
        'and the object is in hand, so a caller can read it');
    });
  });
});

describe('validate degrades rather than throwing', () => {

  test('a schema whose ref names nothing does not crash the handler', async () => {
    // The two resolvers disagree about a ref written one level too shallow:
    // core retries it with the `../` stripped, ajv does not. So a malformed
    // set can reach `validate` with a schema ajv cannot compile — and
    // compiling it raised MissingRefError from inside a request handler.
    const { validate, initSchemaRegistry } = await import('../../src/validator.js');

    withSet(({ docs }) => {
      initSchemaRegistry(docs);

      const broken = { allOf: [{ $ref: '../nowhere/missing.yaml#/$defs/Gone' }] };
      const warnings = [];
      const { warn } = console;
      console.warn = (message) => warnings.push(message);
      try {
        const result = validate({ anything: true }, broken, 'broken-create', {
          relativePath: 'domains/verification/verification-openapi.yaml',
          ref: '#/components/schemas/Missing',
        });
        assert.equal(result.valid, true, 'it should pass rather than throw');
      } finally {
        console.warn = warn;
      }

      assert.equal(warnings.length, 1, 'and say so, once');
      assert.match(warnings[0], /not checked/,
        'the warning must make clear the request went unvalidated');
    });
  });
});
