/**
 * Domains, APIs and operations that something other than the mock answers
 * (#283, #520): a real service at a URL, or a function a page passes in.
 *
 * A handler and `fetch` have the same signature, so making an endpoint real
 * is replacing one function with another — `route-table.js` calls itself the
 * substitution point for exactly this. What is left is deciding *which*
 * routes, and reissuing the request to somewhere else. A routed domain or API
 * also covers the events its state machines receive: the mock doesn't run
 * those reactions, and delivers the event instead (deliverEvent).
 *
 * Forward, not bypass. Declining to handle a request is meaningless in Node,
 * where this process is what is listening on that port, and in a page it only
 * means anything if the caller already addressed the real service. Forwarding
 * also keeps the caller unchanged when a route is switched.
 *
 * Configuration arrives as data, never a file path, because this runs in a
 * browser as well as in Node. The CLI reads a file and passes the array; a
 * page passes it directly; a test passes a literal. Both are checked against
 * the same schema, so a bad array and a file with a typo fail the same way.
 */

import { validateRouting } from '@codeforamerica/blueprint-core/browser';

/**
 * Request headers that travel without being named.
 *
 * Only what describes the request itself: content negotiation, the
 * concurrency and retry headers `docs/conventions/http.yaml` defines, and W3C
 * trace context. Everything else is dropped unless `includeHeaders` names it.
 *
 * An allowlist rather than a list of credentials to strip, because the caller
 * addressed the mock and where the request goes afterwards is decided by
 * configuration it knows nothing about. A denylist has to anticipate every
 * name a credential can travel under — `Authorization`, `Cookie`, `X-API-Key`
 * and whatever a vendor invented — and the one it misses is handed to a new
 * recipient with no error to notice. Dropping one too many fails as a 401,
 * which is cheap and visible.
 */
const DEFAULT_REQUEST_HEADERS = new Set([
  'accept', 'accept-language', 'content-type',
  'idempotency-key', 'if-match', 'if-none-match',
  'traceparent', 'tracestate',
]);

/**
 * Response headers that do not travel unless named.
 *
 * `set-cookie` is the real service's session, and whatever called the mock
 * has no business holding it. A page never sees it anyway; Node would pass it
 * on.
 */
const WITHHELD_RESPONSE_HEADERS = new Set(['set-cookie']);

/**
 * Response headers that describe the bytes on the wire rather than the body
 * passed on. `fetch` has already decoded a compressed body, so passing on
 * `content-encoding: gzip` with it would have the caller decode it twice.
 */
const ENCODING_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

/** Statuses that send the caller somewhere else. 304 is not one of them. */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The answer a registered HTTP stub gives a request, if one matches, used
 * up as it answers: a stub is a per-test override, and outranks routing the
 * same way it outranks normal mock handling, whether the route goes to a URL,
 * a module or a handler. Answered the way the mock's own handler for this
 * method would answer it, so a stub behaves the same whether or not its route
 * is real.
 *
 * @param {object|null} stubs - The mock's HTTP stubs (mock-stub-engine.js)
 * @param {Request} request
 * @returns {Response|null}
 */
function stubbedAnswer(stubs, request) {
  const httpStub = stubs?.matchAndPopHttp(request.method, new URL(request.url).pathname);
  if (!httpStub) return null;
  const isDelete = request.method.toUpperCase() === 'DELETE';
  const status = httpStub.response?.status ?? (isDelete ? 204 : 200);
  return status === 204 || (isDelete && !httpStub.response?.body)
    ? new Response(null, { status })
    : Response.json(httpStub.response?.body ?? {}, { status });
}

/**
 * A handler that reissues the request to `target`.
 *
 * @param {string} target - Absolute base URL of the real service
 * @param {object} [options]
 * @param {string[]} [options.includeHeaders] - Headers to pass along beyond the defaults
 * @param {number} [options.timeoutMs]
 * @param {object} [options.stubs] - The mock's HTTP stubs, which answer first (mock-stub-engine.js)
 * @returns {(request: Request) => Promise<Response>}
 */
