/**
 * What a project built on the framework alone gets from the mock, end to end
 * through a booted server, with small synthetic contract sets of its own
 * (#534):
 *
 *   - a path is served under its server's base, even one that starts with the
 *     same word as the base
 *   - a state machine is matched to the resource core attaches it to, however
 *     its collection is spelled
 *   - two domains with a collection of the same name keep their own records
 *   - a call by method and path to another record's action runs as the
 *     system, and one that is refused fails the action calling it
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createMockServer } from '../../src/server.js';
import { createMemoryStore } from '../../src/stores/memory-store.js';

const ok = (schema, status = 200) => ({ [status]: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } });
const sends = (schema) => ({ requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } });

/**
 * An API document serving one resource: list, create, read and update, under
 * a server at `/{base}`.
 *
 * @param {{ domain: string, base?: string, path: string, name: string, param: string }} options
 */
function crudApi({ domain, base = domain, path, name, param }) {
  return {
    path: `/x/domains/${domain}/${domain}-${name.toLowerCase()}-openapi.yaml`,
    relativePath: `domains/${domain}/${domain}-${name.toLowerCase()}-openapi.yaml`,
    domain,
    type: 'openapi',
    provenance: null,
    content: {
      openapi: '3.1.0',
      info: { title: name, version: '1', 'x-domain': domain },
      servers: [{ url: `http://localhost:1080/${base}` }],
      paths: {
        [path]: { get: { operationId: `list${name}s`, responses: ok(`${name}List`) }, post: { operationId: `create${name}`, ...sends(`${name}Create`), responses: ok(name, 201) } },
        [`${path}/{${param}}`]: {
          parameters: [{ name: param, in: 'path', required: true, schema: { type: 'string' } }],
          get: { operationId: `get${name}`, responses: ok(name) },
          patch: { operationId: `update${name}`, ...sends(`${name}Update`), responses: ok(name) },
        },
      },
      components: {
        schemas: {
          [name]: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, status: { type: 'string' }, driverId: { type: 'string' }, stampedAt: { type: 'string' } } },
          [`${name}Create`]: { type: 'object', properties: { name: { type: 'string' }, driverId: { type: 'string' } } },
          [`${name}Update`]: { type: 'object', properties: { name: { type: 'string' } } },
          [`${name}List`]: { type: 'object', properties: { items: { type: 'array', items: { $ref: `#/components/schemas/${name}` } } } },
        },
      },
    },
  };
}

/** A state machine document for a domain. */
const machines = (domain, list) => ({
  path: `/x/domains/${domain}/${domain}-state-machine.yaml`,
  relativePath: `domains/${domain}/${domain}-state-machine.yaml`,
  domain,
  type: 'state-machine',
  provenance: null,
  content: { domain, machines: list },
});

/** Boot a mock over the documents, quietly, and send it requests; `send.store` is its store. */
async function boot(docs) {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  const store = createMemoryStore();
  let mock;
  try { mock = await createMockServer({ contracts: { artifactVersion: 1, docs }, store, seed: false }); } finally { console.log = log; console.warn = warn; }
  const send = async (method, path, body, roles = 'readwrite') => {
    const response = await mock.fetch(new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-caller-id': 'dispatcher-1', 'x-caller-roles': roles },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  send.store = store;
  return send;
}

describe('a path is under its server\'s base', () => {
  // OpenAPI paths are relative to the server URL: `/orders` in an API served
  // at /orders is /orders/orders, and `/menu-items` at /menu is /menu/menu-items.
  test('a path that starts with the same word as the base is still under it', async () => {
    const send = await boot([
      crudApi({ domain: 'orders', path: '/orders', name: 'Order', param: 'orderId' }),
      crudApi({ domain: 'menu', path: '/menu-items', name: 'MenuItem', param: 'menuItemId' }),
      machines('orders', [{
        object: 'Order',
        initialState: 'placed',
        states: [{ id: 'placed' }, { id: 'accepted' }],
        actions: [{ id: 'accept', transition: { from: 'placed', to: 'accepted' }, guards: [{ actors: ['readwrite'] }] }],
      }]),
    ]);

    const order = await send('POST', '/orders/orders', { name: 'o1' });
    assert.strictEqual(order.status, 201, JSON.stringify(order.body));
    assert.strictEqual(order.body.status, 'placed');
    assert.strictEqual((await send('GET', `/orders/orders/${order.body.id}`)).status, 200);
    const accepted = await send('POST', `/orders/orders/${order.body.id}/accept`, {});
    assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.body));
    assert.strictEqual(accepted.body.status, 'accepted');

    const item = await send('POST', '/menu/menu-items', { name: 'soup' });
    assert.strictEqual(item.status, 201, JSON.stringify(item.body));
    assert.strictEqual((await send('GET', '/menu/menu-items')).body.items.length, 1);
    assert.strictEqual((await send('GET', '/menu-items')).status, 404);
  });
});

