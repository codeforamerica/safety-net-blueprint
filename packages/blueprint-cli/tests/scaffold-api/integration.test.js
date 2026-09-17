/**
 * Integration tests for the blueprint-scaffold-api CLI.
 *
 * Creates a new API spec from scratch in a temp directory and asserts the
 * output structure inline.
 *
 * For generic CLI behaviors (missing args, unknown flags), see cli-behavior.test.js.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/scaffold-api.js');

describe('scaffold-api', () => {
  let outDir;
  let result;
  let spec;

  before(() => {
    outDir = mkdtempSync(join(tmpdir(), 'snb-scaffold-api-'));
    result = spawnSync(
      process.execPath,
      [SCRIPT, '--name', 'notifications', '--resource', 'Notification', '--out', outDir],
      { encoding: 'utf8' },
    );
    if (result.status === 0) {
      spec = yaml.load(readFileSync(join(outDir, 'notifications-openapi.yaml'), 'utf8'));
    }
  });

  after(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('exits 0', () => {
    assert.equal(result.status, 0, `script failed:\n${result.stderr}`);
  });

  it('generates a valid OpenAPI 3.1 spec', () => {
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.info?.title, 'spec should have a title');
  });

  it('adds collection and item paths', () => {
    assert.ok('/notifications' in spec.paths, 'should have /notifications path');
    assert.ok('/notifications/{notificationId}' in spec.paths, 'should have /notifications/{notificationId} path');
  });

  it('collection path has GET and POST operations', () => {
    const collection = spec.paths['/notifications'];
    assert.ok(collection.get, 'collection path should have GET');
    assert.ok(collection.post, 'collection path should have POST');
  });

  it('item path has GET, PATCH, and DELETE operations', () => {
    const item = spec.paths['/notifications/{notificationId}'];
    assert.ok(item.get, 'item path should have GET');
    assert.ok(item.patch, 'item path should have PATCH');
    assert.ok(item.delete, 'item path should have DELETE');
  });

  it('adds Notification and related schemas', () => {
    assert.ok('Notification' in spec.components.schemas, 'should add Notification schema');
    assert.ok('NotificationCreate' in spec.components.schemas, 'should add NotificationCreate schema');
    assert.ok('NotificationList' in spec.components.schemas, 'should add NotificationList schema');
  });

  it('Notification schema has id, createdAt, updatedAt fields', () => {
    const notification = spec.components.schemas.Notification;
    assert.ok(notification.properties?.id, 'Notification should have id');
    assert.ok(notification.properties?.createdAt, 'Notification should have createdAt');
    assert.ok(notification.properties?.updatedAt, 'Notification should have updatedAt');
  });
});