export function forwardTo(target, { includeHeaders = [], timeoutMs = DEFAULT_TIMEOUT_MS, stubs = null } = {}) {
  const named = new Set(includeHeaders.map((name) => name.toLowerCase()));

  return async function forwarded(request) {
    const incoming = new URL(request.url);

    const stubbed = stubbedAnswer(stubs, request);
    if (stubbed) return stubbed;

    const base = new URL(target);
    // The target's own path is a prefix, not something the route replaces:
    // `https://host/api` plus `/intake/applications` is `/api/intake/applications`.
    const url = new URL(
      base.pathname.replace(/\/$/, '') + incoming.pathname + incoming.search,
      base,
    );

    const headers = new Headers();
    for (const [name, value] of request.headers) {
      if (DEFAULT_REQUEST_HEADERS.has(name) || named.has(name)) headers.set(name, value);
    }

    // Never followed. A redirect would send the request somewhere the
    // configuration does not name, and every target is meant to be declared.
    const init = { method: request.method, headers, redirect: 'manual' };
    // Buffered rather than streamed: a streaming request body needs
    // `duplex: 'half'`, which browsers have barely implemented. The response
    // body is passed back as a stream, so a long-lived one still works.
    if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
      init.body = await request.arrayBuffer();
    }
    if (typeof AbortSignal?.timeout === 'function') init.signal = AbortSignal.timeout(timeoutMs);

    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      // A dead target is a fact about this deployment, not about the
      // contract, so it reads as a gateway failure rather than as the
      // endpoint being broken.
      if (error?.name === 'TimeoutError') {
        return Response.json({
          code: 'GATEWAY_TIMEOUT',
          message: `${url.origin} did not answer this route within ${timeoutMs}ms`,
        }, { status: 504 });
      }
      return Response.json({
        code: 'BAD_GATEWAY',
        message: `Could not reach ${url.origin} for this route: ${error.message}${refusedInPage(error)}`,
      }, { status: 502 });
    }

    // A page sees a redirect only as an opaque response with status 0 and no
    // location, so passing it on would hand the caller an empty answer.
    if (response.type === 'opaqueredirect' || REDIRECTS.has(response.status)) {
      const location = response.headers.get('location');
      return Response.json({
        code: 'BAD_GATEWAY',
        message: `${url.origin} answered this route with a redirect`
          + (location ? ` to ${location}` : '')
          + ', which the mock does not follow. Point forwardTo at where the service actually answers.',
      }, { status: 502 });
    }

    const passed = new Headers();
    for (const [name, value] of response.headers) {
      if (ENCODING_HEADERS.has(name)) continue;
      // The real service's CORS policy is toward the mock, not toward whatever
      // called the mock, and passed on it would override the mock's own.
      if (name.startsWith('access-control-')) continue;
      if (WITHHELD_RESPONSE_HEADERS.has(name) && !named.has(name)) continue;
      passed.append(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: passed,
    });
  };
}

/** What an entry is called in an error: the thing it names, or its position. */
function entryName(entry, index) {
  if (entry?.domain === EVERY_DOMAIN) return 'The routing entry for every domain';
  if (typeof entry?.domain === 'string') return `Routed domain "${entry.domain}"`;
  const matching = entry?.match && typeof entry.match === 'object'
    ? ` matching ${Object.entries(entry.match).map(([path, value]) => `${path}=${value}`).join(', ')}` : '';
  if (typeof entry?.api === 'string') return `Routed API "${entry.api}"${matching}`;
  if (typeof entry?.operation === 'string') return `Routed operation "${entry.operation}"${matching}`;
  return `Routing entry #${index + 1}`;
}

/**
 * The entries a routing file declares. The file is the whole document, so an
 * empty file or a misspelled top-level key fails here rather than loading as
 * nothing to route, which would boot a server that looks configured and routes
 * nothing. Everything else is checked against the contracts when the mock
 * starts (planRouting, with core's validateRouting).
 *
 * @param {unknown} document - The parsed file
 * @returns {Array}
 */
export function routingFromDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('The routing configuration must be object');
  if (!Array.isArray(document.routing)) throw new Error('The routing configuration needs "routing", a list of entries');
  const extra = Object.keys(document).filter((key) => key !== 'routing' && !key.startsWith('$'));
  if (extra.length) throw new Error(extra.map((key) => `The routing configuration has an unknown key "${key}"`).join('\n'));
  return document.routing;
}

