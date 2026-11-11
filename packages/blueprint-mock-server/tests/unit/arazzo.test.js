/**
 * The Arazzo runner: the subset it runs, and what it refuses by name rather
 * than skipping, so a scenario never passes by not being checked.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { runScenario } from '../../src/arazzo.js';

const operations = new Map([
  ['createThing', { method: 'POST', path: '/demo/things' }],
  ['getThing', { method: 'GET', path: '/demo/things/{thingId}' }],
]);

/** A fetch that records requests and answers from a table. */
function fakeFetch() {
  const seen = [];
  const fetch = async (request) => {
    seen.push({ method: request.method, url: new URL(request.url).pathname + new URL(request.url).search, headers: Object.fromEntries(request.headers), body: request.body ? await request.text() : null });
    if (request.method === 'POST') return Response.json({ id: 't1', name: seen.at(-1).body ? JSON.parse(seen.at(-1).body).name : null }, { status: 201, headers: { 'x-trace': 'abc' } });
    return Response.json({ id: 't1' });
  };
  return { fetch, seen };
}

const doc = (steps, components) => ({ arazzo: '1.0.1', info: { title: 't', version: '1' }, components, workflows: [{ workflowId: 'w', steps }] });

test('runs steps, resolving parameters, bodies, outputs and embedded expressions', async () => {
  const { fetch, seen } = fakeFetch();
  const [run] = await runScenario(doc([
    { stepId: 'create', operationId: 'createThing', requestBody: { payload: { name: 'first' } },
      successCriteria: [{ condition: '$statusCode == 201 && $response.header.x-trace == \'abc\'' }], outputs: { id: '$response.body#/id' } },
    { stepId: 'get', operationId: 'getThing',
      parameters: [{ name: 'thingId', in: 'path', value: '$steps.create.outputs.id' }, { reference: '$components.parameters.caller' }, { name: 'q', in: 'query', value: 'thing-{$steps.create.outputs.id}' }],
      successCriteria: [{ condition: '$response.body#/id == $steps.create.outputs.id' }] },
  ], { parameters: { caller: { name: 'X-Caller-Id', in: 'header', value: 'tester' } } }), { fetch, operations });

  assert.ok(run.passed);
  assert.strictEqual(seen[1].url, '/demo/things/t1?q=thing-t1');
  assert.strictEqual(seen[1].headers['x-caller-id'], 'tester');
});

test('a failed check fails the workflow and stops it', async () => {
  const { fetch, seen } = fakeFetch();
  const [run] = await runScenario(doc([
    { stepId: 'create', operationId: 'createThing', requestBody: { payload: { name: 'x' } }, successCriteria: [{ condition: '$statusCode == 200' }] },
    { stepId: 'get', operationId: 'getThing', parameters: [{ name: 'thingId', in: 'path', value: 't1' }] },
  ]), { fetch, operations });
  assert.strictEqual(run.passed, false);
  assert.strictEqual(seen.length, 1, 'the step after the failure did not run');
});

test('a workflow reads what one it depends on produced; one whose dependency failed does not run', async () => {
  const { fetch, seen } = fakeFetch();
  const first = { workflowId: 'first', steps: [{ stepId: 'make', operationId: 'createThing', requestBody: { payload: { name: 'a' } }, outputs: { id: '$response.body#/id' } }], outputs: { thing: '$steps.make.outputs.id' } };
  const second = { workflowId: 'second', dependsOn: ['first'], steps: [{ stepId: 'read', operationId: 'getThing', parameters: [{ name: 'thingId', in: 'path', value: '$workflows.first.outputs.thing' }] }] };
  const document = { arazzo: '1.0.1', info: { title: 't', version: '1' }, workflows: [first, second] };

  const results = await runScenario(document, { fetch, operations });
  assert.deepStrictEqual(results.map((r) => r.passed), [true, true]);
  assert.strictEqual(seen.at(-1).url, '/demo/things/t1');

  const failing = { ...first, steps: [{ ...first.steps[0], successCriteria: [{ condition: '$statusCode == 418' }] }] };
  const after = await runScenario({ ...document, workflows: [failing, second] }, { fetch, operations });
  assert.deepStrictEqual(after.map((r) => [r.workflowId, r.passed, r.steps.length]), [['first', false, 1], ['second', false, 0]]);
});

