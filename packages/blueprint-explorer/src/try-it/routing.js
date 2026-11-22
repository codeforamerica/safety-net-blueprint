/**
 * Where the mock in a page sends its calls: the site's routing, less the
 * entries someone switched to the mock in the page from the control panel.
 *
 * The site's routing is what its script sets on BlueprintExplorer.routing
 * (lib/site-script.js), in the mock server's routing format. With none, every
 * call is answered in the page. A switch holds for the browser tab, every page
 * of it, and a reload forgets it (lib/control-panel.js), as it does the
 * records: the default is always what the site says.
 */

/** The site's routing entries, as its script set them. */
export const siteRouting = () => globalThis.BlueprintExplorer?.routing ?? [];

/**
 * What an entry covers, in routing's own terms: an operation, an API, or a
 * domain, `*` being every domain. Each entry names exactly one.
 */
export const entryName = (entry) => entry.operation ?? entry.api ?? entry.domain;

/** An entry, told apart from the others by what it covers. */
const entryKey = (entry) => (entry.operation ? `operation:${entry.operation}` : entry.api ? `api:${entry.api}` : `domain:${entry.domain}`);

// Forgotten on a reload by the same name (lib/control-panel.js).
const keyFor = (scope) => `blueprint-mock-routing:${scope}`;

const switched = ({ scope }) => {
  try { return new Set(JSON.parse(sessionStorage.getItem(keyFor(scope)) ?? '[]')); } catch { return new Set(); }
};

/**
 * Whether an entry was switched to the mock in the page.
 *
 * @param {{ scope: string }} where
 * @param {object} entry - One of siteRouting's
 */
export const inPage = (where, entry) => switched(where).has(entryKey(entry));

/**
 * Switch an entry to the mock in the page, or back to where the site sends it.
 * The mock takes it when it next starts (start-mock.js).
 *
 * @param {{ scope: string }} where
 * @param {object} entry - One of siteRouting's
 * @param {boolean} toPage
 */
export function switchEntry(where, entry, toPage) {
  const keys = switched(where);
  if (toPage) keys.add(entryKey(entry)); else keys.delete(entryKey(entry));
  try { sessionStorage.setItem(keyFor(where.scope), JSON.stringify([...keys])); } catch { /* the switch lasts this page only */ }
}

// ── A server chosen in the page ──────────────────────────────────────────────
//
// As Swagger's server list does, the reader can send calls out of the page:
// to a URL they type, which takes every call (a `*` entry: a local mock
// server, a staging host serving every API), or to an environment the
// contracts' `servers` name by description ("Production server"), which sends
// each API to its own server for it. The site's own entries are narrower or
// left as they are, so they still win, and one switched to the page stays in
// the page. Kept for the tab, and forgotten on a reload, as the switches are.

const serverKeyFor = (scope) => `blueprint-mock-server:${scope}`;

/** Marks an entry the chosen server added, with where it goes, in words. */
const CHOSEN = Symbol('chosen server');

/**
 * The server chosen in the page, if any.
 *
 * @param {{ scope: string }} where
 * @returns {{ url: string } | { environment: string, variables?: Record<string, string> } | null}
 */
export function chosenServer({ scope }) {
  try { return JSON.parse(sessionStorage.getItem(serverKeyFor(scope)) ?? 'null'); } catch { return null; }
}

/**
 * Choose a server for the page's calls, or the page itself with null. The mock
 * takes it when it next starts.
 */
export function chooseServer({ scope }, choice) {
  try {
    if (choice) sessionStorage.setItem(serverKeyFor(scope), JSON.stringify(choice));
    else sessionStorage.removeItem(serverKeyFor(scope));
  } catch { /* the choice lasts this page only */ }
}

/** Where the page's mock serves an API: its localhost server's path. */
const localBaseOf = (doc) => {
  const local = (doc.content?.servers ?? []).find((server) => /localhost|127\.0\.0\.1/.test(server?.url ?? ''));
  try { return local ? new URL(local.url).pathname.replace(/\/$/, '') : ''; } catch { return ''; }
};

/** A server URL with its variables filled in: the ones given, else each one's default. */
export const expandServer = (server, given = {}) => String(server.url ?? '')
  .replace(/\{([^}]+)\}/g, (_, name) => given[name] ?? server.variables?.[name]?.default ?? `{${name}}`);

/**
 * The environments the contracts' servers name, each with every API that has
 * a server for it, and the variables those servers take.
 *
 * @param {object[]} docs
 * @returns {Array<{ description: string, apis: Array<{ api: string, domain: string|null, server: object, localBase: string }>, variables: Record<string, object> }>}
 */
export function environmentsOf(docs) {
  const byDescription = new Map();
  for (const doc of docs.filter((d) => d.type === 'openapi' && d.api)) {
    for (const server of doc.content?.servers ?? []) {
      if (!server?.description || !server.url) continue;
      if (!byDescription.has(server.description)) byDescription.set(server.description, { description: server.description, apis: [], variables: {} });
      const environment = byDescription.get(server.description);
      if (environment.apis.some((a) => a.api === doc.api)) continue;
      environment.apis.push({ api: doc.api, domain: doc.domain ?? null, server, localBase: localBaseOf(doc) });
      Object.assign(environment.variables, server.variables ?? {});
    }
  }
  return [...byDescription.values()];
}