/**
 * What a failed fetch in a page may mean. A browser says only "Failed to
 * fetch" when a server doesn't allow calls from the page's address, so the
 * likely reason is named, as Swagger UI names it.
 */
export const refusedInPage = (error) => (typeof document !== 'undefined' && error?.name === 'TypeError'
  ? '. The server may not allow calls from this page (CORS), or may be down or unreachable from here.'
  : '');

/** The domain an entry names to route every domain, as a proxy's catch-all is written. */
const EVERY_DOMAIN = '*';

/** How narrow an entry is: an operation over an API, an API over a domain, a domain over every one. */
const narrowness = (entry) => (entry.operation ? 2 : entry.api ? 1 : entry.domain === EVERY_DOMAIN ? -1 : 0);

/**
 * Check configuration against the schema and against what the contracts
 * declare, and resolve it to who answers each route and each received event.
 *
 * Checks the schema cannot make: an entry naming nothing is the failure this
 * repository keeps finding — a declaration nobody reads, which looks
 * configured and does nothing — so it fails at boot. So does the same name
 * twice, an `except` naming something outside its entry, a send operation,
 * which is the API's own to send, and one of the mock's own routes.
 *
 * @param {Array} routing
 * @param {object} context
 * @param {Map<string, object>} context.routes - Tagged with each route's domain, api and operationId
 * @param {object} context.operations - From extract(docs, 'operations')
 * @param {Map<string, string>} context.domainOfApi - API name → domain
 * @returns {{ byRoute: Map<string, object>, receives: Array<{ api: string, event: string, id: string, entry: object }> }}
 */
export function planRouting(routing, { routes, operations, domainOfApi, docs }) {
  // What routing names, checked against its schema and the contracts by core,
  // so the mock, the explorer and `blueprint validate` say the same thing.
  // Without the contract set, as in a test, what's known of it.
  const contracts = docs ?? {
    operations, domainOfApi, requestFields: new Map(), external: new Set(),
  };
  const { errors, warnings, entries } = validateRouting({ routing }, contracts);
  if (errors.length) throw new Error(errors.join('\n'));
  for (const warning of warnings) console.warn(`  Warning: ${warning}`);

  /**
   * The narrowest entry that covers a thing, unless its except takes it back;
   * or, when entries of that narrowness have a match, all of them, chosen
   * between per request (byMatch).
   */
  const covering = ({ domain, api, id }) => {
    const covers = entries.filter(({ entry, operation }) => (operation
      ? operation.api === api && operation.id === id
      : entry.api ? entry.api === api : entry.domain === EVERY_DOMAIN || entry.domain === domain));
    const chosen = covers.sort((a, b) => narrowness(b.entry) - narrowness(a.entry))[0];
    if (!chosen) return null;
    const excepted = chosen.except.some((e) => (e.api ? e.api === api : e.operation.api === api && e.operation.id === id));
    if (excepted) return null;
    if (!chosen.entry.match) return chosen;
    const matching = covers.filter((c) => c.entry.match && narrowness(c.entry) === narrowness(chosen.entry));
    return { ...chosen, entry: { matching: matching.map((c) => c.entry) } };
  };

  const byRoute = new Map();
  for (const [key, route] of routes) {
    if (route.mock) continue;
    const chosen = covering({ domain: route.domain, api: route.api, id: route.operationId });
    if (chosen) byRoute.set(key, chosen.entry);
  }
  // An operation entry names something the route table may not hold under
  // that id — one of the mock's own routes, say.
  for (const { entry, name, operation } of entries) {
    if (operation?.kind !== 'openapi' || entry.match) continue;
    const served = [...routes].find(([, route]) => route.api === operation.api && route.operationId === operation.id);
    if (!served) throw new Error(`${name} matches no route the mock serves`);
    if (served[1].mock) throw new Error(`${name} is one the mock serves itself, not one the contracts declare`);
    if (!byRoute.has(served[0])) byRoute.set(served[0], entry);
  }

  // Events: the ones a routed API receives go to whoever answers it, and the
  // ones a routed API sends come from there (routed-events.js).
  const receives = [];
  const sends = [];
  for (const operation of operations?.all ?? []) {
    if (operation.kind !== 'asyncapi' || !operation.event) continue;
    const chosen = covering({ domain: domainOfApi.get(operation.api), api: operation.api, id: operation.id });
    if (!chosen) continue;
    const routedEvent = { api: operation.api, event: operation.event, id: operation.id, entry: chosen.entry };
    if (operation.action === 'receive') receives.push(routedEvent);
    else if (operation.action === 'send') sends.push(routedEvent);
  }
  // A request for a route the mock doesn't have goes where every domain does.
  const everything = entries.find(({ entry }) => entry.domain === EVERY_DOMAIN)?.entry ?? null;
  return { byRoute, receives, sends, everything };
}