describe('a state machine governs the resource core attaches it to', () => {
  // A Delivery at /deliveries, as the scaffold names it: no "s" added to the
  // object's name finds that collection.
  test('a create starts in the machine\'s initial state, and its actions run', async () => {
    const send = await boot([
      crudApi({ domain: 'dispatch', path: '/deliveries', name: 'Delivery', param: 'deliveryId' }),
      machines('dispatch', [{
        object: 'Delivery',
        initialState: 'offered',
        states: [{ id: 'offered' }, { id: 'assigned' }],
        actions: [{ id: 'claim', transition: { from: 'offered', to: 'assigned' }, guards: [{ actors: ['readwrite'] }] }],
      }]),
    ]);

    const delivery = await send('POST', '/dispatch/deliveries', { name: 'd1' });
    assert.strictEqual(delivery.body.status, 'offered');
    const claimed = await send('POST', `/dispatch/deliveries/${delivery.body.id}/claim`, {});
    assert.strictEqual(claimed.status, 200, JSON.stringify(claimed.body));
    assert.strictEqual(claimed.body.status, 'assigned');
  });
});

describe('records are kept by domain', () => {
  test('two domains with a collection of the same name keep their own records', async () => {
    const send = await boot([
      crudApi({ domain: 'ordering', path: '/settings', name: 'Setting', param: 'settingId' }),
      crudApi({ domain: 'dispatch', path: '/settings', name: 'Setting', param: 'settingId' }),
    ]);

    const ordering = await send('POST', '/ordering/settings', { name: 'ordering setting' });
    assert.strictEqual(ordering.status, 201);
    assert.deepStrictEqual((await send('GET', '/dispatch/settings')).body.items, []);
    assert.strictEqual((await send('GET', `/dispatch/settings/${ordering.body.id}`)).status, 404);
    assert.strictEqual((await send('PATCH', `/dispatch/settings/${ordering.body.id}`, { name: 'changed through dispatch' })).status, 404);
    assert.strictEqual((await send('GET', `/ordering/settings/${ordering.body.id}`)).body.name, 'ordering setting');
  });
});

