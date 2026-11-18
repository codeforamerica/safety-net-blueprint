/**
 * The mock's records, carried from one explorer page to the next.
 *
 * Each page that runs the mock starts its own, so what one page did would be
 * gone on the next. Instead a page saves the store when it is left and the
 * next restores it, through the tab's session storage: records, the event log
 * and idempotency keys all live in the store. Stubs, open event streams and a
 * scenario partway through a run do not carry.
 *
 * Saved under the explorer's own address, so two explorers on one site keep
 * their records apart, and with the contract set's version, so records saved
 * against contracts that have since been rebuilt are not restored.
 *
 * A reload starts fresh: it is how someone gets back to the sample records,
 * so only going from page to page carries them.
 */

/** Whether this page was reached by reloading it. */
const reloaded = () => {
  try { return performance.getEntriesByType('navigation')[0]?.type === 'reload'; } catch { return false; }
};

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
