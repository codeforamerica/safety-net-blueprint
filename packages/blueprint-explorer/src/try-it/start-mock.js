/**
 * Starting the mock a page runs, the same way on every page: the API
 * reference's, the Scenarios page's, and the control panel's own on a page
 * that runs none.
 *
 * Its routing is the site's own: what the site's script sets on
 * BlueprintExplorer.routing (lib/site-script.js), in the mock's routing format,
 * and what a server chosen in the control panel adds (routing.js); and on an
 * API reference page, each adapter answered as chosen there (adapters.js).
 * With none, every call stays in the page.
 *
 * Restored, it puts back what the last page left (records.js): the records,
 * with the event log, and the stubs. Started over, it forgets the stubs the
 * last mock had. Either way, what it holds is left for the next page when
 * this one is left, and `keep` leaves it sooner, after a change.
 */

import { createMockServer } from '@codeforamerica/blueprint-mock-server/server';
import { restoreRecords, saveRecords, restoreStubs, saveStubs, forgetStubs } from './records.js';
import { routingInUse } from './routing.js';
import { withAdapterChoices } from './adapters.js';
import { schemeFor, signedIn } from './sign-in.js';
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

/**
 * The site's routing, with each operation of a handler module that requires
 * signing in (sign-in.js) given the visitor's token: when nobody is signed
 * in, the call waits while `ask` asks the visitor to, and goes on signed in,
 * or answers 401 when they don't.
 *
 * @param {object[]} routing
 * @param {object[]} docs
 * @param {{ scope: string }} where
 * @param {(call: { operationId: string, scheme: object }) => Promise<object|null>} ask - Resolves to the token, or null
 */
function signedInHandlers(routing, docs, where, ask) {
  const operationIn = (api, operationId) => {
    for (const doc of docs.filter((d) => d.type === 'openapi' && d.api === api)) {
      for (const item of Object.values(doc.content?.paths ?? {})) {
        for (const method of METHODS) {
          if (item?.[method]?.operationId === operationId) return { doc, operation: item[method] };
        }
      }
    }
    return null;
  };
  const signingIn = (handler, operationId, scheme) => async (request, context) => {
    const token = signedIn(where) ?? await ask({ operationId, scheme });
    if (!token) return Response.json({ code: 'UNAUTHORIZED', message: `Not signed in: ${operationId} needs it.` }, { status: 401 });
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token.accessToken}`);
    return handler(new Request(request, { headers }), context);
  };
  return routing.map((entry) => {
    if (!entry.api || !entry.handler || typeof entry.handler !== 'object') return entry;
    const handler = Object.fromEntries(Object.entries(entry.handler).map(([name, value]) => {
      const found = typeof value === 'function' ? operationIn(entry.api, name) : null;
      const scheme = found ? schemeFor(found.doc, found.operation, docs) : null;
      return [name, scheme ? signingIn(value, name, scheme) : value];
    }));
    return { ...entry, handler };
  });
}

/** The mock the page is running, saved for the next page when this one is left. */
let current = null;
let saving = false;

/**
 * @param {{ contracts: object, scope: string, version: string, seed?: boolean, restore?: boolean, basePath?: string,
 *   hold?: (call: object) => Promise<Response>, ask?: (call: object) => Promise<object|null> }} options -
 *   The contract set; where records are kept (the mock's folder) and the
 *   set's version; whether to load the sample records; whether to put back
 *   what the last page left, or start over; the path the mock serves
 *   under, if not the top; and, on a page where the developer can answer an
 *   adapter's calls, how a call waits for their answer, so each adapter is
 *   answered as chosen in the page (adapters.js); and how a call that needs
 *   the visitor signed in waits for them to sign in (sign-in.js)
 * @returns {Promise<{ mock: object, seeded: boolean, ms: number, keep: () => Promise<void> }>}
 *   The mock; whether it started with the sample records, and how long it
 *   took to build; and `keep`, which saves what it holds for the next page
 */
export async function startMock({ contracts, scope, version, seed = true, restore = false, basePath = '', hold = null, ask = null }) {
  const where = { scope, version };
  const started = performance.now();
  // The site's routing, any server chosen in the page, and what answers each adapter.
  const docs = extract(contracts, 'docs');
  const routed = routingInUse({ scope }, docs);
  const site = ask ? signedInHandlers(routed, docs, where, ask) : routed;
  const routing = loggingHandlers(hold ? withAdapterChoices(site, docs, where, hold) : site, docs, where);
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
