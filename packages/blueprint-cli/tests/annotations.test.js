/**
 * Tests for loadAnnotations and loadPolicies against fixture data.
 * Unit tests for the functions themselves are in blueprint-core/tests/unit/annotations.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadAnnotations } from '@codeforamerica/blueprint-core/annotations';
import { loadPolicies } from '@codeforamerica/blueprint-core/policies';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

test('loadAnnotations with fixture data', async (t) => {
  await t.test('loads schema, operations, and events from fixture annotations', () => {
    const result = loadAnnotations('widgets', join(fixturesDir, 'widgets'));
    assert.ok(Object.keys(result.schema).length > 0, 'schema should have entries');
    assert.ok(Object.keys(result.operations).length > 0, 'operations should have entries');
    assert.ok(Object.keys(result.events).length > 0, 'events should have entries');
    assert.ok(result.schema['widgets.name'], 'should include widgets.name annotation');
    assert.ok(result.schema['widgets.name'].reason, 'annotation should have reason field');
  });
});

test('loadPolicies with fixture data', async (t) => {
  await t.test('loads policies from fixture policies file', () => {
    const result = loadPolicies(join(fixturesDir, 'platform'));
    assert.ok(Object.keys(result).length > 0, 'should have policies');
    assert.ok(result['widget-processing-clock'], 'should include widget-processing-clock');
    assert.ok(result['widget-processing-clock'].citation, 'policy should have citation');
    assert.ok(result['widget-processing-clock'].description, 'policy should have description');
  });
});
