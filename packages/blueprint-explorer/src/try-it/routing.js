/**
 * Where the mock in a page sends its calls: the site's routing, and what a
 * server chosen in the control panel adds.
 *
 * The site's routing is what BlueprintExplorer.routing holds, in the mock
 * server's routing format: the routing file config.yaml names, bundled with
 * its handler modules (lib/site-routing.js), and whatever the site's script
 * adds (lib/site-script.js). With none, every call is answered in the page.
 * Where an API has several implementations, such as a transcription session
 * adapter for each service, each entry's match picks one per request: a
 * session's profile chooses its adapter.
 */

/** The site's routing entries, as its script set them. */
export const siteRouting = () => globalThis.BlueprintExplorer?.routing ?? [];

/**
 * What an entry covers, in routing's own terms: an operation, an API, or a
 * domain, `*` being every domain. Each entry names exactly one.
 */
export const entryName = (entry) => entry.operation ?? entry.api ?? entry.domain;

/**
 * An entry's match, in words: `provider: whisper`. Entries for the same API
 * with different matches are different implementations of it.
 */
export const matchText = (entry) => Object.entries(entry.match ?? {})
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, value]) => `${path}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
  .join(', ');

/**
 * The file a site's routing names as an entry's handler, which the build
 * keeps beside the bundled module (lib/site-routing.js), so the control
 * panel can say what answers each entry.
 */
export const HANDLER_FILE = Symbol.for('blueprint-explorer.handler-file');

// ── A server chosen in the page ──────────────────────────────────────────────
//
// As Swagger's server list does, the reader can send calls out of the page:
// to a URL they type, which takes every call (a `*` entry: a local mock
// server, a staging host serving every API), or to an environment the
// contracts' `servers` name by description ("Production server"), which sends
// each API to its own server for it. The site's own entries are narrower or
// left as they are, so they still win. Kept for the tab, and forgotten on a
// reload, as the records are.

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

const METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'];

/**
 * The headers an API's contract says its calls carry, lowercased: its header
 * parameters, the headers its security schemes name (`Authorization` for a
 * bearer token, OAuth or OpenID Connect; an API key's own header), and
 * `Content-Type` and `Accept`, which OpenAPI gives as bodies and responses.
 * Others the page adds, such as the mock's caller headers (X-Caller-Id), are
 * no server's: a real one's CORS would refuse the call over them.
 */
export function declaredHeaders(doc, docs) {
  const found = new Set(['accept', 'content-type']);
  const parameter = (node) => {
    if (typeof node?.$ref !== 'string') return node;
    if (node.$ref.startsWith('#/')) return node.$ref.slice(2).split('/').reduce((at, key) => at?.[key], doc.content);
    return doc.resolveRef?.(node.$ref, docs);
  };
  for (const item of Object.values(doc.content?.paths ?? {})) {
    for (const operation of [item, ...METHODS.map((method) => item?.[method])]) {
      for (const each of operation?.parameters ?? []) {
        const resolved = parameter(each);
        if (resolved?.in === 'header' && resolved.name) found.add(resolved.name.toLowerCase());
      }
    }
  }
  for (const scheme of Object.values(doc.content?.components?.securitySchemes ?? {})) {
    if (['http', 'oauth2', 'openIdConnect'].includes(scheme?.type)) found.add('authorization');
    if (scheme?.type === 'apiKey' && scheme.in === 'header' && scheme.name) found.add(scheme.name.toLowerCase());
  }
  return found;
}

/**
 * The environments the contracts' servers name, each with every API that has
 * a server for it, and the variables those servers take.
 *
 * @param {object[]} docs
 * @returns {Array<{ description: string, apis: Array<{ api: string, domain: string|null, server: object, localBase: string, headers: Set<string> }>, variables: Record<string, object> }>}
 */
export function environmentsOf(docs) {
  const byDescription = new Map();
  for (const doc of docs.filter((d) => d.type === 'openapi' && d.api)) {
    for (const server of doc.content?.servers ?? []) {
      if (!server?.description || !server.url) continue;
      if (!byDescription.has(server.description)) byDescription.set(server.description, { description: server.description, apis: [], variables: {} });
      const environment = byDescription.get(server.description);
      if (environment.apis.some((a) => a.api === doc.api)) continue;
      environment.apis.push({ api: doc.api, domain: doc.domain ?? null, server, localBase: localBaseOf(doc), headers: declaredHeaders(doc, docs) });
      Object.assign(environment.variables, server.variables ?? {});
    }
  }
  return [...byDescription.values()];
}

/**
 * A handler sending one API's calls to its server for an environment, with
 * the page's path for it taken off, and only the headers its contract declares.
 */
const toServer = ({ server, localBase, headers: declared }, variables) => async (request) => {
  const incoming = new URL(request.url);
  const rest = incoming.pathname.startsWith(localBase) ? incoming.pathname.slice(localBase.length) : incoming.pathname;
  const target = `${expandServer(server, variables).replace(/\/$/, '')}${rest}${incoming.search}`;
  // Read first: a request's stream as a body needs HTTP/2 in Chrome.
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
  try {
    const headers = [...request.headers].filter(([name]) => declared.has(name.toLowerCase()));
    return await fetch(target, { method: request.method, headers, body });
  } catch (error) {
    // A browser says only "Failed to fetch" when the server doesn't allow the page's address.
    return Response.json({
      code: 'BAD_GATEWAY',
      message: `Could not reach ${new URL(target).origin}: ${error.message}. The server may not allow calls from this page (CORS), or may be down or unreachable from here.`,
    }, { status: 502 });
  }
};

/**
 * The routing the mock takes: the site's, and what the server chosen in the
 * page adds.
 *
 * @param {{ scope: string }} where
 * @param {object[]} [docs] - The contract set, which a chosen server needs
 * @returns {object[]}
 */
export function routingInUse(where, docs = []) {
  const site = siteRouting();
  const choice = chosenServer(where);
  if (!choice) return site;
  const narrower = site.filter((entry) => entry.domain !== '*');
  if (choice.url) {
    // Every call the site's narrower entries leave.
    const everything = { domain: '*', to: choice.url };
    everything[CHOSEN] = choice.url;
    return [...narrower, everything];
  }
  const environment = environmentsOf(docs).find((e) => e.description === choice.environment);
  if (!environment) return site;
  const added = environment.apis
    // An API the site routes stays as the site has it.
    .filter((a) => !entryFor(narrower, { api: a.api, domain: a.domain }))
    .map((a) => {
      const entry = { api: a.api, handler: toServer(a, choice.variables) };
      entry[CHOSEN] = expandServer(a.server, choice.variables);
      return entry;
    });
  return [...site, ...added];
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
export const destinationOf = (entry) => entry[CHOSEN] ?? entry.to ?? entry[HANDLER_FILE] ?? 'a handler in the site\'s script';

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
