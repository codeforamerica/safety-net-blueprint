/**
 * Unit tests for the domain compositions schema.
 * Validates structural correctness by running inline fixtures through the JSON Schema.
 * Cross-artifact semantic checks (bind field validation, resource existence) are
 * tested in the resolve pipeline integration tests.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsRoot = join(__dirname, '../../');
const schemaPath = join(contractsRoot, 'schemas/compositions-schema.yaml');

function makeValidator() {
  const raw = readFileSync(schemaPath, 'utf8');
  const schema = yaml.load(raw);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  return ajv.compile(schema);
}

function validate(doc) {
  const { $schema, ...data } = doc;
  const validator = makeValidator();
  const valid = validator(data);
  return { valid, errors: validator.errors || [] };
}

function errorPaths(errors) {
  return errors.map(e => `${e.instancePath || '(root)'}: ${e.message}`);
}

// ---------------------------------------------------------------------------
// Real file round-trips
// ---------------------------------------------------------------------------

test('compositions-schema validates real files', async (t) => {

  await t.test('intake-compositions.yaml is valid', () => {
    const doc = yaml.load(readFileSync(join(contractsRoot, 'intake-compositions.yaml'), 'utf8'));
    const { valid, errors } = validate(doc);
    assert.ok(valid, `Expected valid but got errors:\n${errorPaths(errors).join('\n')}`);
  });

});

// ---------------------------------------------------------------------------
// Structural requirements
// ---------------------------------------------------------------------------

test('compositions-schema structural requirements', async (t) => {

  const base = {
    version: '1.0',
    domain: 'intake',
    compositions: {
      members: {
        resource: 'application-members',
        bind: 'applicationId',
      },
    },
  };

  await t.test('accepts minimal valid document', () => {
    const { valid, errors } = validate(base);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('requires version', () => {
    const { version: _, ...doc } = base;
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

  await t.test('domain is optional', () => {
    const { domain: _, ...doc } = base;
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('rejects unknown top-level keys', () => {
    const doc = { ...base, unknownKey: 'value' };
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

  await t.test('composition requires resource', () => {
    const doc = {
      ...base,
      compositions: {
        members: { bind: 'applicationId' },
      },
    };
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

});

// ---------------------------------------------------------------------------
// Bind
// ---------------------------------------------------------------------------

test('compositions-schema bind variants', async (t) => {

  function withBind(bind) {
    return {
      version: '1.0',
      compositions: {
        items: { resource: 'some-resource', bind },
      },
    };
  }

  await t.test('bind as single string', () => {
    const { valid, errors } = validate(withBind('applicationId'));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('bind as array of two strings (compound join)', () => {
    const { valid, errors } = validate(withBind(['memberId', 'programId']));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('bind array must have at least two items', () => {
    const { valid } = validate(withBind(['memberId']));
    assert.equal(valid, false);
  });

});

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

test('compositions-schema fields selection', async (t) => {

  function withFields(fields) {
    return {
      version: '1.0',
      compositions: {
        items: { resource: 'some-resource', fields },
      },
    };
  }

  await t.test('fields as list of names', () => {
    const { valid, errors } = validate(withFields(['firstName', 'lastName']));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('fields with alias', () => {
    const { valid, errors } = validate(withFields(['applicationId as clientApplicationId']));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('fields with wildcard', () => {
    const { valid, errors } = validate(withFields(['*']));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('fields array must have at least one item', () => {
    const { valid } = validate(withFields([]));
    assert.equal(valid, false);
  });

});

// ---------------------------------------------------------------------------
// Include map and nested nodes
// ---------------------------------------------------------------------------

test('compositions-schema include map', async (t) => {

  await t.test('inline include node with resource and bind', () => {
    const doc = {
      version: '1.0',
      compositions: {
        application: {
          resource: 'applications',
          include: {
            members: { resource: 'application-members', bind: 'applicationId' },
          },
        },
      },
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('include node with filter', () => {
    const doc = {
      version: '1.0',
      compositions: {
        application: {
          resource: 'applications',
          include: {
            verifications: {
              resource: 'verifications',
              bind: 'applicationId',
              filter: "category == 'identity'",
            },
          },
        },
      },
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('include node requires resource', () => {
    const doc = {
      version: '1.0',
      compositions: {
        application: {
          resource: 'applications',
          include: {
            members: { bind: 'applicationId' },
          },
        },
      },
    };
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

  await t.test('deeply nested include', () => {
    const doc = {
      version: '1.0',
      compositions: {
        application: {
          resource: 'applications',
          include: {
            members: {
              resource: 'application-members',
              bind: 'applicationId',
              include: {
                income: { resource: 'member-incomes', bind: 'memberId' },
              },
            },
          },
        },
      },
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

});


// ---------------------------------------------------------------------------
// Endpoint declaration
// ---------------------------------------------------------------------------

test('compositions-schema endpoint declaration', async (t) => {

  await t.test('endpoint with path only', () => {
    const doc = {
      version: '1.0',
      compositions: {
        members: {
          resource: 'application-members',
          endpoint: { path: '/applications/{applicationId}/members-summary' },
        },
      },
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('endpoint with methods and parentLink', () => {
    const doc = {
      version: '1.0',
      compositions: {
        members: {
          resource: 'application-members',
          endpoint: {
            path: '/applications/{applicationId}/members-summary',
            methods: ['get'],
            parentLink: true,
          },
        },
      },
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('endpoint requires path', () => {
    const doc = {
      version: '1.0',
      compositions: {
        members: {
          resource: 'application-members',
          endpoint: { methods: ['get'] },
        },
      },
    };
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

  await t.test('endpoint methods must be valid HTTP verbs', () => {
    const doc = {
      version: '1.0',
      compositions: {
        members: {
          resource: 'application-members',
          endpoint: { path: '/applications/{id}/members', methods: ['invalidVerb'] },
        },
      },
    };
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

});

// ---------------------------------------------------------------------------
// State resource
// ---------------------------------------------------------------------------

test('compositions-schema state resource', async (t) => {

  await t.test('state with inline schema name', () => {
    const doc = {
      version: '1.0',
      compositions: {
        reviewContext: {
          resource: 'applications',
          state: {
            schema: { name: 'ReviewProgress', type: 'object', properties: { status: { type: 'string' } } },
          },
        },
      },
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('state with methods and flatten', () => {
    const doc = {
      version: '1.0',
      compositions: {
        reviewContext: {
          resource: 'applications',
          state: {
            schema: { name: 'ReviewProgress', type: 'object', properties: { status: { type: 'string' } } },
            methods: ['patch'],
            flatten: true,
          },
        },
      },
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('state requires schema', () => {
    const doc = {
      version: '1.0',
      compositions: {
        reviewContext: {
          resource: 'applications',
          state: { methods: ['put'] },
        },
      },
    };
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

  await t.test('state schema requires name', () => {
    const doc = {
      version: '1.0',
      compositions: {
        reviewContext: {
          resource: 'applications',
          state: { schema: { type: 'object' } },
        },
      },
    };
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

  await t.test('state methods must be put or patch', () => {
    const doc = {
      version: '1.0',
      compositions: {
        reviewContext: {
          resource: 'applications',
          state: {
            schema: { name: 'ReviewProgress', type: 'object' },
            methods: ['get'],
          },
        },
      },
    };
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

});

// ---------------------------------------------------------------------------
// sectionView composite type
// ---------------------------------------------------------------------------

test('compositions-schema sectionView', async (t) => {

  const reviewContext = {
    version: '1.0',
    compositions: {
      reviewContext: {
        compositeType: 'sectionView',
        resource: 'applications',
        sections: {
          identity: { resource: 'members', bind: 'applicationId' },
          household: { resource: 'household-info', bind: 'applicationId' },
        },
        endpoint: { path: '/applications/{applicationId}/review' },
      },
    },
  };

  await t.test('valid sectionView with sections and endpoint', () => {
    const { valid, errors } = validate(reviewContext);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('sectionView with panel include', () => {
    const doc = {
      version: '1.0',
      compositions: {
        reviewContext: {
          compositeType: 'sectionView',
          resource: 'applications',
          sections: {
            identity: { resource: 'members', bind: 'applicationId' },
          },
          panel: {
            include: {
              verifications: {
                resource: 'verifications',
                bind: 'applicationId',
                filter: "category == $section.name",
              },
            },
          },
          endpoint: { path: '/applications/{applicationId}/review' },
        },
      },
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('section node with fields and state', () => {
    const doc = {
      version: '1.0',
      compositions: {
        reviewContext: {
          compositeType: 'sectionView',
          resource: 'applications',
          sections: {
            identity: {
              resource: 'members',
              bind: 'applicationId',
              fields: ['name', 'dateOfBirth'],
              state: {
                schema: { name: 'ReviewProgress', type: 'object' },
              },
            },
          },
          endpoint: { path: '/applications/{applicationId}/review' },
        },
      },
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('section node with missing: empty (singleton resource)', () => {
    const doc = {
      version: '1.0',
      compositions: {
        reviewContext: {
          compositeType: 'sectionView',
          resource: 'applications',
          sections: {
            household: {
              resource: 'household-info',
              bind: 'applicationId',
              missing: 'empty',
            },
          },
          endpoint: { path: '/applications/{applicationId}/review' },
        },
      },
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('compositeType must be sectionView (rejects unknown)', () => {
    const doc = {
      version: '1.0',
      compositions: {
        reviewContext: {
          compositeType: 'unknownType',
          resource: 'applications',
          endpoint: { path: '/applications/{applicationId}/review' },
        },
      },
    };
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

});

