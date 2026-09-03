/**
 * Unit tests for cross-domain x-relationship target validation.
 *
 * Tests buildCrossDomainSchemaIndex and validateRelationshipTargets.
 * Smoke tests run against resolved contracts.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { buildCrossDomainSchemaIndex, validateRelationshipTargets } from '../scripts/validate/annotations.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpecDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'specs-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === 'string' ? content : yaml.dump(content));
  }
  return dir;
}

function makeSpec(domain, schemas) {
  return {
    openapi: '3.1.0',
    info: { title: 'Test', version: '1.0.0', 'x-domain': domain },
    paths: {},
    components: { schemas },
  };
}

// ---------------------------------------------------------------------------
// buildCrossDomainSchemaIndex
// ---------------------------------------------------------------------------

describe('buildCrossDomainSchemaIndex', () => {
  test('returns empty map when directory has no OpenAPI specs', () => {
    const dir = makeSpecDir({});
    const index = buildCrossDomainSchemaIndex(dir);
    assert.equal(index.size, 0);
  });

  test('indexes schema names by domain', () => {
    const dir = makeSpecDir({
      'intake-openapi.yaml': yaml.dump(makeSpec('intake', {
        Application: { type: 'object' },
        ApplicationMember: { type: 'object' },
      })),
    });
    const index = buildCrossDomainSchemaIndex(dir);
    assert.ok(index.has('intake'));
    assert.ok(index.get('intake').has('Application'));
    assert.ok(index.get('intake').has('ApplicationMember'));
  });

  test('indexes schemas from multiple domains', () => {
    const dir = makeSpecDir({
      'intake-openapi.yaml': yaml.dump(makeSpec('intake', { Application: { type: 'object' } })),
      'workflow-openapi.yaml': yaml.dump(makeSpec('workflow', { Task: { type: 'object' } })),
    });
    const index = buildCrossDomainSchemaIndex(dir);
    assert.ok(index.get('intake').has('Application'));
    assert.ok(index.get('workflow').has('Task'));
  });

  test('skips specs without x-domain', () => {
    const dir = makeSpecDir({
      'no-domain-openapi.yaml': yaml.dump({
        openapi: '3.1.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {},
        components: { schemas: { Foo: { type: 'object' } } },
      }),
    });
    const index = buildCrossDomainSchemaIndex(dir);
    assert.equal(index.size, 0);
  });
});

// ---------------------------------------------------------------------------
// validateRelationshipTargets
// ---------------------------------------------------------------------------

describe('validateRelationshipTargets', () => {
  test('passes when cross-domain resource exists in the referenced domain', () => {
    const schemaIndex = new Map([['intake', new Set(['Application'])]]);
    const spec = makeSpec('eligibility', {
      Determination: {
        type: 'object',
        properties: {
          applicationId: {
            type: 'string', format: 'uuid',
            'x-relationship': { resource: 'Application', domain: 'intake' },
          },
        },
      },
    });
    assert.deepEqual(validateRelationshipTargets(spec, schemaIndex), []);
  });

  test('errors when cross-domain resource does not exist in the referenced domain', () => {
    const schemaIndex = new Map([['intake', new Set(['Application'])]]);
    const spec = makeSpec('eligibility', {
      Determination: {
        type: 'object',
        properties: {
          caseId: {
            type: 'string', format: 'uuid',
            'x-relationship': { resource: 'Case', domain: 'intake' },
          },
        },
      },
    });
    const errors = validateRelationshipTargets(spec, schemaIndex);
    assert.ok(errors.some(e => e.includes('"Case"') && e.includes('"intake"')));
  });

  test('errors when the referenced domain does not exist at all', () => {
    const schemaIndex = new Map([['intake', new Set(['Application'])]]);
    const spec = makeSpec('eligibility', {
      Determination: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string', format: 'uuid',
            'x-relationship': { resource: 'Task', domain: 'workflow' },
          },
        },
      },
    });
    const errors = validateRelationshipTargets(spec, schemaIndex);
    assert.ok(errors.some(e => e.includes('unknown domain') && e.includes('"workflow"')));
  });

  test('skips External and Polymorphic reserved resources', () => {
    const schemaIndex = new Map([['intake', new Set()]]);
    const spec = makeSpec('eligibility', {
      Determination: {
        type: 'object',
        properties: {
          externalId: {
            type: 'string', format: 'uuid',
            'x-relationship': { resource: 'External', domain: 'intake' },
          },
        },
      },
    });
    assert.deepEqual(validateRelationshipTargets(spec, schemaIndex), []);
  });

  test('skips path-style resources', () => {
    const schemaIndex = new Map([['document-management', new Set()]]);
    const spec = makeSpec('intake', {
      Application: {
        type: 'object',
        properties: {
          documentTypeId: {
            type: 'string', format: 'uuid',
            'x-relationship': { resource: 'document-management/document-types', domain: 'document-management' },
          },
        },
      },
    });
    assert.deepEqual(validateRelationshipTargets(spec, schemaIndex), []);
  });

  test('returns empty array when schema index is empty', () => {
    const spec = makeSpec('eligibility', {
      Determination: {
        type: 'object',
        properties: {
          applicationId: {
            type: 'string', format: 'uuid',
            'x-relationship': { resource: 'Application', domain: 'intake' },
          },
        },
      },
    });
    assert.deepEqual(validateRelationshipTargets(spec, new Map()), []);
  });
});

// ---------------------------------------------------------------------------
// Scenario tests
// ---------------------------------------------------------------------------

describe('scenario: cross-domain resource renamed', () => {
  // intake renamed Application → IntakeApplication
  const schemaIndex = new Map([['intake', new Set(['IntakeApplication'])]]);

  test('catches stale resource name after rename', () => {
    const spec = makeSpec('eligibility', {
      Determination: {
        type: 'object',
        properties: {
          applicationId: {
            type: 'string', format: 'uuid',
            'x-relationship': { resource: 'Application', domain: 'intake' },
          },
        },
      },
    });
    const errors = validateRelationshipTargets(spec, schemaIndex);
    assert.ok(errors.some(e => e.includes('"Application"')));
  });

  test('passes with updated resource name after rename', () => {
    const spec = makeSpec('eligibility', {
      Determination: {
        type: 'object',
        properties: {
          applicationId: {
            type: 'string', format: 'uuid',
            'x-relationship': { resource: 'IntakeApplication', domain: 'intake' },
          },
        },
      },
    });
    assert.deepEqual(validateRelationshipTargets(spec, schemaIndex), []);
  });
});

// ---------------------------------------------------------------------------
// Smoke tests — resolved contracts
