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
  await refuse([{ stepId: 's', operationId: 'createThing', successCriteria: [{ condition: '$.x', type: 'jsonpath', context: '$response.body' }] }], /jsonpath criteria are not supported/);
});
