/**
 * The mock client: the APIs a page keeps, run in the page, with everything
 * else sent to the server. The server's side is server.js.
 *
 * The same engine and the same options as createMockServer. What makes it the
 * client is its routing: an entry for every domain sends the rest to the
 * server, and its except keeps what the page runs itself.
 *
 *   import { createMockClient } from '@codeforamerica/blueprint-mock-server/client';
 *
 *   const contracts = await (await fetch('./contracts.json')).json();
 *   const client = await createMockClient({
 *     contracts,
 *     routing: [{
 *       domain: '*',
 *       to: 'https://api.example.gov',
 *       except: [{ api: 'communication-transcription-sessions' }],
 *       includeHeaders: ['Authorization'],
 *     }],
 *   });
 *
 *   // The generated SDK sends its requests through it.
 *   const sdk = createClient({ baseUrl: location.origin, fetch: client.fetch });
 *
 * A server's state is the records it was seeded with; a client's is the page's
 * own, so it starts with none.
 */

import { createMockServer } from './server.js';

/**
 * Build a mock client from a contracts artifact.
 *
 * @param {Parameters<typeof createMockServer>[0]} options - As for
 *   createMockServer, except that `seed` defaults to false
 * @returns {ReturnType<typeof createMockServer>}
 */
export function createMockClient({ seed = false, ...options } = {}) {
  return createMockServer({ seed, ...options });
}
