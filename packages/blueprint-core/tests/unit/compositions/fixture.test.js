/**
 * Integration tests for the composition resolver using fixture data.
 * Unit tests for the resolver itself are in blueprint-core/tests/unit/compositions-resolver.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResourceSchemaIndex,
  validateBindFields,
} from '../../../src/compositions.js';

// Fixture: a minimal compositions file for the widgets domain
const FIXTURE_COMPOSITIONS = {
  $schema: 'https://blueprint.codeforamerica.org/schemas/compositions-schema.yaml',
  version: '1.0',
  domain: 'widgets',
  compositions: {
    partSummary: {
      resource: 'widget-parts',
      bind: 'widgetId',
      endpoint: { path: '/widgets/{widgetId}/part-summary' },
    },
  },
};

// Fixture: a minimal OpenAPI spec with the schemas needed for bind validation
const FIXTURE_OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Widgets API', version: '1.0.0' },
  paths: {
    '/widgets': { get: { operationId: 'listWidgets', responses: {} } },
    '/widgets/{widgetId}': { get: { operationId: 'getWidget', responses: {} } },
    '/widgets/{widgetId}/parts': { get: { operationId: 'listWidgetParts', responses: {} } },
    '/widgets/{widgetId}/parts/{partId}': { get: { operationId: 'getWidgetPart', responses: {} } },
  },
  components: {
    schemas: {
      Widget: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
        },
      },
      WidgetPart: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          widgetId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
        },
      },
    },
  },
};

// One entry per compositions document, the shape `discover`/`load` produce.
const widgets = {
  filePath: 'widgets-compositions.yaml',
  domain: 'widgets',
  doc: FIXTURE_COMPOSITIONS,
};

test('compositions resolver integration with fixture data', async (t) => {

  await t.test('the fixture declares the composition under test', () => {
    assert.ok(widgets.doc.compositions.partSummary, 'should have partSummary composition');
  });

  await t.test('validateBindFields finds no errors against fixture spec', () => {
    const yamlFiles = [
      { relativePath: 'widgets-openapi.yaml', spec: FIXTURE_OPENAPI },
    ];

    const index = buildResourceSchemaIndex(yamlFiles);
    const errors = validateBindFields(widgets, index);

    if (errors.length > 0) {
      for (const e of errors) {
        console.error(`  Bind error: ${e.message} at ${e.path}`);
      }
    }
    assert.equal(errors.length, 0, 'no bind validation errors expected for fixture compositions');
  });
});
