/**
 * The mock's records, carried from one explorer page to the next.
 *
 * Each page that runs the mock starts its own, so what one page did would be
 * gone on the next. Instead a page saves the store when it is left and the
 * next restores it, through the tab's session storage: records, the event log
 * and idempotency keys all live in the store. Stubs carry too, saved after
 * each request, since a request can register, remove or use one up. Open
 * event streams and a scenario partway through a run do not carry.
 *
 * Saved under the explorer's own address, so two explorers on one site keep
 * their records apart, and with the contract set's version, so records saved
 * against contracts that have since been rebuilt are not restored.
 *
 * A reload starts fresh: it is how someone gets back to the sample records,
 * so only going from page to page carries them. What each operation last sent
 * and got back is kept the same way, per page.
 */

/** Whether this page was reached by reloading it. */
const reloaded = () => {
  try { return performance.getEntriesByType('navigation')[0]?.type === 'reload'; } catch { return false; }
};

// Every page forgets these on a reload, those that run no mock too, by the
// same names (lib/control-panel.js).
const keyFor = (scope) => `blueprint-mock-records:${scope}`;

/**
 * Put back what an earlier page left, if it was saved against the same
 * contracts. Collections the saved records don't have are emptied, so a page
 * left empty stays empty.
 *
 * @param {{ store: object }} mock
 * @param {{ scope: string, version: string }} where
 * @returns {boolean} Whether anything was restored
 */
export function restoreRecords(mock, { scope, version }) {
  if (reloaded()) return false;
  let saved;
  try {
    saved = JSON.parse(sessionStorage.getItem(keyFor(scope)) ?? 'null');
  } catch (error) {
    console.warn(`Records from the last page could not be read: ${error.message}`);
    return false;
  }
  if (!saved || saved.version !== version) return false;
  for (const collection of Object.keys(mock.store.snapshot())) {
    if (!(collection in saved.records)) mock.store.clearAll(collection);
  }
  mock.store.restore(saved.records);
  return true;
}

/**
 * Save the mock's records for the next page.
 *
 * @param {{ store: object }} mock
 * @param {{ scope: string, version: string }} where
 */
export function saveRecords(mock, { scope, version }) {
  try {
    sessionStorage.setItem(keyFor(scope), JSON.stringify({ version, records: mock.store.snapshot() }));
  } catch (error) {
    console.warn(`Records could not be saved for the next page: ${error.message}`);
  }
}

// ── Stubs ─────────────────────────────────────────────────────────────────────
// The mock keeps its stubs outside the store, so they are read and put back
// through its own routes: listed after each request, registered again when
// the next page's mock starts.

const STUB_KINDS = ['events', 'http'];
const stubKeyFor = (scope) => `blueprint-mock-stubs:${scope}`;

/**
 * Save the stubs the mock holds for the next page.
 *
 * @param {(method: string, path: string, options?: object) => Promise<Response>} send - A request to the page's mock
 * @param {{ scope: string, version: string }} where
 */
export async function saveStubs(send, { scope, version }) {
  try {
    const stubs = {};
    for (const kind of STUB_KINDS) {
      const response = await send('GET', `/mock/stubs/${kind}`);
      stubs[kind] = response.ok ? (await response.json())?.items ?? [] : [];
    }
    sessionStorage.setItem(stubKeyFor(scope), JSON.stringify({ version, stubs }));
  } catch (error) {
    console.warn(`Stubs could not be saved for the next page: ${error.message}`);
  }
}

/**
 * Register again the stubs an earlier page left, in the order they were
 * registered, if they were saved against the same contracts.
 *
 * @param {(method: string, path: string, options?: object) => Promise<Response>} send - A request to the page's mock
 * @param {{ scope: string, version: string }} where
 * @returns {Promise<number>} How many were registered
 */
export async function restoreStubs(send, { scope, version }) {
  // A reload starts fresh, so the next page mustn't put them back either.
  if (reloaded()) {
    forgetStubs({ scope });
    return 0;
  }
  let saved;
  try {
    saved = JSON.parse(sessionStorage.getItem(stubKeyFor(scope)) ?? 'null');
  } catch { return 0; }
  if (!saved || saved.version !== version) return 0;
  let count = 0;
  for (const kind of STUB_KINDS) {
    for (const { id, ...stub } of saved.stubs?.[kind] ?? []) {
      const response = await send('POST', `/mock/stubs/${kind}`, { body: JSON.stringify(stub) });
      if (response.ok) count += 1;
      else console.warn(`A ${kind} stub from the last page could not be registered again: ${await response.text()}`);
    }
  }
  return count;
}

/** Forget the saved stubs: the mock was started over. */
export function forgetStubs({ scope }) {
  try { sessionStorage.removeItem(stubKeyFor(scope)); } catch { /* nothing saved */ }
}

// ── Results ───────────────────────────────────────────────────────────────────
// What each operation on a page last sent and got back, so following a link
// from a result and coming back finds it as it was. Kept per page; a reload
// starts fresh, as it does for records, on every page: another page's results
// name records the fresh mock doesn't have.

const resultsPrefix = (scope) => `blueprint-try-results:${scope}:`;
const resultsKeyFor = (scope) => resultsPrefix(scope) + location.pathname;

/**
 * @param {{ scope: string }} where
 * @returns {Record<string, object>} Each operation's last result, by its element id
 */
export function loadResults({ scope }) {
  if (reloaded()) {
    try {
      const keys = Object.keys(sessionStorage).filter((key) => key.startsWith(resultsPrefix(scope)));
      for (const key of keys) sessionStorage.removeItem(key);
    } catch { /* nothing saved */ }
    return {};
  }
  try { return JSON.parse(sessionStorage.getItem(resultsKeyFor(scope)) ?? 'null') ?? {}; } catch { return {}; }
}

/**
 * @param {{ scope: string }} where
 * @param {Record<string, object>} results
 */
export function saveResults({ scope }, results) {
  try {
    sessionStorage.setItem(resultsKeyFor(scope), JSON.stringify(results));
  } catch (error) {
    console.warn(`Results could not be kept for coming back: ${error.message}`);
  }
}