/**
 * A page's handler, with what it answers checked against the operation's
 * response schema. A mismatch is answered 502, naming it, and logged: a
 * broken adapter shows at once rather than as odd data later.
 *
 * @param {Function} handler - `(Request) => Response | Promise<Response>`
 * @param {(status: number) => { schema: object, key: string, source?: object } | null} responseSchema
 * @param {string} name - What the route is, for the message
 * @param {{ validate: Function }} schemas - The mock's validator
 * @returns {(request: Request) => Promise<Response>}
 */
function checkedHandler(handler, responseSchema, name, schemas, context = {}) {
  return async function routed(request, matched = {}) {
    const response = await handler(request, { ...context, params: matched.params ?? {} });
    if (!(response instanceof Response)) {
      const message = `The handler routed for ${name} returned ${response === null ? 'null' : typeof response}, not a Response.`;
      console.warn(message);
      return Response.json({ code: 'BAD_GATEWAY', message }, { status: 502 });
    }
    const declared = responseSchema(response.status);
    if (!declared || !(response.headers.get('content-type') ?? '').includes('json')) return response;
    let body;
    try {
      body = await response.clone().json();
    } catch {
      const message = `The handler routed for ${name} answered ${response.status} with a body that isn't JSON.`;
      console.warn(message);
      return Response.json({ code: 'BAD_GATEWAY', message }, { status: 502 });
    }
    const { valid, errors } = schemas.validate(body, declared.schema, declared.key, declared.source);
    if (valid) return response;
    const details = errors.map((e) => ({ field: e.field ?? e.instancePath ?? '', message: e.message }));
    const message = `The handler routed for ${name} answered ${response.status} with a body its response schema doesn't allow.`;
    console.warn(message, details);
    return Response.json({ code: 'BAD_GATEWAY', message, details }, { status: 502 });
  };
}

/**
 * Point the configured routes at who answers them, and say which received
 * events go elsewhere.
 *
 * Mutates handlers on routes that already exist rather than adding any, so
 * registration order and first-write-wins are untouched.
 *
 * @param {Map<string, object>} routes
 * @param {Array} routing
 * @param {object} context - As for planRouting, and:
 * @param {(route: object, status: number) => { schema: object, key: string } | null} context.responseSchema
 * @param {object} context.instance - The mock being routed (instance.js)
 * @returns {{ routed: string[], receives: Array<{ api: string, event: string, id: string, entry: object }>, sends: Array<{ api: string, event: string, id: string, entry: object }>, unmatched: ((request: Request) => Promise<Response>) | null }}
 *   `unmatched` answers a request for a route the mock doesn't have, when an
 *   entry routes every domain.
 */