test('a step with a retry tries again until it passes, or runs out of tries', async () => {
  // Something the server does after it answers: the thing is ready from the third look.
  let looks = 0;
  const fetch = async () => Response.json({ ready: (looks += 1) >= 3 });
  const step = (retryLimit) => ({
    stepId: 'ready', operationId: 'getThing', parameters: [{ name: 'thingId', in: 'path', value: 't1' }],
    successCriteria: [{ condition: '$response.body#/ready == true' }],
    onFailure: [{ name: 'wait', type: 'retry', retryAfter: 0, retryLimit }],
  });

  const [ready] = await runScenario(doc([step(5)]), { fetch, operations });
  assert.strictEqual(ready.passed, true);
  assert.strictEqual(looks, 3, 'it stopped looking once it passed');

  looks = 0;
  const [notYet] = await runScenario(doc([step(1)]), { fetch, operations });
  assert.strictEqual(notYet.passed, false);
  assert.strictEqual(looks, 2, 'one try, and one retry');
});

test('refuses what it does not support, by name', async () => {
  const { fetch } = fakeFetch();
  const refuse = (steps, pattern) => assert.rejects(runScenario(doc(steps), { fetch, operations }), pattern);
  await refuse([{ stepId: 's', operationId: 'createThing', onSuccess: [{ type: 'end' }] }], /uses onSuccess/);
  await refuse([{ stepId: 's', operationId: 'createThing', onFailure: [{ name: 'f', type: 'goto', stepId: 's' }] }], /onFailure actions of type goto are not supported/);
  await refuse([{ stepId: 's', operationId: 'nothingLikeThis' }], /names operation nothingLikeThis, which no API in the set declares/);
  await refuse([{ stepId: 's', operationId: 'createThing', successCriteria: [{ condition: '$statusCode == 201 || $statusCode == 200' }] }], /uses \|\| or grouping/);
  await refuse([{ stepId: 's', operationId: 'createThing', successCriteria: [{ condition: '/x', type: 'xpath', context: '$response.body' }] }], /Selector type "xpath" is not one this runner supports/);
  await refuse([{ stepId: 's', operationId: 'createThing', outputs: { x: { context: '$response.body', selector: '$.x', type: { type: 'jsonpath', version: 'draft-goessner-dispatch-jsonpath-00' } } } }], /is not one this runner supports/);
});

test('a selector picks values by what they hold: a singular query gives the value, any other a list', async () => {
  const things = { items: [{ id: 'a', kind: 'x' }, { id: 'b', kind: 'y' }, { id: 'c', kind: 'y' }] };
  const urls = [];
  const fetch = async (request) => { urls.push(new URL(request.url).pathname); return Response.json(things); };
  const list = { stepId: 'list', operationId: 'getThing', parameters: [{ name: 'thingId', in: 'path', value: 'all' }],
    successCriteria: [{ context: '$response.body', condition: "$.items[?@.kind == 'x']", type: 'jsonpath' }],
    outputs: {
      first: { context: '$response.body', selector: '$.items[0].id', type: 'jsonpath' },
      xs: { context: '$response.body', selector: "$.items[?@.kind == 'x'].id", type: 'jsonpath' },
      ys: { context: '$response.body', selector: "$.items[?@.kind == 'y'].id", type: { type: 'jsonpath', version: 'rfc9535' } },
      zs: { context: '$response.body', selector: "$.items[?@.kind == 'z'].id", type: 'jsonpath' },
    } };
  const document = { arazzo: '1.1.0', info: { title: 't', version: '1' }, workflows: [{
    workflowId: 'w', steps: [list],
    outputs: { x: { context: '$steps.list.outputs.xs', selector: '/0', type: 'jsonpointer' } },
  }, {
    workflowId: 'then', dependsOn: ['w'],
    steps: [{ stepId: 'get', operationId: 'getThing', parameters: [{ name: 'thingId', in: 'path', value: '$workflows.w.outputs.x' }] }],
  }] };

  const [run, then] = await runScenario(document, { fetch, operations });
  assert.ok(run.passed && then.passed, JSON.stringify(run.steps[0].checks));
  assert.deepStrictEqual(run.steps[0].outputs, { first: 'a', xs: ['a'], ys: ['b', 'c'], zs: [] });
  assert.strictEqual(urls.at(-1), '/demo/things/a', 'a JSON Pointer took the one item out of the list');
});

