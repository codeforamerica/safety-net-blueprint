/**
 * Starting the mock a page runs, the same way on every page: the API
 * reference's, the Scenarios page's, and the control panel's own on a page
 * that runs none.
 *
 * Its routing is the site's own: what the site's script sets on
 * BlueprintExplorer.routing (lib/site-script.js), in the mock's routing format,
 * or none, so every call stays in the page.
 *
 * Restored, it puts back what the last page left (records.js): the records,
 * with the event log, and the stubs. Started over, it forgets the stubs the
 * last mock had. Either way, what it holds is left for the next page when
 * this one is left, and `keep` leaves it sooner, after a change.
 */

import { createMockServer } from '@codeforamerica/blueprint-mock-server/server';
import { restoreRecords, saveRecords, restoreStubs, saveStubs, forgetStubs } from './records.js';

const ORIGIN = 'http://mock.invalid';

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
  const routing = globalThis.BlueprintExplorer?.routing ?? [];
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
