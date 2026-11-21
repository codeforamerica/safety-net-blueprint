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

/**
 * The routing the mock takes: the site's, less what was switched to the page.
 *
 * @param {{ scope: string }} where
 * @returns {object[]}
 */
export const routingInUse = (where) => siteRouting().filter((entry) => !inPage(where, entry));

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
  const named = (entry) => entry.operation === operationId || entry.operation === `$apis.${api}.${operationId}`;
  // An entry's except leaves those APIs and operations in the page.
  const covers = (entry) => !(entry.except ?? []).some((left) => left.api === api || named(left));
  return routing.find(named)
    ?? routing.find((entry) => !entry.operation && entry.api && entry.api === api && covers(entry))
    ?? routing.find((entry) => entry.domain && entry.domain !== '*' && entry.domain === domain && covers(entry))
    ?? routing.find((entry) => entry.domain === '*' && covers(entry))
    ?? null;
}

/** Where an entry sends its calls, in words. */
export const destinationOf = (entry) => (entry.to ? entry.to : 'a handler in this site\'s script');