test('a selector naming a value that is not there fails its step, saying which output', async () => {
  const fetch = async () => Response.json({ items: [] });
  const [run] = await runScenario(doc([
    { stepId: 'list', operationId: 'getThing', parameters: [{ name: 'thingId', in: 'path', value: 'all' }],
      outputs: { first: { context: '$response.body', selector: '$.items[0].id', type: 'jsonpath' } } },
  ]), { fetch, operations });
  assert.strictEqual(run.passed, false);
  assert.match(run.steps[0].checks.at(-1).condition, /^output first: \$\.items\[0\]\.id matched nothing/);
});

test('a jsonpath criterion passes when it matches something, with runtime expressions embedded', async () => {
  const fetch = async () => Response.json({ items: [{ id: 't1' }] });
  const check = (condition) => runScenario(doc([
    { stepId: 'make', operationId: 'createThing', outputs: { id: '$response.body#/items/0/id' } },
    { stepId: 'look', operationId: 'getThing', parameters: [{ name: 'thingId', in: 'path', value: 't1' }],
      successCriteria: [{ context: '$response.body', condition, type: 'jsonpath' }] },
  ]), { fetch, operations });
  assert.strictEqual((await check("$.items[?@.id == '{$steps.make.outputs.id}']"))[0].passed, true);
  assert.strictEqual((await check("$.items[?@.id == 'nope']"))[0].passed, false);
});

// ── Message steps (Arazzo 1.1) ──────────────────────────────────────────────

const messaging = new Map([
  ...operations,
  ['streamEvents', { method: 'GET', path: '/platform/events/stream' }],
  ['publishEvent', { method: 'POST', path: '/platform/events' }],
  ['things-events-asyncapi.yaml#sendThingCreated', { async: true, action: 'send', address: 'demo.thing.created', reached: 'events' }],
  ['things-events-asyncapi.yaml#receiveThingNoticed', { async: true, action: 'receive', address: 'demo.thing.noticed', reached: 'events' }],
  ['things-events-asyncapi.yaml#/channels/demo.thing.created', { async: true, address: 'demo.thing.created', reached: 'events' }],
  ['relay-asyncapi.yaml#/channels/audio', { async: true, address: 'audio', reached: 'servers' }],
]);

/**
 * A server with an event stream: creating a thing sends `demo.thing.created`,
 * and anything published is sent on too, as the mock's platform events are.
 */
