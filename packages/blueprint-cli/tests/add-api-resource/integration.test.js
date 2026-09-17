/**
 * Integration tests for the blueprint-add-api-resource CLI.
 *
 * Writes a minimal OpenAPI spec to a temp directory, runs add-api-resource to
 * inject a new resource, then asserts the output structure inline.
 *
 * For generic CLI behaviors (missing args, unknown flags), see cli-behavior.test.js.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/add-api-resource.js');

const MINIMAL_SPEC = `\
openapi: "3.1.0"
info:
  title: Test API
  version: "0.1.0"
  x-domain: test
paths: {}
components:
  schemas: {}
  parameters: {}
  responses: {}
`;

describe('add-api-resource', () => {
  let workDir;
  let result;
  let spec;

  before(() => {
    workDir = mkdtempSync(join(tmpdir(), 'snb-add-api-resource-'));
    writeFileSync(join(workDir, 'test-openapi.yaml'), MINIMAL_SPEC);
    result = spawnSync(
      process.execPath,
      [SCRIPT, '--name', 'test', '--resource', 'Widget', '--out', workDir],
      { encoding: 'utf8' },
    );
    if (result.status === 0) {
      spec = yaml.load(readFileSync(join(workDir, 'test-openapi.yaml'), 'utf8'));
    }
  });

  after(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('exits 0', () => {
    assert.equal(result.status, 0, `script failed:\n${result.stderr}`);
  });

  it('adds collection and item paths', () => {
    assert.ok('/widgets' in spec.paths, 'should add /widgets path');
    assert.ok('/widgets/{widgetId}' in spec.paths, 'should add /widgets/{widgetId} path');
  });

  it('collection path has GET and POST operations', () => {
    const collection = spec.paths['/widgets'];
    assert.ok(collection.get, 'collection path should have GET');
    assert.ok(collection.post, 'collection path should have POST');
  });

  it('item path has GET, PATCH, and DELETE operations', () => {
    const item = spec.paths['/widgets/{widgetId}'];
    assert.ok(item.get, 'item path should have GET');
    assert.ok(item.patch, 'item path should have PATCH');
    assert.ok(item.delete, 'item path should have DELETE');
  });

  it('adds Widget, WidgetCreate, WidgetUpdate, and WidgetList schemas', () => {
    assert.ok('Widget' in spec.components.schemas, 'should add Widget schema');
    assert.ok('WidgetCreate' in spec.components.schemas, 'should add WidgetCreate schema');
    assert.ok('WidgetUpdate' in spec.components.schemas, 'should add WidgetUpdate schema');
    assert.ok('WidgetList' in spec.components.schemas, 'should add WidgetList schema');
  });

  it('Widget schema has id, createdAt, updatedAt fields', () => {
    const widget = spec.components.schemas.Widget;
    assert.ok(widget.properties?.id, 'Widget should have id');
    assert.ok(widget.properties?.createdAt, 'Widget should have createdAt');
    assert.ok(widget.properties?.updatedAt, 'Widget should have updatedAt');
  });
});
