/**
 * The Node server is the same server a page builds.
 *
 * Every other test builds the mock through `createMockServer`, so a server
 * started from the command line was never exercised: it wired its routes up
 * separately, left out the step calls a composition's patch makes its changes
 * through, and answered 500 to every patch that should have saved. Both now
 * assemble the server in one place (src/assemble-server.js); this starts it
 * the way `blueprint-mock` does and sends the request that failed.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const contracts = fileURLToPath(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url));
const APPLICATION = '11111111-1111-4111-8111-111111111111';
const INCOME = '11111111-1111-4111-8111-200000000003';

/** A port nothing is listening on. */
const freePort = () => new Promise((resolve) => {
  const probe = createServer().listen(0, () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

let base;
let stopServer;
before(async () => {
  const port = await freePort();
  // Read when the module loads, so set before it's imported.
  process.env.MOCK_SERVER_PORT = String(port);
  base = `http://localhost:${port}`;
  const log = console.log; const warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try {
    const cli = await import('../../cli/server.js');
    stopServer = cli.stopServer;
    await cli.startMockServer([contracts], null, 'memory');
  } finally {
    console.log = log; console.warn = warn;
  }
});

after(async () => {
  const log = console.log; console.log = () => {};
  try { await stopServer(false); } finally { console.log = log; }
});

test('a patch to an editable composition saves on the server started from the command line', async () => {
  const response = await fetch(`${base}/intake/applications/${APPLICATION}/details`, {
    method: 'PATCH',
    headers: {
      'x-caller-id': 'worker-1', 'x-caller-roles': 'case_worker',
      'content-type': 'application/json-patch+json', 'idempotency-key': 'k1',
    },
    body: JSON.stringify([
      { op: 'test', path: `/incomes/${INCOME}/amount`, value: 400 },
      { op: 'replace', path: `/incomes/${INCOME}/amount`, value: 410 },
    ]),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.incomes[INCOME].amount, 410);
});
