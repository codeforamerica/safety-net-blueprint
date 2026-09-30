/**
 * Unit tests for resolve/environment.js
 *
 * A node carrying `x-environments` survives only when the target environment
 * is listed, and the marker is stripped from whatever survives. Ported from
 * the CLI's filterByEnvironment tests, restated against the pass API.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { filterEnvironment } from '../../../src/resolve/environment.js';
import { doc, only } from '../../helpers/docs.js';

describe('filterEnvironment', () => {
  test('keeps a node matching the target environment', () => {
    const result = filterEnvironment([doc({
      paths: { '/users': { 'x-environments': ['production', 'staging'], get: { summary: 'List users' } } },
    })], 'production');

    assert.equal(only(result).paths['/users'].get.summary, 'List users');
  });

  test('removes a node that does not match', () => {
    const result = filterEnvironment([doc({
      paths: {
        '/debug': { 'x-environments': ['dev'], get: { summary: 'Debug endpoint' } },
        '/users': { get: { summary: 'List users' } },
      },
    })], 'production');

    assert.equal(only(result).paths['/debug'], undefined);
    assert.ok(only(result).paths['/users']);
  });

  test('strips x-environments from survivors', () => {
    // A resolved contract describes one environment; it should not still be
    // carrying the question of which.
    const result = filterEnvironment([doc({
      paths: { '/users': { 'x-environments': ['production'], get: { summary: 'List users' } } },
    })], 'production');

    assert.equal(only(result).paths['/users']['x-environments'], undefined);
    assert.equal(only(result).paths['/users'].get.summary, 'List users');
  });

  test('keeps a parent while removing a child with the wrong environment', () => {
    const result = filterEnvironment([doc({
      components: {
        schemas: {
          User: {
            properties: {
              name: { type: 'string' },
              debugInfo: { 'x-environments': ['dev'], type: 'object' },
            },
          },
        },
      },
    })], 'production');

    assert.ok(only(result).components.schemas.User.properties.name);
    assert.equal(only(result).components.schemas.User.properties.debugInfo, undefined);
  });

  test('keeps a node carrying no marker', () => {
    const result = filterEnvironment([doc({
      info: { title: 'Test API', version: '1.0.0' },
      paths: { '/users': { get: { summary: 'List users' } } },
    })], 'production');

    assert.equal(only(result).info.title, 'Test API');
    assert.ok(only(result).paths['/users']);
  });

  test('leaves primitive values unchanged', () => {
    const result = filterEnvironment([doc({
      info: { title: 'Test', version: '1.0.0' },
      count: 42,
      enabled: true,
    })], 'production');

    assert.equal(only(result).count, 42);
    assert.equal(only(result).enabled, true);
  });

  test('filters array items and strips the marker from survivors', () => {
    const result = filterEnvironment([doc({
      servers: [
        { url: 'https://api.example.com', 'x-environments': ['production'] },
        { url: 'https://dev.example.com', 'x-environments': ['dev'] },
        { url: 'https://common.example.com' },
      ],
    })], 'production');

    const servers = only(result).servers;
    assert.equal(servers.length, 2);
    assert.equal(servers[0].url, 'https://api.example.com');
    assert.equal(servers[1].url, 'https://common.example.com');
    assert.equal(servers[0]['x-environments'], undefined);
  });

  // ---------------------------------------------------------------------------
  // Pass contract
  // ---------------------------------------------------------------------------

  test('no target environment is a no-op that keeps the markers', () => {
    // Nothing has been decided yet, so the markers still carry information.
    const input = [doc({ paths: { '/debug': { 'x-environments': ['dev'] } } })];
    const result = filterEnvironment(input, null);

    assert.equal(result.docs, input);
    assert.deepEqual(only(result).paths['/debug']['x-environments'], ['dev']);
    assert.deepEqual(result.applied, []);
  });

  test('a document with nothing to filter is returned unchanged', () => {
    // Identity matters: the pass rebuilds every node it touches, so an
    // untouched document must come back as the same object.
    const input = [doc({ info: { title: 'Untouched' } })];
    const result = filterEnvironment(input, 'production');

    assert.equal(result.docs[0], input[0]);
    assert.deepEqual(result.applied, []);
  });

  test('reports which documents it touched', () => {
    const result = filterEnvironment([doc(
      { paths: { '/debug': { 'x-environments': ['dev'] } } },
      { relativePath: 'domains/intake/intake-openapi.yaml' }
    )], 'production');

    assert.equal(result.applied.length, 1);
    assert.match(result.applied[0], /domains\/intake\/intake-openapi\.yaml/);
  });
});