export function applyRouting(routes, routing = [], context) {
  if (routing.length === 0) return { routed: [], receives: [], sends: [], unmatched: null };
  const { byRoute, receives, sends, everything } = planRouting(routing, { ...context, routes });
  const reporting = handlerContext(routes, context);

  /**
   * Who answers a route for one entry: its handler, the one its module
   * exports for the route's operation, or its URL. Null when the entry's
   * module doesn't answer the route's operation.
   */
  const answerFor = (entry, key, route) => {
    const handler = handlerFor(entry, route);
    if (entry.handler !== undefined && !handler) return null;
    return handler
      ? checkedHandler(handler, (status) => context.responseSchema(route, status), key, context.instance.schemas, reporting)
      : forwardTo(entry.to, { includeHeaders: entry.includeHeaders, timeoutMs: entry.timeoutMs, stubs: context.instance.stubs });
  };
  // Which entry answered for a resource, for the requests after: one map per
  // group of matching entries, shared by the routes they cover.
  const chosen = new WeakMap();
  // The entries whose module answered something, so one answering nothing fails.
  const used = new Set();
  const answering = (entry, key, route) => {
    const answer = answerFor(entry, key, route);
    if (answer) used.add(entry);
    return answer;
  };

  for (const [key, entry] of byRoute) {
    const route = routes.get(key);
    if (entry.matching) {
      const memory = chosen.get(entry.matching[0]) ?? new Map();
      chosen.set(entry.matching[0], memory);
      const answers = entry.matching.map((matching) => ({ entry: matching, match: matching.match, answer: answering(matching, key, route) }))
        .filter(({ answer }) => answer);
      if (!answers.length) continue;
      route.handler = byMatch(answers, memory, key);
    } else {
      const answer = answering(entry, key, route);
      if (!answer) continue;
      route.handler = answer;
    }
    // A stub answers first, whoever the route goes to.
    const answer = route.handler;
    route.handler = async (request, matched) => stubbedAnswer(context.instance.stubs, request) ?? answer(request, matched);
    // Marked, so a check that reads the mock's records knows these aren't the ones that count.
    route.routed = true;
  }
  const idle = routing.filter((entry) => entry.handler && typeof entry.handler === 'object' && !used.has(entry));
  if (idle.length) {
    throw new Error(idle.map((entry) => `${entryName(entry, routing.indexOf(entry))}'s module exports a handler for none of the operations it's routed for`).join('\n'));
  }
  // No operation to check a handler's answer against, so it's passed on as it is.
  const unmatched = everything && (everything.handler
    ? async (request) => everything.handler(request, reporting)
    : forwardTo(everything.to, { includeHeaders: everything.includeHeaders, timeoutMs: everything.timeoutMs, stubs: context.instance.stubs }));
  return { routed: [...byRoute.keys()], receives, sends, unmatched };
}

/**
 * The handler an entry gives a route: its function, which answers every
 * operation it covers; or, from a module, the export named for the route's
 * operationId, null when it has none. A module needn't answer every operation
 * of the API it's routed for, as an adapter that signs no tokens has no key
 * set; one it doesn't answer stays as the mock answers it. A module's path,
 * as a file writes it, is loaded by whoever reads the file (the CLI, the
 * explorer's build) before it gets here.
 */
function handlerFor(entry, route) {
  const { handler } = entry;
  if (handler === undefined || typeof handler === 'function') return handler ?? null;
  if (typeof handler === 'string') {
    throw new Error(`${entryName(entry, 0)}'s handler, ${handler}, wasn't loaded: pass the module itself in code, or read routing from a file with the CLI or the explorer's build`);
  }
  const named = handler[route.operationId] ?? handler.default?.[route.operationId];
  if (named === undefined) return null;
  if (typeof named !== 'function') throw new Error(`${entryName(entry, 0)}'s module exports ${route.operationId}, which isn't a function`);
  return named;
}

/**
 * A route several entries answer, each with a match: the first whose match
 * the request's JSON body meets answers it, and a later request with none of
 * the fields the entries match on goes to the entry that answered the earlier
 * request naming the same resource, by a path parameter with the name and
 * value of a field of that request. A content-based router (Enterprise
 * Integration Patterns).
 *
 * @param {Array<{ entry: object, match: object, answer: Function }>} answers - This route's answer from each entry
 * @param {Map<string, object>} memory - `field=value` → the entry that answered, shared by the group's routes
 * @param {string} key - The route, for the message
 */
function byMatch(answers, memory, key) {
  const fields = [...new Set(answers.flatMap(({ match }) => Object.keys(match)))];
  const at = (body, path) => path.split('.').reduce((value, part) => value?.[part], body);
  return async function chooseByMatch(request, matched = {}) {
    const body = await request.clone().json().catch(() => null);
    const named = body && fields.some((path) => at(body, path) !== undefined);
    let chosen = null;
    if (named) {
      chosen = answers.find(({ match }) => Object.entries(match).every(([path, value]) => at(body, path) === value)) ?? null;
      if (chosen) {
        for (const [field, value] of Object.entries(body)) {
          if (typeof value === 'string') memory.set(`${field}=${value}`, chosen.entry);
        }
      }
    } else {
      // The entry that answered before; this route's answer from it.
      let remembered = null;
      for (const [name, value] of Object.entries(matched.params ?? {})) remembered = memory.get(`${name}=${value}`) ?? remembered;
      chosen = remembered ? answers.find((a) => a.entry === remembered) ?? null : null;
    }
    const answer = chosen?.answer;
    if (!answer) {
      return Response.json({
        code: 'NOT_IMPLEMENTED',
        message: named
          ? `No route for ${key} matches this request: ${fields.map((path) => `${path}=${at(body, path)}`).join(', ')}`
          : `No route answers ${key} here: no earlier request matched for it`,
      }, { status: 501 });
    }
    return answer(request, matched);
  };
}

