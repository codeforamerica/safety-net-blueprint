/**
 * Unit tests for the route table (#448 step 2).
 *
 * The two behaviors worth pinning are the ones that would regress routing
 * silently: literal segments beating parameters, and first registration
 * winning a collision.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  routeKey, templateOf, addRoute, matchPath, matchRoute, createDispatcher,
} from '../../src/http/route-table.js';

const ok = () => Response.json({ ok: true });

test('Route table', async (t) => {

  await t.test('templateOf converts Express params to OpenAPI syntax', () => {
    assert.strictEqual(templateOf('/applications/:applicationId'), '/applications/{applicationId}');
    assert.strictEqual(templateOf('/a/:x/b/:y'), '/a/{x}/b/{y}');
    assert.strictEqual(templateOf('/applications/{applicationId}'), '/applications/{applicationId}');
    assert.strictEqual(templateOf('/health'), '/health');
  });

  await t.test('routeKey upper-cases the method', () => {
    assert.strictEqual(routeKey('get', '/x'), 'GET /x');
  });

  await t.test('matchPath captures params and rejects a length mismatch', () => {
    assert.deepStrictEqual(matchPath('/a/{id}', '/a/123'), { id: '123' });
    assert.deepStrictEqual(matchPath('/a/{id}/b', '/a/123/b'), { id: '123' });
    assert.deepStrictEqual(matchPath('/a', '/a'), {});
    assert.strictEqual(matchPath('/a/{id}', '/a'), null);
    assert.strictEqual(matchPath('/a/{id}', '/a/1/2'), null);
    assert.strictEqual(matchPath('/a/{id}', '/b/1'), null);
  });

  await t.test('matchPath rejects dot segments as parameter values', () => {
    // Express 404s these; capturing '..' as a resource id would hand a
    // traversal-shaped string to the store. Found by diffing against URLPattern.
    assert.strictEqual(matchPath('/a/{id}', '/a/.'), null);
    assert.strictEqual(matchPath('/a/{id}', '/a/..'), null);
  });

  await t.test('matchPath ignores a trailing slash, as Express does', () => {
    assert.deepStrictEqual(matchPath('/a/{id}', '/a/1/'), { id: '1' });
    assert.deepStrictEqual(matchPath('/a', '/a/'), {});
  });

  await t.test('matchPath decodes a percent-encoded segment', () => {
    assert.deepStrictEqual(matchPath('/a/{id}', '/a/x%20y'), { id: 'x y' });
  });

  await t.test('the first matching route wins, as under Express', () => {
    // Callers depend on this in both directions: composition panels are
    // registered before the generated literal routes so the panel serves them,
    // and the SSE stream before the item routes so `{id}` cannot capture it.
    const routes = new Map();
    addRoute(routes, 'GET', '/users/me', ok, { operationId: 'getCurrentUser' });
    addRoute(routes, 'GET', '/users/:userId', ok, { operationId: 'getUser' });

    assert.strictEqual(matchRoute(routes, 'GET', '/users/me').entry.operationId, 'getCurrentUser');
    assert.strictEqual(matchRoute(routes, 'GET', '/users/abc').entry.operationId, 'getUser');
  });

  await t.test('a parameter registered first captures a later literal', () => {
    // The flip side, and the reason registration order is load-bearing: this is
    // exactly what sends `/review/identity` to the composition panel.
    const routes = new Map();
    addRoute(routes, 'GET', '/review/:section', ok, { operationId: 'panel' });
    addRoute(routes, 'GET', '/review/identity', ok, { operationId: 'generated' });

    assert.strictEqual(matchRoute(routes, 'GET', '/review/identity').entry.operationId, 'panel');
  });

  await t.test('addRoute keeps the first registration for a key', () => {
    // Composition routes register before the standard ones so they win the
    // paths they share — cli/server.js registers them in that order on purpose.
    const routes = new Map();
    assert.strictEqual(addRoute(routes, 'GET', '/a/:id', ok, { operationId: 'composition' }), true);
    assert.strictEqual(addRoute(routes, 'GET', '/a/:id', ok, { operationId: 'standard' }), false);
    assert.strictEqual(routes.get('GET /a/{id}').operationId, 'composition');
    assert.strictEqual(routes.size, 1);
  });

  await t.test('addRoute treats :param and {param} as the same key', () => {
    const routes = new Map();
    addRoute(routes, 'GET', '/a/:id', ok);
    assert.strictEqual(addRoute(routes, 'GET', '/a/{id}', ok), false);
  });

  await t.test('method is part of the key', () => {
    const routes = new Map();
    addRoute(routes, 'GET', '/a', ok, { operationId: 'read' });
    addRoute(routes, 'POST', '/a', ok, { operationId: 'write' });
    assert.strictEqual(routes.size, 2);
    assert.strictEqual(matchRoute(routes, 'POST', '/a').entry.operationId, 'write');
    assert.strictEqual(matchRoute(routes, 'DELETE', '/a'), null);
  });

  await t.test('dispatcher passes matched params to the handler', async () => {
    const routes = new Map();
    addRoute(routes, 'GET', '/a/:id', (request, { params }) => Response.json(params));
    const response = await createDispatcher(routes)(new Request('http://x/a/42'));
    assert.deepStrictEqual(await response.json(), { id: '42' });
  });

  await t.test('dispatcher returns 404 when nothing matches', async () => {
    const response = await createDispatcher(new Map())(new Request('http://x/nope'));
    assert.strictEqual(response.status, 404);
    assert.strictEqual((await response.json()).code, 'NOT_FOUND');
  });

  await t.test('dispatcher turns a thrown handler into a 500', async () => {
    const routes = new Map();
    addRoute(routes, 'GET', '/boom', () => { throw new Error('kaboom'); });
    const response = await createDispatcher(routes)(new Request('http://x/boom'));
    assert.strictEqual(response.status, 500);
    const body = await response.json();
    assert.strictEqual(body.code, 'INTERNAL_ERROR');
    assert.strictEqual(body.details[0].message, 'kaboom');
  });

  await t.test('dispatcher ignores the query string when matching', async () => {
    const routes = new Map();
    addRoute(routes, 'GET', '/a', ok);
    const response = await createDispatcher(routes)(new Request('http://x/a?limit=5'));
    assert.strictEqual(response.status, 200);
  });
});
