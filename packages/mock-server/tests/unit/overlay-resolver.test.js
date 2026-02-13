/**
 * Unit tests for Overlay Resolver
 * Tests JSONPath operations and overlay application
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  resolvePath,
  setAtPath,
  removeAtPath,
  renameAtPath,
  replaceAtPath,
  checkPathExists,
  rootExists,
  applyOverlay
} from '@safety-net/contracts/overlay';

test('Overlay Resolver Tests', async (t) => {

  // ==========================================================================
  // resolvePath tests
  // ==========================================================================

  await t.test('resolvePath - resolves simple path', () => {
    const obj = { foo: { bar: 'value' } };
    assert.strictEqual(resolvePath(obj, '$.foo.bar'), 'value');
  });

  await t.test('resolvePath - resolves path without $ prefix', () => {
    const obj = { foo: { bar: 'value' } };
    assert.strictEqual(resolvePath(obj, 'foo.bar'), 'value');
  });

  await t.test('resolvePath - returns undefined for non-existent path', () => {
    const obj = { foo: { bar: 'value' } };
    assert.strictEqual(resolvePath(obj, '$.foo.baz'), undefined);
  });

  await t.test('resolvePath - handles nested objects', () => {
    const obj = {
      Person: {
        properties: {
          name: { type: 'string' }
        }
      }
    };
    assert.deepStrictEqual(resolvePath(obj, '$.Person.properties.name'), { type: 'string' });
  });

  await t.test('resolvePath - returns undefined for null intermediate', () => {
    const obj = { foo: null };
    assert.strictEqual(resolvePath(obj, '$.foo.bar'), undefined);
  });

  // ==========================================================================
  // setAtPath tests
  // ==========================================================================

  await t.test('setAtPath - sets value at simple path', () => {
    const obj = { foo: {} };
    setAtPath(obj, '$.foo.bar', 'value');
    assert.strictEqual(obj.foo.bar, 'value');
  });

  await t.test('setAtPath - creates intermediate objects', () => {
    const obj = {};
    setAtPath(obj, '$.foo.bar.baz', 'value');
    assert.strictEqual(obj.foo.bar.baz, 'value');
  });

  await t.test('setAtPath - replaces array values', () => {
    const obj = { foo: { enum: ['a', 'b'] } };
    setAtPath(obj, '$.foo.enum', ['x', 'y', 'z']);
    assert.deepStrictEqual(obj.foo.enum, ['x', 'y', 'z']);
  });

  await t.test('setAtPath - merges object values', () => {
    const obj = {
      Person: {
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' }
        }
      }
    };
    setAtPath(obj, '$.Person.properties', {
      newField: { type: 'boolean' }
    });
    // Should merge, not replace
    assert.strictEqual(obj.Person.properties.name.type, 'string');
    assert.strictEqual(obj.Person.properties.age.type, 'integer');
    assert.strictEqual(obj.Person.properties.newField.type, 'boolean');
  });

  await t.test('setAtPath - replaces non-object values', () => {
    const obj = { foo: { value: 'old' } };
    setAtPath(obj, '$.foo.value', 'new');
    assert.strictEqual(obj.foo.value, 'new');
  });

  // ==========================================================================
  // removeAtPath tests
  // ==========================================================================

  await t.test('removeAtPath - removes value at path', () => {
    const obj = { foo: { bar: 'value', baz: 'keep' } };
    removeAtPath(obj, '$.foo.bar');
    assert.strictEqual(obj.foo.bar, undefined);
    assert.strictEqual(obj.foo.baz, 'keep');
  });

  await t.test('removeAtPath - handles non-existent path gracefully', () => {
    const obj = { foo: {} };
    removeAtPath(obj, '$.foo.bar.baz'); // Should not throw
    assert.deepStrictEqual(obj, { foo: {} });
  });

  // ==========================================================================
  // renameAtPath tests
  // ==========================================================================

  await t.test('renameAtPath - renames property at path', () => {
    const obj = {
      Person: {
        properties: {
          oldName: { type: 'string', description: 'Original field' }
        }
      }
    };
    const result = renameAtPath(obj, '$.Person.properties.oldName', 'newName');
    assert.strictEqual(result, true);
    assert.strictEqual(obj.Person.properties.oldName, undefined);
    assert.deepStrictEqual(obj.Person.properties.newName, { type: 'string', description: 'Original field' });
  });

  await t.test('renameAtPath - preserves other properties', () => {
    const obj = {
      Person: {
        properties: {
          keep: { type: 'integer' },
          rename: { type: 'string' }
        }
      }
    };
    renameAtPath(obj, '$.Person.properties.rename', 'renamed');
    assert.strictEqual(obj.Person.properties.keep.type, 'integer');
    assert.strictEqual(obj.Person.properties.renamed.type, 'string');
    assert.strictEqual(obj.Person.properties.rename, undefined);
  });

  await t.test('renameAtPath - returns false for non-existent source', () => {
    const obj = { Person: { properties: {} } };
    const result = renameAtPath(obj, '$.Person.properties.nonexistent', 'newName');
    assert.strictEqual(result, false);
  });

  await t.test('renameAtPath - returns false for non-existent path', () => {
    const obj = { Person: {} };
    const result = renameAtPath(obj, '$.Person.properties.field', 'newName');
    assert.strictEqual(result, false);
  });

  // ==========================================================================
  // checkPathExists tests
  // ==========================================================================

  await t.test('checkPathExists - returns fullPathExists true for existing path', () => {
    const obj = {
      Person: {
        properties: {
          name: { type: 'string' }
        }
      }
    };
    const result = checkPathExists(obj, '$.Person.properties.name');
    assert.strictEqual(result.rootExists, true);
    assert.strictEqual(result.fullPathExists, true);
    assert.strictEqual(result.missingAt, null);
  });

  await t.test('checkPathExists - returns rootExists false for missing root', () => {
    const obj = { Person: {} };
    const result = checkPathExists(obj, '$.Application.properties');
    assert.strictEqual(result.rootExists, false);
    assert.strictEqual(result.fullPathExists, false);
    assert.strictEqual(result.missingAt, null);
  });

  await t.test('checkPathExists - identifies where path stops existing', () => {
    const obj = {
      Person: {
        properties: {
          name: { type: 'string' }
        }
      }
    };
    const result = checkPathExists(obj, '$.Person.properties.age.enum');
    assert.strictEqual(result.rootExists, true);
    assert.strictEqual(result.fullPathExists, false);
    assert.strictEqual(result.missingAt, 'Person.properties.age');
  });

  // ==========================================================================
  // rootExists tests
  // ==========================================================================

  await t.test('rootExists - returns true when root schema exists', () => {
    const obj = { Person: { properties: {} } };
    assert.strictEqual(rootExists(obj, '$.Person.properties.name'), true);
  });

  await t.test('rootExists - returns false when root schema missing', () => {
    const obj = { Person: {} };
    assert.strictEqual(rootExists(obj, '$.Application.properties'), false);
  });

  // ==========================================================================
  // applyOverlay tests
  // ==========================================================================

  await t.test('applyOverlay - applies update action', () => {
    const spec = {
      Person: {
        properties: {
          status: {
            enum: ['active', 'inactive']
          }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties.status.enum',
          update: ['enabled', 'disabled', 'pending']
        }
      ]
    };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    assert.deepStrictEqual(result.Person.properties.status.enum, ['enabled', 'disabled', 'pending']);
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('applyOverlay - applies remove action', () => {
    const spec = {
      Person: {
        properties: {
          name: { type: 'string' },
          deprecated: { type: 'string' }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties.deprecated',
          remove: true
        }
      ]
    };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    assert.strictEqual(result.Person.properties.deprecated, undefined);
    assert.strictEqual(result.Person.properties.name.type, 'string');
  });

  await t.test('applyOverlay - adds new properties without warning', () => {
    const spec = {
      Person: {
        properties: {
          name: { type: 'string' }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties',
          description: 'Add new field',
          update: {
            countyCode: { type: 'string' }
          }
        }
      ]
    };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    assert.strictEqual(result.Person.properties.countyCode.type, 'string');
    assert.strictEqual(result.Person.properties.name.type, 'string'); // Preserved
    assert.strictEqual(warnings.length, 0); // No warning for adding to .properties
  });

  await t.test('applyOverlay - warns on non-existent target path', () => {
    const spec = {
      Person: {
        properties: {
          name: { type: 'string' }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties.nonExistent.enum',
          description: 'Update missing field',
          update: ['a', 'b']
        }
      ]
    };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('does not exist in base schema'));
    assert.ok(warnings[0].includes('Update missing field'));
  });

  await t.test('applyOverlay - skips actions for non-matching root schemas', () => {
    const spec = {
      Person: {
        properties: {}
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Application.properties.status',
          update: ['new', 'old']
        }
      ]
    };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    // Should not modify anything or warn (Application root doesn't exist in this file)
    assert.strictEqual(result.Application, undefined);
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('applyOverlay - does not mutate original spec', () => {
    const spec = {
      Person: {
        properties: {
          status: { enum: ['a', 'b'] }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties.status.enum',
          update: ['x', 'y']
        }
      ]
    };

    const { result } = applyOverlay(spec, overlay, { silent: true });

    // Original should be unchanged
    assert.deepStrictEqual(spec.Person.properties.status.enum, ['a', 'b']);
    // Result should have new values
    assert.deepStrictEqual(result.Person.properties.status.enum, ['x', 'y']);
  });

  await t.test('applyOverlay - handles empty overlay', () => {
    const spec = { Person: { properties: {} } };
    const overlay = {};

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    assert.deepStrictEqual(result, spec);
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('applyOverlay - handles overlay with no actions', () => {
    const spec = { Person: { properties: {} } };
    const overlay = { info: { title: 'Test' }, actions: [] };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    assert.deepStrictEqual(result, spec);
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('applyOverlay - skips action with missing target', () => {
    const spec = { Person: { properties: {} } };
    const overlay = {
      actions: [
        { update: ['a', 'b'] } // Missing target
      ]
    };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    // Should not crash, just skip
    assert.deepStrictEqual(result, spec);
  });

  // ==========================================================================
  // applyOverlay rename action tests
  // ==========================================================================

  await t.test('applyOverlay - applies rename action', () => {
    const spec = {
      Person: {
        properties: {
          oldFieldName: { type: 'string', description: 'A field' }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties.oldFieldName',
          description: 'Rename to match state terminology',
          rename: 'newFieldName'
        }
      ]
    };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    assert.strictEqual(result.Person.properties.oldFieldName, undefined);
    assert.deepStrictEqual(result.Person.properties.newFieldName, { type: 'string', description: 'A field' });
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('applyOverlay - rename preserves complex property definition', () => {
    const spec = {
      Person: {
        properties: {
          federalProgramId: {
            type: 'string',
            description: 'Federal program identifier',
            pattern: '^[A-Z]{2}[0-9]{6}$',
            example: 'CA123456'
          }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties.federalProgramId',
          description: 'Use state-specific name',
          rename: 'stateProgramId'
        }
      ]
    };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    assert.strictEqual(result.Person.properties.federalProgramId, undefined);
    assert.deepStrictEqual(result.Person.properties.stateProgramId, {
      type: 'string',
      description: 'Federal program identifier',
      pattern: '^[A-Z]{2}[0-9]{6}$',
      example: 'CA123456'
    });
  });

  await t.test('applyOverlay - rename warns on non-existent target', () => {
    const spec = {
      Person: {
        properties: {
          name: { type: 'string' }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties.nonexistent',
          description: 'Try to rename missing field',
          rename: 'newName'
        }
      ]
    };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('does not exist in base schema'));
  });

  await t.test('applyOverlay - rename does not mutate original spec', () => {
    const spec = {
      Person: {
        properties: {
          original: { type: 'string' }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties.original',
          rename: 'renamed'
        }
      ]
    };

    const { result } = applyOverlay(spec, overlay, { silent: true });

    // Original should be unchanged
    assert.strictEqual(spec.Person.properties.original.type, 'string');
    assert.strictEqual(spec.Person.properties.renamed, undefined);
    // Result should have renamed property
    assert.strictEqual(result.Person.properties.original, undefined);
    assert.strictEqual(result.Person.properties.renamed.type, 'string');
  });

  // ==========================================================================
  // replaceAtPath tests
  // ==========================================================================

  await t.test('replaceAtPath - replaces value at path completely', () => {
    const obj = {
      Person: {
        properties: {
          expenses: {
            type: 'array',
            items: { type: 'object' }
          }
        }
      }
    };
    replaceAtPath(obj, '$.Person.properties.expenses', {
      type: 'object',
      properties: {
        housing: { type: 'number' },
        medical: { type: 'number' }
      }
    });
    assert.strictEqual(obj.Person.properties.expenses.type, 'object');
    assert.strictEqual(obj.Person.properties.expenses.items, undefined); // Old property gone
    assert.strictEqual(obj.Person.properties.expenses.properties.housing.type, 'number');
  });

  await t.test('replaceAtPath - does not merge objects like setAtPath', () => {
    const obj = {
      Person: {
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' }
        }
      }
    };
    replaceAtPath(obj, '$.Person.properties', {
      newField: { type: 'boolean' }
    });
    // Should completely replace, not merge
    assert.strictEqual(obj.Person.properties.name, undefined);
    assert.strictEqual(obj.Person.properties.age, undefined);
    assert.strictEqual(obj.Person.properties.newField.type, 'boolean');
  });

  await t.test('replaceAtPath - creates intermediate objects if needed', () => {
    const obj = { Person: {} };
    replaceAtPath(obj, '$.Person.properties.newSchema', { type: 'string' });
    assert.strictEqual(obj.Person.properties.newSchema.type, 'string');
  });

  // ==========================================================================
  // applyOverlay replace action tests
  // ==========================================================================

  await t.test('applyOverlay - applies replace action with inline value', () => {
    const spec = {
      Person: {
        properties: {
          expenses: {
            type: 'array',
            items: { $ref: '#/Expense' }
          }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties.expenses',
          description: 'Replace with state-specific expense structure',
          replace: {
            type: 'object',
            properties: {
              housing: { type: 'number' },
              medical: { type: 'number' }
            }
          }
        }
      ]
    };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    assert.strictEqual(result.Person.properties.expenses.type, 'object');
    assert.strictEqual(result.Person.properties.expenses.items, undefined); // Completely replaced
    assert.strictEqual(result.Person.properties.expenses.properties.housing.type, 'number');
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('applyOverlay - replace does not merge, completely overwrites', () => {
    const spec = {
      Person: {
        properties: {
          contact: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              phone: { type: 'string' }
            }
          }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties.contact',
          replace: {
            type: 'object',
            properties: {
              primaryEmail: { type: 'string' }
            }
          }
        }
      ]
    };

    const { result } = applyOverlay(spec, overlay, { silent: true });

    // Old properties should be gone
    assert.strictEqual(result.Person.properties.contact.properties.email, undefined);
    assert.strictEqual(result.Person.properties.contact.properties.phone, undefined);
    // New property should exist
    assert.strictEqual(result.Person.properties.contact.properties.primaryEmail.type, 'string');
  });

  await t.test('applyOverlay - replace entire schema', () => {
    const spec = {
      Expenses: {
        type: 'array',
        items: { type: 'object' }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Expenses',
          description: 'Replace entire expenses schema',
          replace: {
            type: 'object',
            description: 'State-specific expense tracking',
            properties: {
              housing: {
                type: 'object',
                properties: {
                  rent: { type: 'number' },
                  utilities: { type: 'number' }
                }
              }
            }
          }
        }
      ]
    };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    assert.strictEqual(result.Expenses.type, 'object');
    assert.strictEqual(result.Expenses.items, undefined);
    assert.strictEqual(result.Expenses.description, 'State-specific expense tracking');
    assert.strictEqual(result.Expenses.properties.housing.properties.rent.type, 'number');
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('applyOverlay - replace does not mutate original spec', () => {
    const spec = {
      Person: {
        properties: {
          data: { type: 'string', description: 'Original' }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties.data',
          replace: { type: 'integer', description: 'Replaced' }
        }
      ]
    };

    const { result } = applyOverlay(spec, overlay, { silent: true });

    // Original unchanged
    assert.strictEqual(spec.Person.properties.data.type, 'string');
    assert.strictEqual(spec.Person.properties.data.description, 'Original');
    // Result has replacement
    assert.strictEqual(result.Person.properties.data.type, 'integer');
    assert.strictEqual(result.Person.properties.data.description, 'Replaced');
  });

  await t.test('applyOverlay - replace with $ref warns when overlayDir not provided', () => {
    const spec = {
      Person: {
        properties: {
          expenses: { type: 'array' }
        }
      }
    };
    const overlay = {
      actions: [
        {
          target: '$.Person.properties.expenses',
          description: 'Replace from file',
          replace: {
            $ref: './replacements/expenses.yaml#/StateExpenses'
          }
        }
      ]
    };

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });

    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('overlayDir not provided'));
    // Original should be unchanged since replace failed
    assert.strictEqual(result.Person.properties.expenses.type, 'array');
  });

  // ==========================================================================
  // checkPathExists tests for file scoping
  // ==========================================================================

  await t.test('checkPathExists - fullPathExists is true for nested enum path', () => {
    const personSpec = {
      CitizenshipInfo: {
        properties: {
          status: {
            type: 'string',
            enum: ['citizen', 'permanent_resident']
          }
        }
      }
    };
    const result = checkPathExists(personSpec, '$.CitizenshipInfo.properties.status.enum');
    assert.strictEqual(result.rootExists, true);
    assert.strictEqual(result.fullPathExists, true);
  });

  await t.test('checkPathExists - fullPathExists is false when structure differs', () => {
    // This simulates a schema where CitizenshipInfo exists but with different structure
    const applicationSpec = {
      CitizenshipInfo: {
        allOf: [
          { $ref: './components/person.yaml#/CitizenshipInfo' },
          { type: 'object' }
        ]
      }
    };
    const result = checkPathExists(applicationSpec, '$.CitizenshipInfo.properties.status.enum');
    assert.strictEqual(result.rootExists, true);
    assert.strictEqual(result.fullPathExists, false);
    // Should identify where path stops existing
    assert.strictEqual(result.missingAt, 'CitizenshipInfo.properties');
  });

  await t.test('checkPathExists - distinguishes files with same schema name but different paths', () => {
    // File 1: Has the full path
    const file1 = {
      Person: {
        properties: {
          gender: {
            type: 'string',
            enum: ['male', 'female']
          }
        }
      }
    };
    // File 2: Has Person but different structure
    const file2 = {
      Person: {
        $ref: './components/person.yaml#/Person'
      }
    };

    const target = '$.Person.properties.gender.enum';
    const result1 = checkPathExists(file1, target);
    const result2 = checkPathExists(file2, target);

    // File 1 should have full path
    assert.strictEqual(result1.fullPathExists, true);
    // File 2 should not have full path (uses $ref)
    assert.strictEqual(result2.fullPathExists, false);
  });

  await t.test('checkPathExists - used for file scoping logic', () => {
    // Simulate multiple files with same schema name
    const files = [
      {
        path: 'components/person.yaml',
        spec: {
          Program: {
            type: 'string',
            enum: ['SNAP', 'Medicaid']
          }
        }
      },
      {
        path: 'components/application.yaml',
        spec: {
          Program: {
            type: 'string',
            enum: ['SNAP', 'Medicaid']
          }
        }
      },
      {
        path: 'components/common.yaml',
        spec: {
          Program: {
            type: 'string',
            enum: ['SNAP', 'Medicaid']
          }
        }
      }
    ];

    const target = '$.Program.enum';

    // Find which files have the full target path
    const matchingFiles = files
      .filter(f => checkPathExists(f.spec, target).fullPathExists)
      .map(f => f.path);

    // All three files have the exact same structure, so all should match
    assert.strictEqual(matchingFiles.length, 3);
    assert.ok(matchingFiles.includes('components/person.yaml'));
    assert.ok(matchingFiles.includes('components/application.yaml'));
    assert.ok(matchingFiles.includes('components/common.yaml'));
  });

});
