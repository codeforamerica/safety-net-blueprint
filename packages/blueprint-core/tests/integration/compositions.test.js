/**
 * Integration tests for the composition resolver using fixture data.
 * Unit tests for the resolver itself are in blueprint-core/tests/unit/compositions-resolver.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import {
  discoverCompositions,
  buildResourceSchemaIndex,
  validateBindFields,
} from '@codeforamerica/blueprint-core/compositions';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createTempDir() {
  const dir = join(__dirname, `tmp-compositions-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

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

test('compositions resolver integration with fixture data', async (t) => {
  let tmpDir;

  await t.test('discoverCompositions finds fixture compositions file', () => {
    tmpDir = createTempDir();
    writeFileSync(join(tmpDir, 'widgets-compositions.yaml'), yaml.dump(FIXTURE_COMPOSITIONS));

    const compositions = discoverCompositions(tmpDir);
    const widgets = compositions.find(c => c.domain === 'widgets');
    assert.ok(widgets, 'should discover widgets-compositions.yaml');
    assert.ok(widgets.doc.compositions.partSummary, 'should have partSummary composition');
  });

  await t.test('validateBindFields finds no errors against fixture spec', () => {
    if (!tmpDir) tmpDir = createTempDir();
    writeFileSync(join(tmpDir, 'widgets-compositions.yaml'), yaml.dump(FIXTURE_COMPOSITIONS));
    writeFileSync(join(tmpDir, 'widgets-openapi.yaml'), yaml.dump(FIXTURE_OPENAPI));

    const compositions = discoverCompositions(tmpDir);
    const widgets = compositions.find(c => c.domain === 'widgets');
    assert.ok(widgets, 'fixture compositions must be discoverable');

    const specPath = join(tmpDir, 'widgets-openapi.yaml');
    const yamlFiles = [
      { relativePath: 'widgets-openapi.yaml', filePath: specPath, spec: FIXTURE_OPENAPI },
    ];

    const index = buildResourceSchemaIndex(yamlFiles);
    const errors = validateBindFields(widgets, index);

    if (errors.length > 0) {
      for (const e of errors) {
        console.error(`  Bind error: ${e.message} at ${e.path}`);
      }
    }
    assert.equal(errors.length, 0, 'no bind validation errors expected for fixture compositions');

    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });
});