/** The APIs an entry covers, as an except names them. */
const exceptFor = (entry, docs) => (entry.operation ? [{ operation: entry.operation }]
  : entry.api ? [{ api: entry.api }]
  : docs.filter((d) => d.type === 'openapi' && d.domain === entry.domain).map((d) => ({ api: d.api })));

/** A handler sending one API's calls to its server for an environment, with the page's path for it taken off. */
const toServer = ({ server, localBase }, variables) => async (request) => {
  const incoming = new URL(request.url);
  const rest = incoming.pathname.startsWith(localBase) ? incoming.pathname.slice(localBase.length) : incoming.pathname;
  const target = `${expandServer(server, variables).replace(/\/$/, '')}${rest}${incoming.search}`;
  // Read first: a request's stream as a body needs HTTP/2 in Chrome.
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
  try {
    return await fetch(target, { method: request.method, headers: request.headers, body });
  } catch (error) {
    // A browser says only "Failed to fetch" when the server doesn't allow the page's address.
    return Response.json({
      code: 'BAD_GATEWAY',
      message: `Could not reach ${new URL(target).origin}: ${error.message}. The server may not allow calls from this page (CORS), or may be down or unreachable from here.`,
    }, { status: 502 });
  }
};

/**
 * The routing the mock takes: the site's, less what was switched to the
 * page, and what the server chosen in the page adds.
 *
 * @param {{ scope: string }} where
 * @param {object[]} [docs] - The contract set, which a chosen server needs
 * @returns {object[]}
 */
export function routingInUse(where, docs = []) {
  const site = siteRouting();
  const kept = site.filter((entry) => !inPage(where, entry));
  const choice = chosenServer(where);
  if (!choice) return kept;
  const narrower = site.filter((entry) => entry.domain !== '*');
  const sockets = docs.filter((d) => d.type === 'asyncapi' && d.protocols?.includes('ws')).map((d) => ({ api: d.api }));
  if (choice.url) {
    // Every call, but what the site switched to the page and the sockets, which go where their own server says.
    const except = [...site.filter((entry) => entry.domain !== '*' && inPage(where, entry)).flatMap((entry) => exceptFor(entry, docs)), ...sockets];
    const everything = { domain: '*', to: choice.url, ...(except.length ? { except } : {}) };
    everything[CHOSEN] = choice.url;
    return [...kept.filter((entry) => entry.domain !== '*'), everything];
  }
  const environment = environmentsOf(docs).find((e) => e.description === choice.environment);
  if (!environment) return kept;
  const added = environment.apis
    // An API the site routes, or switched to the page, stays as the site has it.
    .filter((a) => !entryFor(narrower, { api: a.api, domain: a.domain }))
    .map((a) => {
      const entry = { api: a.api, handler: toServer(a, choice.variables) };
      entry[CHOSEN] = expandServer(a.server, choice.variables);
      return entry;
    });
  return [...kept, ...added];
}

/**
 * The entry that sends an operation out of the page, if any: the narrowest
 * that covers it, as the mock's routing chooses — an operation over an API,
 * an API over a domain, a domain over everything.
 *
 * @param {object[]} routing - As routingInUse gives it
 * @param {{ operationId?: string, api?: string|null, domain?: string|null }} operation
 * @returns {object|null}
 */
export function entryFor(routing, { operationId, api, domain }) {
  // Asked about a whole API, with no operation, nothing names it by operation.
  const named = (entry) => Boolean(operationId && entry.operation) && (entry.operation === operationId || entry.operation === `$apis.${api}.${operationId}`);
  // An entry's except leaves those APIs and operations in the page.
  const covers = (entry) => !(entry.except ?? []).some((left) => left.api === api || named(left));
  return routing.find(named)
    ?? routing.find((entry) => !entry.operation && entry.api && entry.api === api && covers(entry))
    ?? routing.find((entry) => entry.domain && entry.domain !== '*' && entry.domain === domain && covers(entry))
    ?? routing.find((entry) => entry.domain === '*' && covers(entry))
    ?? null;
}

/** Where an entry sends its calls, in words. */
export const destinationOf = (entry) => entry[CHOSEN] ?? (entry.to ? entry.to : 'a handler in this site\'s script');

/** Whether an entry is one the server chosen in the page added. */
export const fromChosenServer = (entry) => Boolean(entry?.[CHOSEN]);

/** Whether a URL is this machine's: calls to it change nothing anyone else sees. */
export const isLocal = (url) => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname); } catch { return false; } };

/**
 * Where the server chosen in the page sends calls, when that isn't this
 * machine: what to name before a scenario runs many calls there, creating
 * and changing records. Null with no server chosen, or a local one.
 *
 * @param {{ scope: string }} where
 * @param {object[]} docs
 * @returns {string|null}
 */
export function awayFrom(where, docs) {
  // Each host once: APIs on one host are one place to the reader.
  const origin = (url) => { try { return new URL(url).origin; } catch { return url; } };
  const away = routingInUse(where, docs).filter(fromChosenServer).map(destinationOf).filter((url) => !isLocal(url)).map(origin);
  return away.length ? [...new Set(away)].join(', ') : null;
}