function eventServer() {
  const listeners = new Set();
  const published = [];
  const encoder = new TextEncoder();
  const send = (event) => { for (const listen of listeners) listen(event); };
  const fetch = async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === '/platform/events/stream') {
      let listen;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(': connected\n\n'));
          listen = (event) => controller.enqueue(encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`));
          listeners.add(listen);
          request.signal.addEventListener('abort', () => { listeners.delete(listen); controller.close(); });
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }
    if (pathname === '/platform/events') {
      const event = await request.json();
      published.push(event);
      send({ id: `e${published.length}`, ...event });
      return Response.json(event, { status: 201 });
    }
    if (request.method === 'POST') {
      // Sent after answering, as a reaction would be.
      setTimeout(() => send({ id: 'c1', type: 'demo.thing.created', subject: 't1', data: { id: 't1', status: 'new' } }), 5);
      return Response.json({ id: 't1' }, { status: 201 });
    }
    return Response.json({ id: 't1' });
  };
  return { fetch, published, listeners };
}

const sources = [{ name: 'things', url: './things-events-asyncapi.yaml', type: 'asyncapi' }, { name: 'relay', url: './relay-asyncapi.yaml', type: 'asyncapi' }];
const messages = (steps) => ({ ...doc(steps), arazzo: '1.1.0', sourceDescriptions: sources });

test('a receive step takes the event a step before it caused, and reads it as $message.payload', async () => {
  const server = eventServer();
  const [run] = await runScenario(messages([
    { stepId: 'create', operationId: 'createThing', requestBody: { payload: { name: 'x' } }, outputs: { id: '$response.body#/id' } },
    { stepId: 'created', operationId: '$sourceDescriptions.things.sendThingCreated', action: 'receive', dependsOn: ['create'],
      successCriteria: [{ condition: '$message.payload#/subject == $steps.create.outputs.id && $message.payload.data.status == \'new\'' }],
      outputs: { status: '$message.payload#/data/status' } },
  ]), { fetch: server.fetch, operations: messaging });

  assert.ok(run.passed, JSON.stringify(run.steps.at(-1)?.checks));
  const received = run.steps[1];
  assert.deepStrictEqual(received.request, { action: 'receive', channel: 'demo.thing.created' });
  assert.strictEqual(received.message.payload.subject, 't1');
  assert.deepStrictEqual(received.outputs, { status: 'new' });
  assert.strictEqual(server.listeners.size, 0, 'the run closed the stream when it finished');
});

test('a receive step by channelPath; an event is taken once', async () => {
  const server = eventServer();
  const receive = (stepId) => ({ stepId, channelPath: '{$sourceDescriptions.things.url}#/channels/demo.thing.created', action: 'receive', timeout: 100 });
  const [run] = await runScenario(messages([
    { stepId: 'create', operationId: 'createThing', requestBody: { payload: { name: 'x' } } },
    receive('first'),
    receive('again'),
  ]), { fetch: server.fetch, operations: messaging });
  assert.deepStrictEqual(run.steps.map((s) => s.passed), [true, true, false]);
  assert.deepStrictEqual(run.steps[2].checks, [{ condition: 'received demo.thing.created within 100 ms', passed: false }]);
});

test('a send step publishes the event, with the channel as its type', async () => {
  const server = eventServer();
  const [run] = await runScenario(messages([
    { stepId: 'notice', operationId: '$sourceDescriptions.things.receiveThingNoticed', action: 'send',
      requestBody: { payload: { subject: 't1', data: { by: 'tester' } } } },
    { stepId: 'heard', operationId: '$sourceDescriptions.things.receiveThingNoticed', action: 'receive',
      successCriteria: [{ condition: '$message.payload#/data/by == \'tester\'' }] },
  ]), { fetch: server.fetch, operations: messaging });
  assert.ok(run.passed, JSON.stringify(run.steps.map((s) => s.checks)));
  assert.strictEqual(server.published[0].type, 'demo.thing.noticed');
  assert.strictEqual(server.published[0].specversion, '1.0');
});

test('refuses message steps it cannot run, by name', async () => {
  const server = eventServer();
  const refuse = (steps, pattern) => assert.rejects(runScenario(messages(steps), { fetch: server.fetch, operations: messaging }), pattern);
  await refuse([{ stepId: 's', channelPath: '{$sourceDescriptions.relay.url}#/channels/audio', action: 'send' }], /by operationId, not channelPath/);
  await refuse([{ stepId: 's', operationId: '$sourceDescriptions.things.sendThingCreated', action: 'publish' }], /action is send or receive/);
  await refuse([{ stepId: 's', operationId: '$sourceDescriptions.things.nothingLikeThis', action: 'receive' }], /no AsyncAPI document in the set declares/);
  await refuse([{ stepId: 's', operationId: 'createThing', action: 'receive' }], /is an HTTP operation/);
  await refuse([{ stepId: 's', operationId: 'createThing', dependsOn: ['later'] }, { stepId: 'later', operationId: 'createThing' }], /depends on later, which isn't a step before it/);
  await refuse([{ stepId: 's', channelPath: '#/channels/x', action: 'receive' }], /is not \{\$sourceDescriptions/);
});

test('a receive step takes the event that meets its criteria, leaving another\'s of the same type', async () => {
  const server = eventServer();
  const publish = (stepId, subject) => ({ stepId, operationId: '$sourceDescriptions.things.receiveThingNoticed', action: 'send', requestBody: { payload: { subject } } });
  const receive = (stepId, subject) => ({ stepId, operationId: '$sourceDescriptions.things.receiveThingNoticed', action: 'receive', timeout: 100,
    successCriteria: [{ condition: `$message.payload#/subject == '${subject}'` }] });
  const [run] = await runScenario(messages([
    publish('other', 'b'), publish('mine', 'a'),
    receive('forA', 'a'), receive('forB', 'b'), receive('forAAgain', 'a'),
  ]), { fetch: server.fetch, operations: messaging });
  assert.deepStrictEqual(run.steps.map((s) => s.passed), [true, true, true, true, false]);
  assert.deepStrictEqual(run.steps[4].checks.map((c) => c.condition), ['received demo.thing.noticed meeting its criteria within 100 ms']);
});
