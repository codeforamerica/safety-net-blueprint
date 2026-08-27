/**
 * Unit tests for state-machine-validator.js
 *
 * Tests both within-file consistency (validateWithinFile) and
 * cross-artifact field reference validation (validateCrossArtifact).
 *
 * Each rule has:
 *   - a positive test (valid input → no errors)
 *   - a negative test (invalid input → specific error)
 *
 * Smoke tests run the real state machine files to confirm they pass.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import {
  validateWithinFile,
  validateCrossArtifact,
  extractFieldRefs,
  extractEnumComparisons,
  collectContextBindings,
  extractConditionIds,
  collectTopLevelProperties,
  getPropertyAtPath,
  resolveRef,
  walkPushBodiesInCalls,
  collectCallBodyLiterals,
} from '../../src/validation/state-machine-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractsRoot = join(__dirname, '../../');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorRules(errors) {
  return errors.map(e => e.rule);
}

function hasRule(errors, rule) {
  return errors.some(e => e.rule === rule);
}

function makeMachine(overrides = {}) {
  return {
    object: 'Application',
    states: [{ id: 'draft' }, { id: 'submitted' }],
    initialState: 'draft',
    guards: [],
    actions: [],
    procedures: [],
    events: [],
    ...overrides,
  };
}

function makeDoc(machineOverrides = {}, docOverrides = {}) {
  return {
    $schema: './schemas/state-machine-schema.yaml',
    version: '1.0',
    domain: 'intake',
    machines: [makeMachine(machineOverrides)],
    guards: [
      { id: 'callerIsApplicant', condition: '"applicant" in caller.roles' },
      { id: 'callerIsCaseworker', condition: '"case_worker" in caller.roles' },
    ],
    ...docOverrides,
  };
}

// Minimal in-memory schema index for cross-artifact tests
function makeSchemaIndex(extra = {}) {
  const applicationSpec = {
    info: { 'x-domain': 'intake' },
    components: {
      schemas: {
        Application: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'submitted', 'closed'] },
            programsAppliedFor: { type: 'array', items: { type: 'string', enum: ['snap', 'medicaid', 'tanf'] } },
            submittedAt: { type: 'string', format: 'date-time' },
            closedAt: { type: 'string', format: 'date-time' },
          },
        },
        ApplicationMember: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            applicationId: { type: 'string' },
          },
        },
        Verification: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            evidence: { type: 'array', items: { $ref: '#/components/schemas/VerificationEvidenceItem' } },
          },
        },
        VerificationEvidenceItem: {
          oneOf: [{ $ref: '#/components/schemas/VerificationElectronicEvidence' }],
        },
        VerificationElectronicEvidence: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['electronic'] },
            source: { type: 'string', enum: ['fdsh_ssa', 'fdsh_vlp', 'ssa_ievs'] },
            result: { type: 'string', enum: ['conclusive', 'inconclusive'] },
          },
        },
        ...extra,
      },
    },
  };

  const index = new Map();
  for (const [name, schema] of Object.entries(applicationSpec.components.schemas)) {
    index.set(name, {
      spec: applicationSpec,
      schema,
      properties: collectTopLevelProperties(applicationSpec, schema),
    });
  }
  return index;
}

function makeEndpointIndex(extra = {}) {
  return new Map([
    ['intake/applications', 'Application'],
    ['intake/application-members', 'ApplicationMember'],
    ['intake/applications/verifications', 'Verification'],
    ...Object.entries(extra),
  ]);
}

// Builds a single { spec, schema, properties } entry for use in a schemaIndex Map.
// Avoids repeating the full spec skeleton in every scenario test.
function buildSchemaEntry(schemaName, properties) {
  const spec = {
    info: { 'x-domain': 'intake' },
    components: { schemas: { [schemaName]: { type: 'object', properties } } },
  };
  const schema = spec.components.schemas[schemaName];
  return { spec, schema, properties: collectTopLevelProperties(spec, schema) };
}

// ---------------------------------------------------------------------------
// extractFieldRefs
// ---------------------------------------------------------------------------

describe('extractFieldRefs', () => {
  test('extracts simple $variable.field', () => {
    const refs = extractFieldRefs('$application.status == "submitted"');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].variable, 'application');
    assert.equal(refs[0].field, 'status');
  });

  test('extracts nested $variable.field.sub', () => {
    const refs = extractFieldRefs('$member.contact.name');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].field, 'contact.name');
  });

  test('extracts multiple refs from one string', () => {
    const refs = extractFieldRefs('"snap" in $application.programsAppliedFor && $object.status == "draft"');
    assert.equal(refs.length, 2);
    assert.ok(refs.some(r => r.variable === 'application' && r.field === 'programsAppliedFor'));
    assert.ok(refs.some(r => r.variable === 'object' && r.field === 'status'));
  });

  test('returns empty array for strings with no refs', () => {
    assert.deepEqual(extractFieldRefs('no references here'), []);
  });

  test('returns empty array for non-string input', () => {
    assert.deepEqual(extractFieldRefs(null), []);
    assert.deepEqual(extractFieldRefs(42), []);
  });
});

// ---------------------------------------------------------------------------
// extractEnumComparisons
// ---------------------------------------------------------------------------

describe('extractEnumComparisons', () => {
  test('extracts "value" in $var.field pattern', () => {
    const cs = extractEnumComparisons('"snap" in $application.programsAppliedFor');
    assert.equal(cs.length, 1);
    assert.equal(cs[0].value, 'snap');
    assert.equal(cs[0].variable, 'application');
    assert.equal(cs[0].field, 'programsAppliedFor');
  });

  test('extracts $var.field == "value" pattern', () => {
    const cs = extractEnumComparisons('$application.status == "submitted"');
    assert.equal(cs.length, 1);
    assert.equal(cs[0].value, 'submitted');
    assert.equal(cs[0].variable, 'application');
    assert.equal(cs[0].field, 'status');
  });

  test('extracts "value" == $var.field pattern', () => {
    const cs = extractEnumComparisons('"draft" == $object.status');
    assert.equal(cs.length, 1);
    assert.equal(cs[0].value, 'draft');
  });

  test('returns empty for no comparisons', () => {
    assert.deepEqual(extractEnumComparisons('$application.programsAppliedFor.size() > 0'), []);
  });
});

// ---------------------------------------------------------------------------
// walkPushBodiesInCalls
// ---------------------------------------------------------------------------

describe('walkPushBodiesInCalls', () => {
  test('yields push body from a call with $push in body field', () => {
    const steps = [{
      call: { PATCH: 'intake/applications/verifications/$id' },
      body: { evidence: { $push: { type: 'electronic', source: 'fdsh_ssa' } } },
    }];
    const results = [...walkPushBodiesInCalls(steps)];
    assert.equal(results.length, 1);
    assert.equal(results[0].method, 'PATCH');
    assert.equal(results[0].bodyField, 'evidence');
    assert.deepEqual(results[0].pushBody, { type: 'electronic', source: 'fdsh_ssa' });
  });

  test('finds push in nested when: branches', () => {
    const steps = [{
      match: '$this.data.result',
      when: {
        conclusive: [{
          call: { PATCH: 'intake/applications/verifications/$id' },
          body: { evidence: { $push: { type: 'electronic', source: 'fdsh_ssa' } } },
        }],
      },
    }];
    assert.equal([...walkPushBodiesInCalls(steps)].length, 1);
  });

  test('ignores calls without $push in body', () => {
    const steps = [{ call: { POST: 'intake/applications' }, body: { status: 'draft' } }];
    assert.equal([...walkPushBodiesInCalls(steps)].length, 0);
  });

  test('ignores $push with non-object value', () => {
    const steps = [{
      call: { PATCH: 'intake/applications/$id' },
      body: { appointments: { $push: '$this.subject' } },
    }];
    assert.equal([...walkPushBodiesInCalls(steps)].length, 0);
  });
});

// ---------------------------------------------------------------------------
// collectCallBodyLiterals
// ---------------------------------------------------------------------------

describe('collectCallBodyLiterals', () => {
  test('collects literal values from call body fields', () => {
    const steps = [{ call: { POST: 'data-exchange/service-calls' }, body: { serviceType: 'fdsh_ssa' } }];
    const map = collectCallBodyLiterals(steps);
    assert.ok(map.get('serviceType')?.has('fdsh_ssa'));
  });

  test('collects literals from multiple calls into the same field', () => {
    const steps = [
      { call: { POST: 'data-exchange/service-calls' }, body: { serviceType: 'fdsh_ssa' } },
      { call: { POST: 'data-exchange/service-calls' }, body: { serviceType: 'ssa_ievs' } },
    ];
    const map = collectCallBodyLiterals(steps);
    assert.ok(map.get('serviceType')?.has('fdsh_ssa'));
    assert.ok(map.get('serviceType')?.has('ssa_ievs'));
  });

  test('does not collect $-prefixed variable references', () => {
    const steps = [{ call: { POST: 'data-exchange/service-calls' }, body: { serviceType: '$params.serviceType' } }];
    assert.equal(collectCallBodyLiterals(steps).has('serviceType'), false);
  });

  test('collects from nested when: branches', () => {
    const steps = [{
      match: '$this.data.x',
      when: { done: [{ call: { POST: 'some/endpoint' }, body: { status: 'active' } }] },
    }];
    assert.ok(collectCallBodyLiterals(steps).get('status')?.has('active'));
  });
});

// ---------------------------------------------------------------------------
// collectContextBindings
// ---------------------------------------------------------------------------

describe('collectContextBindings', () => {
  test('parses context array into variable→fromPath map', () => {
    const bindings = collectContextBindings([
      { application: { from: 'intake/applications', where: { id: '$object.id' } } },
      { member: { from: 'intake/application-members', where: { applicationId: '$object.id' } } },
    ]);
    assert.equal(bindings.size, 2);
    assert.equal(bindings.get('application'), 'intake/applications');
    assert.equal(bindings.get('member'), 'intake/application-members');
  });

  test('returns empty map for non-array input', () => {
    assert.equal(collectContextBindings(null).size, 0);
    assert.equal(collectContextBindings(undefined).size, 0);
  });

  test('skips entries without a from: field', () => {
    const bindings = collectContextBindings([{ task: { where: { id: '$this.subject' } } }]);
    assert.equal(bindings.size, 0);
  });
});

// ---------------------------------------------------------------------------
// extractConditionIds
// ---------------------------------------------------------------------------

describe('extractConditionIds', () => {
  test('extracts plain string conditions', () => {
    assert.deepEqual(extractConditionIds(['callerIsApplicant', 'callerIsCaseworker']), ['callerIsApplicant', 'callerIsCaseworker']);
  });

  test('extracts conditions from {any: [...]} form', () => {
    assert.deepEqual(extractConditionIds([{ any: ['callerIsApplicant', 'callerIsCaseworker'] }]), ['callerIsApplicant', 'callerIsCaseworker']);
  });

  test('extracts conditions from {all: [...]} form', () => {
    assert.deepEqual(extractConditionIds([{ all: ['callerIsApplicant'] }]), ['callerIsApplicant']);
  });

  test('handles mixed forms', () => {
    const ids = extractConditionIds(['guardA', { any: ['guardB', 'guardC'] }]);
    assert.deepEqual(ids, ['guardA', 'guardB', 'guardC']);
  });
});

// ---------------------------------------------------------------------------
// resolveRef and collectTopLevelProperties
// ---------------------------------------------------------------------------

describe('resolveRef', () => {
  const spec = {
    components: { schemas: { Foo: { type: 'object', properties: { bar: { type: 'string' } } } } },
  };

  test('resolves internal $ref', () => {
    const resolved = resolveRef(spec, '#/components/schemas/Foo');
    assert.ok(resolved);
    assert.ok(resolved.properties?.bar);
  });

  test('returns null for non-# refs', () => {
    assert.equal(resolveRef(spec, './other.yaml#/Foo'), null);
  });

  test('returns null for unresolvable path', () => {
    assert.equal(resolveRef(spec, '#/components/schemas/Missing'), null);
  });
});

describe('collectTopLevelProperties', () => {
  test('collects direct properties', () => {
    const spec = { components: { schemas: {} } };
    const schema = { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } } };
    const props = collectTopLevelProperties(spec, schema);
    assert.ok(props.has('id'));
    assert.ok(props.has('status'));
  });

  test('follows allOf to collect properties', () => {
    const spec = { components: { schemas: {
      Base: { type: 'object', properties: { id: { type: 'string' } } },
    } } };
    const schema = { allOf: [{ $ref: '#/components/schemas/Base' }, { type: 'object', properties: { name: { type: 'string' } } }] };
    const props = collectTopLevelProperties(spec, schema);
    assert.ok(props.has('id'));
    assert.ok(props.has('name'));
  });
});

describe('getPropertyAtPath', () => {
  const spec = {
    components: { schemas: {
      Address: { type: 'object', properties: { city: { type: 'string' }, zip: { type: 'string' } } },
    } },
  };
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      address: { $ref: '#/components/schemas/Address' },
    },
  };

  test('returns top-level property schema', () => {
    const prop = getPropertyAtPath(spec, schema, 'name');
    assert.ok(prop);
    assert.equal(prop.type, 'string');
  });

  test('traverses nested $ref', () => {
    const prop = getPropertyAtPath(spec, schema, 'address.city');
    assert.ok(prop);
    assert.equal(prop.type, 'string');
  });

  test('returns null for non-existent path', () => {
    assert.equal(getPropertyAtPath(spec, schema, 'nonExistent'), null);
    assert.equal(getPropertyAtPath(spec, schema, 'name.sub'), null);
  });
});

// ---------------------------------------------------------------------------
// validateWithinFile — rule: duplicate IDs
// ---------------------------------------------------------------------------

describe('validateWithinFile — duplicate IDs', () => {
  test('passes with unique state IDs', () => {
    const doc = makeDoc({ states: [{ id: 'a' }, { id: 'b' }] });
    assert.equal(validateWithinFile('/fake/path.yaml', doc).length, 0);
  });

  test('errors on duplicate state ID', () => {
    const doc = makeDoc({ states: [{ id: 'a' }, { id: 'a' }] });
    const errors = validateWithinFile('/fake/path.yaml', doc);
    assert.ok(hasRule(errors, 'duplicate-id'));
  });

  test('errors on duplicate action ID', () => {
    const doc = makeDoc({
      actions: [
        { id: 'submit', transition: { from: 'draft', to: 'submitted' }, guards: [] },
        { id: 'submit', transition: { from: 'draft', to: 'submitted' }, guards: [] },
      ],
    });
    const errors = validateWithinFile('/fake/path.yaml', doc);
    assert.ok(hasRule(errors, 'duplicate-id'));
  });

  test('errors on duplicate procedure ID', () => {
    const doc = makeDoc({
      procedures: [
        { id: 'doThing', steps: [] },
        { id: 'doThing', steps: [] },
      ],
    });
    const errors = validateWithinFile('/fake/path.yaml', doc);
    assert.ok(hasRule(errors, 'duplicate-id'));
  });
});

// ---------------------------------------------------------------------------
// validateWithinFile — rule: transition state references
// ---------------------------------------------------------------------------

describe('validateWithinFile — transition state references', () => {
  test('passes when transition states exist', () => {
    const doc = makeDoc({
      actions: [{
        id: 'submit',
        guards: [{ actors: ['applicant'], conditions: ['callerIsApplicant'] }],
        transition: { from: 'draft', to: 'submitted' },
      }],
    });
    assert.equal(validateWithinFile('/fake/path.yaml', doc).length, 0);
  });

  test('errors when transition.from references unknown state', () => {
    const doc = makeDoc({
      actions: [{ id: 'submit', guards: [], transition: { from: 'nonexistent', to: 'submitted' } }],
    });
    const errors = validateWithinFile('/fake/path.yaml', doc);
    assert.ok(hasRule(errors, 'unknown-state'));
  });

  test('errors when transition.to references unknown state', () => {
    const doc = makeDoc({
      actions: [{ id: 'submit', guards: [], transition: { from: 'draft', to: 'nonexistent' } }],
    });
    const errors = validateWithinFile('/fake/path.yaml', doc);
    assert.ok(hasRule(errors, 'unknown-state'));
  });

  test('allows array of from states', () => {
    const doc = makeDoc({
      actions: [{ id: 'a', guards: [], transition: { from: ['draft', 'submitted'], to: 'submitted' } }],
    });
    assert.equal(validateWithinFile('/fake/path.yaml', doc).length, 0);
  });

  test('errors in array-from when one state is unknown', () => {
    const doc = makeDoc({
      actions: [{ id: 'a', guards: [], transition: { from: ['draft', 'missing'], to: 'submitted' } }],
    });
    assert.ok(hasRule(validateWithinFile('/fake/path.yaml', doc), 'unknown-state'));
  });
});

// ---------------------------------------------------------------------------
// validateWithinFile — rule: guard condition IDs
// ---------------------------------------------------------------------------

describe('validateWithinFile — guard condition IDs', () => {
  test('passes when all condition IDs are declared', () => {
    const doc = makeDoc({
      actions: [{
        id: 'submit',
        transition: { from: 'draft', to: 'submitted' },
        guards: [{ actors: ['applicant'], conditions: ['callerIsApplicant'] }],
      }],
    });
    assert.equal(validateWithinFile('/fake/path.yaml', doc).length, 0);
  });

  test('errors when condition ID is not declared', () => {
    const doc = makeDoc({
      actions: [{
        id: 'submit',
        transition: { from: 'draft', to: 'submitted' },
        guards: [{ actors: ['applicant'], conditions: ['undeclaredGuard'] }],
      }],
    });
    assert.ok(hasRule(validateWithinFile('/fake/path.yaml', doc), 'unknown-guard'));
  });

  test('passes when condition uses {any: [...]} form with valid guards', () => {
    const doc = makeDoc({
      actions: [{
        id: 'submit',
        transition: { from: 'draft', to: 'submitted' },
        guards: [{ actors: ['applicant'], conditions: [{ any: ['callerIsApplicant', 'callerIsCaseworker'] }] }],
      }],
    });
    assert.equal(validateWithinFile('/fake/path.yaml', doc).length, 0);
  });

  test('errors when {any: [...]} references undeclared guard', () => {
    const doc = makeDoc({
      actions: [{
        id: 'submit',
        transition: { from: 'draft', to: 'submitted' },
        guards: [{ actors: ['applicant'], conditions: [{ any: ['callerIsApplicant', 'unknownGuard'] }] }],
      }],
    });
    assert.ok(hasRule(validateWithinFile('/fake/path.yaml', doc), 'unknown-guard'));
  });
});

// ---------------------------------------------------------------------------
// validateWithinFile — rule: actor roles
// ---------------------------------------------------------------------------

describe('validateWithinFile — actor roles', () => {
  test('passes with valid actor roles', () => {
    const doc = makeDoc({
      actions: [{
        id: 'submit',
        transition: { from: 'draft', to: 'submitted' },
        guards: [{ actors: ['applicant', 'case_worker', 'supervisor', 'system'], conditions: ['callerIsApplicant'] }],
      }],
    });
    assert.equal(validateWithinFile('/fake/path.yaml', doc).length, 0);
  });

  test('errors with invalid actor role', () => {
    const doc = makeDoc({
      actions: [{
        id: 'submit',
        transition: { from: 'draft', to: 'submitted' },
        guards: [{ actors: ['invalid_role'], conditions: ['callerIsApplicant'] }],
      }],
    });
    assert.ok(hasRule(validateWithinFile('/fake/path.yaml', doc), 'invalid-actor-role'));
  });
});

// ---------------------------------------------------------------------------
// validateWithinFile — rule: string-form call: references
// ---------------------------------------------------------------------------

describe('validateWithinFile — string call references', () => {
  test('passes when call: references a declared procedure', () => {
    const doc = makeDoc({
      procedures: [{ id: 'doWork', steps: [] }],
      events: [{ type: 'some.event', steps: [{ call: 'doWork' }] }],
    });
    assert.equal(validateWithinFile('/fake/path.yaml', doc).length, 0);
  });

  test('errors when call: references an undeclared callable', () => {
    const doc = makeDoc({
      events: [{ type: 'some.event', steps: [{ call: 'undeclaredProc' }] }],
    });
    assert.ok(hasRule(validateWithinFile('/fake/path.yaml', doc), 'unknown-callable'));
  });

  test('passes when call: references a declared action', () => {
    const doc = makeDoc({
      actions: [{ id: 'open', guards: [], transition: { from: 'draft', to: 'submitted' } }],
      events: [{ type: 'some.event', steps: [{ call: 'open' }] }],
    });
    assert.equal(validateWithinFile('/fake/path.yaml', doc).length, 0);
  });

  test('detects bad call: in nested then: block', () => {
    const doc = makeDoc({
      events: [{
        type: 'some.event',
        steps: [{ if: 'true', then: [{ call: 'missingProc' }] }],
      }],
    });
    assert.ok(hasRule(validateWithinFile('/fake/path.yaml', doc), 'unknown-callable'));
  });
});

// ---------------------------------------------------------------------------
// validateWithinFile — rule: $params.field references
// ---------------------------------------------------------------------------

describe('validateWithinFile — $params references', () => {
  test('passes when $params.field matches declared parameter', () => {
    const doc = makeDoc({
      procedures: [{
        id: 'myProc',
        parameters: ['program', 'category'],
        if: '$params.program in $application.programsAppliedFor',
        then: [],
      }],
    });
    assert.equal(validateWithinFile('/fake/path.yaml', doc).length, 0);
  });

  test('errors when $params.field references undeclared parameter', () => {
    const doc = makeDoc({
      procedures: [{
        id: 'myProc',
        parameters: ['program'],
        if: '$params.undeclaredParam == "foo"',
        then: [],
      }],
    });
    assert.ok(hasRule(validateWithinFile('/fake/path.yaml', doc), 'unknown-param'));
  });
});

// ---------------------------------------------------------------------------
// validateCrossArtifact — rule: unknown-object
// ---------------------------------------------------------------------------

describe('validateCrossArtifact — machine object exists', () => {
  test('passes when object exists in schema index', () => {
    const doc = makeDoc();
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.equal(errors.filter(e => e.rule === 'unknown-object').length, 0);
  });

  test('errors when object is not in any spec', () => {
    const doc = makeDoc({ object: 'NonExistentSchema' });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.ok(hasRule(errors, 'unknown-object'));
  });
});

// ---------------------------------------------------------------------------
// validateCrossArtifact — rule: unknown-endpoint (context from:)
// ---------------------------------------------------------------------------

describe('validateCrossArtifact — context from: resolves', () => {
  test('passes when context from: is a known endpoint', () => {
    const doc = makeDoc({
      actions: [{
        id: 'submit',
        context: [{ application: { from: 'intake/applications', where: {} } }],
        guards: [],
        transition: { from: 'draft', to: 'submitted' },
        steps: [],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.equal(errors.filter(e => e.rule === 'unknown-endpoint').length, 0);
  });

  test('errors when context from: is an unknown endpoint', () => {
    const doc = makeDoc({
      actions: [{
        id: 'submit',
        context: [{ foo: { from: 'nonexistent/resource', where: {} } }],
        guards: [],
        transition: { from: 'draft', to: 'submitted' },
        steps: [],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.ok(hasRule(errors, 'unknown-endpoint'));
  });
});

// ---------------------------------------------------------------------------
// validateCrossArtifact — rule: unknown-field ($variable.field)
// ---------------------------------------------------------------------------

describe('validateCrossArtifact — $variable.field exists on schema', () => {
  test('passes when $object.field exists on object schema', () => {
    const doc = makeDoc({
      actions: [{
        id: 'submit',
        guards: [],
        transition: { from: 'draft', to: 'submitted' },
        steps: [{ set: { field: 'submittedAt', value: '$now' } }],
        // use $object.status in an if condition
      }],
      // embed a guard that references $object.status
      guards: [
        { id: 'callerIsApplicant', condition: '"applicant" in caller.roles' },
        { id: 'callerIsCaseworker', condition: '"case_worker" in caller.roles' },
        { id: 'checkStatus', condition: '$object.status == "draft"' },
      ],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.equal(errors.filter(e => e.rule === 'unknown-field').length, 0);
  });

  test('errors when $object.field does not exist on object schema', () => {
    const doc = makeDoc({
      guards: [
        { id: 'callerIsApplicant', condition: '"applicant" in caller.roles' },
        { id: 'badCheck', condition: '$object.nonExistentField == "x"' },
      ],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.ok(hasRule(errors, 'unknown-field'));
  });

  test('errors when $contextVar.field does not exist on bound schema', () => {
    const doc = makeDoc({
      events: [{
        type: 'some.event',
        context: [{ application: { from: 'intake/applications', where: {} } }],
        steps: [{ if: '$application.nonExistentField == "x"', then: [] }],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.ok(hasRule(errors, 'unknown-field'));
  });

  test('passes when $contextVar.field exists on bound schema', () => {
    const doc = makeDoc({
      events: [{
        type: 'some.event',
        context: [{ application: { from: 'intake/applications', where: {} } }],
        steps: [{ if: '$application.status == "draft"', then: [] }],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.equal(errors.filter(e => e.rule === 'unknown-field').length, 0);
  });

  test('does not error on system variables ($this, $caller, $now)', () => {
    const doc = makeDoc({
      events: [{
        type: 'some.event',
        steps: [{ if: '$this.subject != null', then: [] }],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.equal(errors.filter(e => e.rule === 'unknown-field').length, 0);
  });
});

// ---------------------------------------------------------------------------
// validateCrossArtifact — rule: invalid-enum-value
// ---------------------------------------------------------------------------

describe('validateCrossArtifact — enum string literal values', () => {
  test('passes when "value" in $var.field matches enum', () => {
    const doc = makeDoc({
      events: [{
        type: 'some.event',
        context: [{ application: { from: 'intake/applications', where: {} } }],
        steps: [{ if: '"snap" in $application.programsAppliedFor', then: [] }],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.equal(errors.filter(e => e.rule === 'invalid-enum-value').length, 0);
  });

  test('errors when "value" in $var.field is not a valid enum', () => {
    const doc = makeDoc({
      events: [{
        type: 'some.event',
        context: [{ application: { from: 'intake/applications', where: {} } }],
        steps: [{ if: '"invalidProgram" in $application.programsAppliedFor', then: [] }],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.ok(hasRule(errors, 'invalid-enum-value'));
  });

  test('passes when $var.field == "value" matches enum', () => {
    const doc = makeDoc({
      events: [{
        type: 'some.event',
        context: [{ application: { from: 'intake/applications', where: {} } }],
        steps: [{ if: '$application.status == "submitted"', then: [] }],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.equal(errors.filter(e => e.rule === 'invalid-enum-value').length, 0);
  });

  test('errors when $var.field == "value" is not a valid enum', () => {
    const doc = makeDoc({
      events: [{
        type: 'some.event',
        context: [{ application: { from: 'intake/applications', where: {} } }],
        steps: [{ if: '$application.status == "not_a_real_status"', then: [] }],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.ok(hasRule(errors, 'invalid-enum-value'));
  });
});

// ---------------------------------------------------------------------------
// validateCrossArtifact — rule: invalid-push-enum-value
// ---------------------------------------------------------------------------

describe('validateCrossArtifact — invalid-push-enum-value', () => {
  function makePushDoc(pushBody, extraSteps = []) {
    return makeDoc({
      procedures: [{
        id: 'recordEvidence',
        steps: [
          ...extraSteps,
          {
            call: { PATCH: 'intake/applications/verifications/$id' },
            body: { evidence: { $push: pushBody } },
          },
        ],
      }],
    });
  }

  test('passes when literal push field value is a valid enum value', () => {
    const doc = makePushDoc({ type: 'electronic', source: 'fdsh_ssa', result: 'conclusive' });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.equal(errors.filter(e => e.rule === 'invalid-push-enum-value').length, 0);
  });

  test('errors when literal push field value is not in enum', () => {
    const doc = makePushDoc({ type: 'electronic', source: 'not_a_real_source', result: 'conclusive' });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.ok(hasRule(errors, 'invalid-push-enum-value'));
  });

  test('passes when variable reference traces only to valid enum values', () => {
    const extraSteps = [
      { call: { POST: 'data-exchange/service-calls' }, body: { serviceType: 'fdsh_ssa' } },
      { call: { POST: 'data-exchange/service-calls' }, body: { serviceType: 'ssa_ievs' } },
    ];
    const doc = makePushDoc({ type: 'electronic', source: '$this.data.serviceType', result: 'conclusive' }, extraSteps);
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.equal(errors.filter(e => e.rule === 'invalid-push-enum-value').length, 0);
  });

  test('errors when variable reference traces to a value not in enum', () => {
    const extraSteps = [
      { call: { POST: 'data-exchange/service-calls' }, body: { serviceType: 'fdsh_ssa' } },
      { call: { POST: 'data-exchange/service-calls' }, body: { serviceType: 'unknown_service' } },
    ];
    const doc = makePushDoc({ type: 'electronic', source: '$this.data.serviceType', result: 'conclusive' }, extraSteps);
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.ok(hasRule(errors, 'invalid-push-enum-value'));
  });
});

// ---------------------------------------------------------------------------
// validateCrossArtifact — rule: unknown-set-field
// ---------------------------------------------------------------------------

describe('validateCrossArtifact — set: field exists on object schema', () => {
  test('passes when set: field exists on object schema', () => {
    const doc = makeDoc({
      actions: [{
        id: 'submit',
        guards: [],
        transition: { from: 'draft', to: 'submitted' },
        steps: [{ set: { field: 'submittedAt', value: '$now' } }],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.equal(errors.filter(e => e.rule === 'unknown-set-field').length, 0);
  });

  test('errors when set: field does not exist on object schema', () => {
    const doc = makeDoc({
      actions: [{
        id: 'submit',
        guards: [],
        transition: { from: 'draft', to: 'submitted' },
        steps: [{ set: { field: 'nonExistentField', value: '$now' } }],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, makeSchemaIndex(), makeEndpointIndex());
    assert.ok(hasRule(errors, 'unknown-set-field'));
  });
});

// ---------------------------------------------------------------------------
// Smoke tests — real files must pass both validators
// ---------------------------------------------------------------------------

describe('smoke tests — real state machine files', () => {
  const files = [
    'intake-state-machine.yaml',
    'workflow-state-machine.yaml',
    'platform-state-machine.yaml',
  ].filter(f => {
    try { readFileSync(join(contractsRoot, f)); return true; } catch { return false; }
  });

  for (const file of files) {
    test(`${file} passes validateWithinFile`, () => {
      const doc = yaml.load(readFileSync(join(contractsRoot, file), 'utf8'));
      const errors = validateWithinFile(join(contractsRoot, file), doc);
      assert.deepEqual(
        errors,
        [],
        `Expected no errors but got:\n${errors.map(e => `  [${e.rule}] ${e.message} at ${e.path}`).join('\n')}`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Scenario tests — simulate four change types an overlay can make, and assert
// the validator catches state machine references to the old name.
//
// Each describe block tests: stale reference → error; updated reference → pass.
// ---------------------------------------------------------------------------

describe('scenario: field rename — overlay renames programsAppliedFor → programs', () => {
  // Resolved spec after the rename: Application no longer has programsAppliedFor
  const spec = {
    info: { 'x-domain': 'intake' },
    components: {
      schemas: {
        Application: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'submitted'] },
            programs: { type: 'array', items: { type: 'string', enum: ['snap', 'medicaid'] } },
          },
        },
      },
    },
  };
  const schemaIndex = new Map([['Application', {
    spec,
    schema: spec.components.schemas.Application,
    properties: collectTopLevelProperties(spec, spec.components.schemas.Application),
  }]]);
  const endpointIndex = new Map([['intake/applications', 'Application']]);

  function eventWithGuard(guard) {
    return [{
      type: 'some.event',
      context: [{ application: { from: 'intake/applications', where: {} } }],
      steps: [{ if: guard, then: [] }],
    }];
  }

  test('catches stale $application.programsAppliedFor (old field name)', () => {
    const doc = makeDoc({ events: eventWithGuard('"snap" in $application.programsAppliedFor') });
    const errors = validateCrossArtifact('/fake.yaml', doc, schemaIndex, endpointIndex);
    assert.ok(
      hasRule(errors, 'unknown-field'),
      `Expected unknown-field for stale field name but got: ${JSON.stringify(errors)}`
    );
  });

  test('passes with $application.programs (updated field name)', () => {
    const doc = makeDoc({ events: eventWithGuard('"snap" in $application.programs') });
    const errors = validateCrossArtifact('/fake.yaml', doc, schemaIndex, endpointIndex);
    assert.equal(errors.filter(e => e.rule === 'unknown-field').length, 0);
  });
});

describe('scenario: enum value rename — overlay changes "snap" → "calfresh"', () => {
  // Resolved spec after the rename: programsAppliedFor enum no longer includes "snap"
  const spec = {
    info: { 'x-domain': 'intake' },
    components: {
      schemas: {
        Application: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            programsAppliedFor: {
              type: 'array',
              items: { type: 'string', enum: ['calfresh', 'medi_cal', 'calworks'] },
            },
          },
        },
      },
    },
  };
  const schemaIndex = new Map([['Application', {
    spec,
    schema: spec.components.schemas.Application,
    properties: collectTopLevelProperties(spec, spec.components.schemas.Application),
  }]]);
  const endpointIndex = new Map([['intake/applications', 'Application']]);

  function eventWithGuard(guard) {
    return [{
      type: 'some.event',
      context: [{ application: { from: 'intake/applications', where: {} } }],
      steps: [{ if: guard, then: [] }],
    }];
  }

  test('catches stale "snap" enum value (old value)', () => {
    const doc = makeDoc({ events: eventWithGuard('"snap" in $application.programsAppliedFor') });
    const errors = validateCrossArtifact('/fake.yaml', doc, schemaIndex, endpointIndex);
    assert.ok(
      hasRule(errors, 'invalid-enum-value'),
      `Expected invalid-enum-value for stale enum value but got: ${JSON.stringify(errors)}`
    );
  });

  test('passes with "calfresh" enum value (updated value)', () => {
    const doc = makeDoc({ events: eventWithGuard('"calfresh" in $application.programsAppliedFor') });
    const errors = validateCrossArtifact('/fake.yaml', doc, schemaIndex, endpointIndex);
    assert.equal(errors.filter(e => e.rule === 'invalid-enum-value').length, 0);
  });
});

describe('scenario: endpoint rename — overlay renames intake/applications → intake/intake-submissions', () => {
  // Resolved spec: endpoint path has changed; old path is gone
  const schemaIndex = makeSchemaIndex();
  const updatedEndpointIndex = new Map([
    ['intake/intake-submissions', 'Application'],  // new path
    ['intake/application-members', 'ApplicationMember'],
  ]);

  test('catches stale context from: intake/applications (old endpoint)', () => {
    const doc = makeDoc({
      events: [{
        type: 'some.event',
        context: [{ application: { from: 'intake/applications', where: {} } }],
        steps: [],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, schemaIndex, updatedEndpointIndex);
    assert.ok(
      hasRule(errors, 'unknown-endpoint'),
      `Expected unknown-endpoint for stale endpoint path but got: ${JSON.stringify(errors)}`
    );
  });

  test('passes with context from: intake/intake-submissions (updated endpoint)', () => {
    const doc = makeDoc({
      events: [{
        type: 'some.event',
        context: [{ application: { from: 'intake/intake-submissions', where: {} } }],
        steps: [],
      }],
    });
    const errors = validateCrossArtifact('/fake.yaml', doc, schemaIndex, updatedEndpointIndex);
    assert.equal(errors.filter(e => e.rule === 'unknown-endpoint').length, 0);
  });
});

describe('scenario: object rename — overlay renames Application schema → IntakeForm', () => {
  // Resolved spec: Application schema is gone, replaced by IntakeForm
  const spec = {
    info: { 'x-domain': 'intake' },
    components: {
      schemas: {
        IntakeForm: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'submitted'] },
            programsAppliedFor: { type: 'array', items: { type: 'string', enum: ['snap', 'medicaid'] } },
          },
        },
      },
    },
  };
  const schemaIndex = new Map([['IntakeForm', {
    spec,
    schema: spec.components.schemas.IntakeForm,
    properties: collectTopLevelProperties(spec, spec.components.schemas.IntakeForm),
  }]]);
  const endpointIndex = new Map([['intake/applications', 'IntakeForm']]);

  test('catches stale machine object: Application (old schema name)', () => {
    // machine still declares object: Application but that schema no longer exists
    const doc = makeDoc({ object: 'Application' });
    const errors = validateCrossArtifact('/fake.yaml', doc, schemaIndex, endpointIndex);
    assert.ok(
      hasRule(errors, 'unknown-object'),
      `Expected unknown-object for stale schema name but got: ${JSON.stringify(errors)}`
    );
  });

  test('passes with machine object: IntakeForm (updated schema name)', () => {
    const doc = makeDoc({ object: 'IntakeForm' });
    const errors = validateCrossArtifact('/fake.yaml', doc, schemaIndex, endpointIndex);
    assert.equal(errors.filter(e => e.rule === 'unknown-object').length, 0);
  });
});