/**
 * What a routed handler gets besides the request: `call`, to make another
 * call by operationId, through routing; and `publish`, to send an event,
 * which is a call to publishEvent, so it goes wherever routing sends that.
 *
 * @param {Map<string, object>} routes
 * @param {object} context - applyRouting's, with `dispatch`: the mock's fetch, once it exists
 */
function handlerContext(routes, context) {
  const call = async (operationId, { params = {}, query, body, headers = {} } = {}) => {
    const found = [...routes].find(([, route]) => route.operationId === operationId || `$apis.${route.api}.${route.operationId}` === operationId);
    if (!found) throw new Error(`call: no operation "${operationId}"`);
    const [method, template] = found[0].split(' ');
    const path = template.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(params[name] ?? ''));
    const search = query ? `?${new URLSearchParams(query)}` : '';
    const response = await context.dispatch()(new Request(`http://routed.invalid${path}${search}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const text = await response.text();
    let parsed = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, body: parsed };
  };
  const eventTypes = [...new Set((context.operations?.all ?? []).map((operation) => operation.event).filter(Boolean))];
  const publish = async (event, data = {}, { subject, partitionkey = subject } = {}) => {
    const types = eventTypes.filter((type) => type === event || type.endsWith(`.${event}`));
    if (types.length !== 1) {
      throw new Error(types.length ? `publish: "${event}" could be ${types.join(' or ')}; name more of it` : `publish: no event the contracts declare is "${event}"`);
    }
    const [type] = types;
    return call('publishEvent', {
      body: {
        specversion: '1.0', id: crypto.randomUUID(), source: `/${type.split('.')[0]}`, type, subject, partitionkey,
        time: new Date().toISOString(), datacontenttype: 'application/json', data,
      },
    });
  };
  return { call, publish };
}

/**
 * Deliver an event a routed receive operation covers, in the CloudEvents HTTP
 * protocol binding's structured mode: a POST whose body is the event,
 * `application/cloudevents+json`, with its `traceparent` passed on. To `to`
 * as written — CloudEvents defines no path, so it's the URL a webhook would
 * be — or to the handler as that same request.
 *
 * Nothing waits on it, and a failure is logged and dropped: the mock has no
 * queue to retry from.
 *
 * @param {object} event - The CloudEvents envelope, as the mock stores it
 * @param {{ api: string, id: string, entry: object }} receive - From applyRouting
 * @returns {Promise<void>}
 */
export async function deliverEvent(event, { api, id, entry }) {
  const headers = new Headers({ 'content-type': 'application/cloudevents+json' });
  if (event.traceparent) headers.set('traceparent', event.traceparent);
  if (event.tracestate) headers.set('tracestate', event.tracestate);
  const request = new Request(entry.to ?? 'http://handler.invalid/', { method: 'POST', headers, body: JSON.stringify(event) });
  const name = `$apis.${api}.${id}`;
  try {
    const response = entry.handler
      ? await entry.handler(request)
      : await fetch(request, { redirect: 'manual', ...(typeof AbortSignal?.timeout === 'function' ? { signal: AbortSignal.timeout(entry.timeoutMs ?? DEFAULT_TIMEOUT_MS) } : {}) });
    if (!(response instanceof Response) || response.status >= 300) {
      console.warn(`Delivering ${event.type} for ${name} was answered ${response?.status ?? 'without a Response'}; it was not retried.`);
    }
  } catch (error) {
    console.warn(`Delivering ${event.type} for ${name} failed: ${error.message}; it was not retried.`);
  }
}