describe('a call by path to another record\'s action', () => {
  // A dispatcher claims a job, which makes its driver busy. Only the system
  // moves a driver, so `take` names no role a dispatcher has.
  const fleet = () => boot([
    crudApi({ domain: 'fleet', path: '/jobs', name: 'Job', param: 'jobId' }),
    crudApi({ domain: 'fleet', path: '/drivers', name: 'Driver', param: 'driverId' }),
    machines('fleet', [
      {
        object: 'Job',
        initialState: 'open',
        states: [{ id: 'open' }, { id: 'claimed' }],
        actions: [{
          id: 'claim',
          transition: { from: 'open', to: 'claimed' },
          guards: [{ actors: ['readwrite'] }],
          steps: [{ call: { POST: 'fleet/drivers/$object.driverId/take' } }],
        }, {
          // Takes the driver twice, and the second is refused: she's busy by then.
          id: 'claim-twice',
          transition: { from: 'open', to: 'claimed' },
          guards: [{ actors: ['readwrite'] }],
          steps: [{ call: { POST: 'fleet/drivers/$object.driverId/take' } }, { call: { POST: 'fleet/drivers/$object.driverId/take' } }],
        }],
      },
      {
        object: 'Driver',
        initialState: 'free',
        states: [{ id: 'free' }, { id: 'busy' }],
        actions: [
          { id: 'take', transition: { from: 'free', to: 'busy' }, guards: [{ actors: ['system'] }], steps: [{ set: { field: 'stampedAt', value: '$now' } }] },
          { id: 'go-busy', transition: { from: 'free', to: 'busy' }, guards: [{ actors: ['readwrite'] }] },
          {
            // Refuses a driver with no name, after stamping her, to show the stamp isn't kept.
            id: 'sign-on', transition: { from: 'free', to: 'busy' }, guards: [{ actors: ['readwrite'] }],
            steps: [
              { set: { field: 'stampedAt', value: '$now' } },
              { if: '!has(object.licence)', then: [{ fail: { status: 422, code: 'VALIDATION_ERROR', message: 'A driver signs on with a licence.' } }] },
            ],
          },
        ],
      },
    ]),
  ]);

  test('runs as the system: role matching is skipped', async () => {
    const send = await fleet();
    const driver = (await send('POST', '/fleet/drivers', { name: 'Ana' })).body;
    const job = (await send('POST', '/fleet/jobs', { name: 'job A', driverId: driver.id })).body;

    const claimed = await send('POST', `/fleet/jobs/${job.id}/claim`, {});
    assert.strictEqual(claimed.status, 200, JSON.stringify(claimed.body));
    assert.strictEqual(claimed.body.status, 'claimed');
    assert.strictEqual((await send('GET', `/fleet/drivers/${driver.id}`)).body.status, 'busy');
  });

  test('a refusal fails the action with the refusal\'s status, and nothing is saved', async () => {
    const send = await fleet();
    const driver = (await send('POST', '/fleet/drivers', { name: 'Ben' })).body;
    await send('POST', `/fleet/drivers/${driver.id}/go-busy`, {});
    const job = (await send('POST', '/fleet/jobs', { name: 'job B', driverId: driver.id })).body;

    // `take` is from free, and Ben is busy.
    const claimed = await send('POST', `/fleet/jobs/${job.id}/claim`, {});
    assert.strictEqual(claimed.status, 409, JSON.stringify(claimed.body));
    assert.match(claimed.body.message, /Can't take this driver/);
    const after = (await send('GET', `/fleet/jobs/${job.id}`)).body;
    assert.strictEqual(after.status, 'open');
    assert.strictEqual(after.updatedAt, job.updatedAt, 'the job is as it was');
  });

  test('a fail step answers with its error, and nothing the action did is saved', async () => {
    const send = await fleet();
    const driver = (await send('POST', '/fleet/drivers', { name: 'Cy' })).body;
    const signedOn = await send('POST', `/fleet/drivers/${driver.id}/sign-on`, {});
    assert.strictEqual(signedOn.status, 422, JSON.stringify(signedOn.body));
    assert.deepStrictEqual({ code: signedOn.body.code, message: signedOn.body.message }, { code: 'VALIDATION_ERROR', message: 'A driver signs on with a licence.' });
    const after = (await send('GET', `/fleet/drivers/${driver.id}`)).body;
    assert.strictEqual(after.status, 'free');
    assert.strictEqual(after.stampedAt, undefined, 'the stamp before the fail is not kept');
  });

  test('a later call\'s refusal undoes the calls before it in the domain, and sends none of their events', async () => {
    const send = await fleet();
    const driver = (await send('POST', '/fleet/drivers', { name: 'Ana' })).body;
    const job = (await send('POST', '/fleet/jobs', { name: 'job C', driverId: driver.id })).body;
    const events = () => send.store.findAll('platform/events', {}, { limit: null }).items.length;
    const eventsBefore = events();

    const claimed = await send('POST', `/fleet/jobs/${job.id}/claim-twice`, {});
    assert.strictEqual(claimed.status, 409, JSON.stringify(claimed.body));
    assert.strictEqual((await send('GET', `/fleet/jobs/${job.id}`)).body.status, 'open');
    const after = (await send('GET', `/fleet/drivers/${driver.id}`)).body;
    assert.strictEqual(after.status, 'free', 'the first take is undone');
    assert.strictEqual(after.updatedAt, driver.updatedAt, 'the driver is as she was');
    assert.strictEqual(events(), eventsBefore, 'no event from the first take');
  });
});
