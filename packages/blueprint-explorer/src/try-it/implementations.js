/**
 * APIs the explorer can answer with an implementation running in the page,
 * in place of the mock's stubs or a real service: chosen per API in the
 * control panel's "Where calls go" (routing.js).
 *
 * Each is a routing entry's handler, in the mock server's routing format, so
 * the mock still checks what it answers against the contract.
 */

import { InPageRelay } from './in-page-relay.js';

/** @type {Array<{ api: string, name: string, handler: Function, note?: string }>} */
export const IMPLEMENTATIONS = [
  {
    api: 'communication-transcripts-relay',
    name: 'Relay in this page',
    handler: InPageRelay,
    note: 'It transcribes English with Whisper, running in this page: the first time, it downloads about 47 MB, and the audio never leaves the page.',
  },
];
