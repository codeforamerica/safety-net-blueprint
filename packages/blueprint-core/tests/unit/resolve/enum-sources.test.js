/**
 * Unit tests for resolve/enum-sources.js
 *
 * A schema field declares that its permitted values come from a behavioral
 * contract rather than repeating them. Ported from the CLI's parseEnumSource,
 * findEnumSources, buildEnumSourceIndex and applyEnumSourceInjections tests,
 * restated against the pass API — the index and the scan are internal to it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { injectEnumSources } from '../../../src/resolve/enum-sources.js';
import { doc } from '../../helpers/docs.js';

const slaTypes = (entries) => doc(
  { slaTypes: entries },
  { relativePath: 'domains/intake/intake-sla-types.yaml', type: 'sla-types' }
);

const stateMachine = (content) => doc(
  content,
  { relativePath: 'domains/intake/intake-state-machine.yaml', type: 'state-machine' }
);

const spec = (content) => doc(
  content,
  { relativePath: 'domains/intake/intake-openapi.yaml', type: 'openapi' }
);

/** The annotated field, after the pass. */
const field = (result) =>
  result.docs.find((d) => d.type === 'openapi').content.components.schemas.Application.properties.status;

const specWith = (annotation) => spec({
  openapi: '3.1.0',
  components: { schemas: { Application: { properties: { status: { type: 'string', 'x-enum-source': annotation } } } } },
});

describe('injectEnumSources', () => {
  test('injects sla type ids and removes the annotation', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }, { id: 'medicaid_standard' }]),
      specWith('slaTypes[].id'),
    ]);

    assert.deepEqual(field(result).enum, ['snap_standard', 'medicaid_standard']);
    assert.equal('x-enum-source' in field(result), false);
    assert.equal(field(result).type, 'string');
  });

  test('injects state ids from the machines[] form', () => {
    const result = injectEnumSources([
      stateMachine({ machines: [{ object: 'Application', states: [{ id: 'draft' }, { id: 'submitted' }] }] }),
      specWith('states[].id'),
    ]);

    assert.deepEqual(field(result).enum, ['draft', 'submitted']);
  });

  test('injects state ids from the top-level states form', () => {
    // Some machines declare states at the document level rather than under a
    // machine; both feed the flat `states` key.
    const result = injectEnumSources([
      stateMachine({ states: [{ id: 'open' }, { id: 'closed' }] }),
      specWith('states[].id'),
    ]);

    assert.deepEqual(field(result).enum, ['open', 'closed']);
  });

  test('the string form takes every machine\'s states', () => {
    const result = injectEnumSources([
      stateMachine({
        machines: [
          { object: 'Application', states: [{ id: 'draft' }] },
          { object: 'Member', states: [{ id: 'active' }] },
        ],
      }),
      specWith('states[].id'),
    ]);

    assert.deepEqual(field(result).enum, ['draft', 'active']);
  });

  test('the object form scopes to one machine', () => {
    const result = injectEnumSources([
      stateMachine({
        machines: [
          { object: 'Application', states: [{ id: 'draft' }, { id: 'submitted' }] },
          { object: 'Member', states: [{ id: 'active' }] },
        ],
      }),
      specWith({ source: 'states[].id', machine: 'Member' }),
    ]);

    assert.deepEqual(field(result).enum, ['active']);
  });

  test('reaches an annotation nested inside allOf', () => {
    // Composed schemas put them here, which a top-level-only scan would miss.
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }]),
      spec({
        components: {
          schemas: {
            Application: {
              allOf: [
                { $ref: '#/components/schemas/ApplicationWritable' },
                { properties: { slaTypeCode: { 'x-enum-source': 'slaTypes[].id' } } },
              ],
            },
          },
        },
      }),
    ]);

    const composed = result.docs.find((d) => d.type === 'openapi').content
      .components.schemas.Application.allOf[1].properties.slaTypeCode;
    assert.deepEqual(composed.enum, ['snap_standard']);
  });

  // ---------------------------------------------------------------------------
  // Annotations that cannot be resolved
  //
  // Each leaves the annotation in place rather than writing an empty enum — an
  // empty enum permits nothing and fails far from the cause.
  // ---------------------------------------------------------------------------

  test('warns and keeps the annotation when the machine name is unknown', () => {
    const result = injectEnumSources([
      stateMachine({ machines: [{ object: 'Application', states: [{ id: 'draft' }] }] }),
      specWith({ source: 'states[].id', machine: 'Nonexistent' }),
    ]);

    assert.equal(field(result).enum, undefined);
    assert.ok('x-enum-source' in field(result));
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /machine: Nonexistent/);
  });

  test('warns and keeps the annotation when the collection has no values', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }]),
      specWith('states[].id'),
    ]);

    assert.equal(field(result).enum, undefined);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /no values found for "states"/);
  });

  test('warns on invalid source syntax', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }]),
      specWith('not valid syntax'),
    ]);

    assert.equal(field(result).enum, undefined);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /invalid syntax/);
  });

  test('warns when the object form gives no source', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }]),
      specWith({ machine: 'Application' }),
    ]);

    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /no source given/);
  });

  test('names the document a warning came from', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }]),
      specWith('states[].id'),
    ]);

    assert.match(result.warnings[0], /intake-openapi\.yaml/);
  });

  // ---------------------------------------------------------------------------
  // Pass contract
  // ---------------------------------------------------------------------------

  test('no source contracts in the set is a no-op', () => {
    const input = [specWith('slaTypes[].id')];
    const result = injectEnumSources(input);

    assert.equal(result.docs, input);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.warnings, []);
  });

  test('a document with no annotations is returned unchanged', () => {
    const untouched = spec({ openapi: '3.1.0', paths: {} });
    const result = injectEnumSources([slaTypes([{ id: 'snap_standard' }]), untouched]);

    assert.equal(result.docs[1], untouched);
    assert.deepEqual(result.applied, []);
  });

  test('reports how many enums it injected, per document', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }]),
      spec({
        components: {
          schemas: {
            Application: { properties: { status: { 'x-enum-source': 'slaTypes[].id' } } },
            Member: { properties: { status: { 'x-enum-source': 'slaTypes[].id' } } },
          },
        },
      }),
    ]);

    assert.equal(result.applied.length, 1);
    assert.match(result.applied[0], /Injected 2 enum\(s\).*intake-openapi\.yaml/);
  });

  test('entries without an id are skipped', () => {
    const result = injectEnumSources([
      slaTypes([{ id: 'snap_standard' }, { name: 'no id here' }, { id: 'medicaid_standard' }]),
      specWith('slaTypes[].id'),
    ]);

    assert.deepEqual(field(result).enum, ['snap_standard', 'medicaid_standard']);
  });
});
