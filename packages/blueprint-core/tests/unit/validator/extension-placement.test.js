/**
 * Extension placement.
 *
 * A specification extension is legal anywhere in OpenAPI, so a misplaced one
 * parses and validates and then does nothing. These cover both halves of the
 * rule: a blueprint extension somewhere nothing reads it is an error, and
 * anything the blueprint has not declared is left alone, because states
 * invent their own and the check must not punish that.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateExtensionPlacement } from '../../../src/validator/pattern-validator.js';

/** Findings for one spec. */
function check(spec) {
  const errors = [];
  validateExtensionPlacement(spec, errors);
  return errors;
}

const spec = (extra = {}) => ({
  openapi: '3.1.0',
  info: { title: 'Intake', version: '1.0.0' },
  paths: {},
  ...extra,
});

describe('validateExtensionPlacement', () => {
  test('a correctly placed extension is not reported', () => {
    assert.deepEqual(check(spec({ info: { title: 'I', 'x-status': 'deprecated' } })), []);
  });

  test('x-status at the document root is an error', () => {
    // The defect this exists for: it reads as correct, validates as legal
    // OpenAPI, and leaves the API live everywhere in the pipeline.
    const [finding, ...rest] = check(spec({ 'x-status': 'deprecated' }));

    assert.equal(rest.length, 0);
    assert.equal(finding.rule, 'extension-misplaced');
    assert.equal(finding.severity, 'error');
    assert.equal(finding.path, '/');
    assert.match(finding.message, /x-status/);
    assert.match(finding.message, /belongs at info or an operation/);
  });

  test('an undeclared extension is ignored wherever it appears', () => {
    // States invent their own; five such keys are already in use.
    assert.deepEqual(
      check(spec({ 'x-casing': 'camel', info: { title: 'I', 'x-search': true } })),
      []
    );
  });

  test('x-sortable belongs on an operation, not in info', () => {
    const [finding] = check(spec({ info: { title: 'I', 'x-sortable': { fields: ['id'] } } }));
    assert.equal(finding.rule, 'extension-misplaced');
    assert.equal(finding.path, 'info');
    assert.match(finding.message, /belongs at an operation/);
  });

  test('x-sortable on an operation is accepted', () => {
    assert.deepEqual(
      check(spec({ paths: { '/a': { get: { 'x-sortable': { fields: ['id'] } } } } })),
      []
    );
  });

  test('x-enum-source belongs on a schema property, not an operation', () => {
    const [finding] = check(spec({ paths: { '/a': { get: { 'x-enum-source': 'states[].id' } } } }));
    assert.equal(finding.path, '/a GET');
    assert.match(finding.message, /belongs at a schema property/);
  });

  test('x-enum-source on a schema property is accepted', () => {
    assert.deepEqual(
      check(spec({
        components: {
          schemas: { Application: { properties: { status: { 'x-enum-source': 'states[].id' } } } },
        },
      })),
      []
    );
  });

  test('finds a misplaced extension on a nested property', () => {
    const [finding] = check(spec({
      components: {
        schemas: {
          Application: {
            properties: {
              household: { properties: { members: { items: { properties: { id: { 'x-status': 'deprecated' } } } } } },
            },
          },
        },
      },
    }));
    assert.equal(finding.path, 'components/schemas/Application/household/members[]/id');
  });

  test('x-relationship is accepted in both places it is declared for', () => {
    assert.deepEqual(
      check(spec({
        paths: { '/a/{id}/submit': { post: { 'x-relationship': { type: 'state-machine-action' } } } },
        components: {
          schemas: { A: { properties: { caseId: { 'x-relationship': { resource: 'cases' } } } } },
        },
      })),
      []
    );
  });

  test('x-events belongs at the root, and is accepted there', () => {
    assert.deepEqual(check(spec({ 'x-events': [] })), []);
    const [finding] = check(spec({ info: { title: 'I', 'x-events': [] } }));
    assert.match(finding.message, /belongs at the document root/);
  });

  test('reports every misplacement, not just the first', () => {
    assert.equal(check(spec({ 'x-status': 'deprecated', 'x-visibility': 'internal' })).length, 2);
  });

  test('survives a spec with no info, paths or components', () => {
    assert.deepEqual(check({ openapi: '3.1.0' }), []);
    assert.deepEqual(check(null), []);
  });

  test('a circular schema does not hang the walk', () => {
    const schema = { properties: {} };
    schema.properties.self = schema;
    assert.deepEqual(check(spec({ components: { schemas: { Node: schema } } })), []);
  });
});
