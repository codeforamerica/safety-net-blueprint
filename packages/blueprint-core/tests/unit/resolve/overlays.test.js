/**
 * Unit tests for resolve/overlays.js
 *
 * The dispatcher: works out which documents each action targets and applies
 * the action to each. Applying one action to one document is the Overlay
 * Specification implementation in overlay/overlay-resolver.js, tested there.
 *
 * Ported from the CLI's applyOverlayWithTargets tests.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyOverlays } from '../../../src/resolve/overlays.js';
import { doc } from '../../helpers/docs.js';

const apiSpec = (relativePath, paths = { '/items': { get: {} } }) => doc(
  { openapi: '3.1.0', info: { title: 'Test', version: '1.0.0' }, paths },
  { relativePath, type: 'openapi' }
);

const stateMachine = (relativePath, content) => doc(
  { $schema: 'state-machine-schema.yaml', ...content },
  { relativePath, type: 'state-machine' }
);

describe('applyOverlays', () => {
  test('applies an action to the document it targets', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');

    const result = applyOverlays([intake], [{
      info: { title: 'Test Overlay', version: '1.0.0' },
      actions: [{ target: '$.info', update: { 'x-owner': 'state-team' } }],
    }]);

    assert.equal(result.docs[0].content.info['x-owner'], 'state-team');
    assert.equal(result.warnings.length, 0);
    assert.equal(result.applied.length, 1);
  });

  test('leaves documents the action does not target untouched', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');
    const eligibility = apiSpec('domains/eligibility/eligibility-openapi.yaml');

    const result = applyOverlays([intake, eligibility], [{
      actions: [{
        target: '$.info',
        file: 'domains/intake/intake-openapi.yaml',
        update: { 'x-owner': 'state-team' },
      }],
    }]);

    assert.equal(result.docs[0].content.info['x-owner'], 'state-team');
    assert.equal(result.docs[1], eligibility);
  });

  test('applies overlays in order, so a later one wins', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');

    const result = applyOverlays([intake], [
      { actions: [{ target: '$.info', update: { 'x-owner': 'first' } }] },
      { actions: [{ target: '$.info', update: { 'x-owner': 'second' } }] },
    ]);

    assert.equal(result.docs[0].content.info['x-owner'], 'second');
    assert.equal(result.applied.length, 2);
  });

  test('an action targeting nothing applies nowhere and warns', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');

    const result = applyOverlays([intake], [{ actions: [{ target: '$.webhooks', update: {} }] }]);

    assert.equal(result.docs[0], intake);
    assert.equal(result.warnings.length, 1);
    assert.deepEqual(result.applied, []);
  });

  // ---------------------------------------------------------------------------
  // Authored content
  //
  // A state machine or rules document is authored by the blueprint and
  // extended by a state. `update:` with an array replaces the whole list, so
  // the baseline entries vanish — almost never what was meant.
  // ---------------------------------------------------------------------------

  test('warns when update: replaces an array on an authored document', () => {
    const machine = stateMachine('domains/test/test-state-machine.yaml', {
      domain: 'test',
      states: [{ id: 'draft' }, { id: 'published' }],
    });

    const result = applyOverlays([machine], [{
      actions: [{ target: '$.states', description: 'Replace states', update: [{ id: 'active' }] }],
    }]);

    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /"update:"/);
    assert.match(result.warnings[0], /append:/);
  });

  test('does not warn when update: sets an object on an authored document', () => {
    const machine = stateMachine('domains/test/test-state-machine.yaml', {
      domain: 'test',
      context: { owner: 'baseline' },
    });

    const result = applyOverlays([machine], [{
      actions: [{ target: '$.context', update: { owner: 'state' } }],
    }]);

    assert.deepEqual(result.warnings, []);
  });

  test('does not warn about an array update on a standards-defined document', () => {
    // OpenAPI is not blueprint-authored, so there is no baseline to lose.
    const spec = apiSpec('domains/intake/intake-openapi.yaml', { '/items': { get: {} } });

    const result = applyOverlays([spec], [{
      actions: [{ target: '$.servers', add: [{ url: 'https://api.example.com' }] }],
    }]);

    assert.deepEqual(result.warnings.filter((w) => w.includes('"update:"')), []);
  });

  // ---------------------------------------------------------------------------
  // Pass contract
  // ---------------------------------------------------------------------------

  test('no overlays is a no-op', () => {
    const input = [apiSpec('domains/intake/intake-openapi.yaml')];
    const result = applyOverlays(input, []);

    assert.equal(result.docs, input);
    assert.deepEqual(result.applied, []);
  });

  test('an overlay carrying only config: contributes no actions', () => {
    // Configuration is read separately by resolve; there is nothing to apply.
    const input = [apiSpec('domains/intake/intake-openapi.yaml')];
    const result = applyOverlays(input, [{ overlay: '1.0.0', config: { 'x-casing': 'snake_case' } }]);

    assert.equal(result.docs, input);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.warnings, []);
  });

  test('reports each application with its target document', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');

    const result = applyOverlays([intake], [{
      actions: [{ target: '$.info', description: 'Tag the owner', update: { 'x-owner': 'state-team' } }],
    }]);

    assert.equal(result.applied.length, 1);
    assert.match(result.applied[0], /Tag the owner -> domains\/intake\/intake-openapi\.yaml/);
  });
});
