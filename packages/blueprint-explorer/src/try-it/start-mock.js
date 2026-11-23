/**
 * Starting the mock a page runs, the same way on every page: the API
 * reference's, the Scenarios page's, and the control panel's own on a page
 * that runs none.
 *
 * Its routing is the site's own: what the site's script sets on
 * BlueprintExplorer.routing (lib/site-script.js), in the mock's routing format,
 * less what the control panel switched to the page, and what a server chosen
 * in the control panel adds (routing.js). With none, every call stays in the
 * page.
 *
 * Restored, it puts back what the last page left (records.js): the records,
 * with the event log, and the stubs. Started over, it forgets the stubs the
 * last mock had. Either way, what it holds is left for the next page when
 * this one is left, and `keep` leaves it sooner, after a change.
 */

import { createMockServer } from '@codeforamerica/blueprint-mock-server/server';
import { restoreRecords, saveRecords, restoreStubs, saveStubs, forgetStubs } from './records.js';
import { routingInUse } from './routing.js';
import { extract } from '@codeforamerica/blueprint-core/browser';
import { logRequest } from './activity.js';
import { mockChanged } from './control-panel.js';

const ORIGIN = 'http://mock.invalid';

const METHODS = ['get', 'put', 'post', 'patch', 'delete'];

/**
 * The site's routing, with each handler's `call` and `publish` logged in the
 * activity log as they're made, so what a routed handler does, such as a
 * session adapter's credentials request and the events it publishes, shows
 * beside what the page sent.
 */
function loggingHandlers(routing, docs, where) {
  const operations = new Map();
  for (const doc of docs) {
    // Where the page's mock serves the API: its localhost server's path.
    const local = (Array.isArray(doc.content?.servers) ? doc.content.servers : []).find((server) => /localhost|127\.0\.0\.1/.test(server?.url ?? ''));
    let base = '';
    try { base = local ? new URL(local.url).pathname.replace(/\/$/, '') : ''; } catch { /* no base */ }
    for (const [path, item] of Object.entries(doc.type === 'openapi' ? doc.content?.paths ?? {} : {})) {
      for (const method of METHODS) {
        const id = item?.[method]?.operationId;
        if (id && !operations.has(id)) operations.set(id, { method: method.toUpperCase(), path: base + path });
      }
    }
  }
  const log = (method, path, sent, { status, body }) => {
    logRequest(where, {
      time: new Date().toISOString(), method, path, body: sent === undefined ? undefined : JSON.stringify(sent),
      status, ok: status < 400, ms: 0, shown: body == null ? '' : JSON.stringify(body, null, 2),
      eventIds: body?.id && body?.specversion ? [body.id] : [],
    });
    mockChanged();
  };
  const logged = (context) => ({
    ...context,
    async call(operationId, args = {}) {
      const answer = await context.call(operationId, args);
      const operation = operations.get(operationId);
      const path = (operation?.path ?? operationId).replace(/\{([^}]+)\}/g, (_, name) => args.params?.[name] ?? `{${name}}`);
      log(operation?.method ?? 'CALL', path, args.body, answer);
      return answer;
    },
    async publish(event, data, options) {
      const answer = await context.publish(event, data, options);
      const { method, path } = operations.get('publishEvent') ?? { method: 'POST', path: '/platform/events' };
      log(method, path, answer.body ?? { event, data }, answer);
      return answer;
    },
  });
  const wrap = (handler) => (request, context) => handler(request, context ? logged(context) : context);
  return routing.map((entry) => {
    if (typeof entry.handler === 'function') return { ...entry, handler: wrap(entry.handler) };
    if (entry.handler && typeof entry.handler === 'object') {
      return { ...entry, handler: Object.fromEntries(Object.entries(entry.handler).map(([name, value]) => [name, typeof value === 'function' ? wrap(value) : value])) };
    }
    return entry;
  });
}

/** The mock the page is running, saved for the next page when this one is left. */
let current = null;
let saving = false;

/**
 * @param {{ contracts: object, scope: string, version: string, seed?: boolean, restore?: boolean, basePath?: string }} options -
 *   The contract set; where records are kept (the mock's folder) and the
 *   set's version; whether to load the sample records; whether to put back
 *   what the last page left, or start over; and the path the mock serves
 *   under, if not the top
 * @returns {Promise<{ mock: object, seeded: boolean, ms: number, keep: () => Promise<void> }>}
 *   The mock; whether it started with the sample records, and how long it
 *   took to build; and `keep`, which saves what it holds for the next page
 */
export async function startMock({ contracts, scope, version, seed = true, restore = false, basePath = '' }) {
  const where = { scope, version };
  const started = performance.now();
  // The site's routing, less what was switched to the page, and any server chosen in it.
  const docs = extract(contracts, 'docs');
  const routing = loggingHandlers(routingInUse({ scope }, docs), docs, where);
  const mock = await createMockServer({ contracts, seed, basePath, routing });
  // Only to read and register stubs, through the mock's own routes.
  const send = (method, path, { body } = {}) => mock.fetch(new Request(ORIGIN + basePath + path, {
    method, body, headers: body ? { 'Content-Type': 'application/json' } : {},
  }));
  if (restore) {
    restoreRecords(mock, where);
    await restoreStubs(send, where);
  } else {
    forgetStubs(where);
  }
  current = { mock, where };
  if (!saving) {
    saving = true;
    addEventListener('pagehide', () => saveRecords(current.mock, current.where));
  }
  return {
    mock,
    seeded: seed,
    ms: Math.round(performance.now() - started),
    keep: async () => {
      saveRecords(mock, where);
      await saveStubs(send, where);
    },
  };
}
