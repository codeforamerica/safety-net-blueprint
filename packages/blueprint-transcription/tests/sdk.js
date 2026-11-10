/**
 * The SDK the driver is given, generated from the harness's contracts by
 * `npm run sdk` (scripts/generate-sdk.js), with its clients configured as a
 * page configures its own: where each API is served, who's calling, and the
 * in-page mock's fetch.
 */

import * as sessions from '../generated/sdk/communication-transcription-sessions/index.ts';
import { client as sessionsClient } from '../generated/sdk/communication-transcription-sessions/client.gen.ts';
import * as transcripts from '../generated/sdk/communication-transcripts/index.ts';
import { client as transcriptsClient } from '../generated/sdk/communication-transcripts/client.gen.ts';
import * as events from '../generated/sdk/platform-events/index.ts';
import { client as eventsClient } from '../generated/sdk/platform-events/client.gen.ts';

/**
 * @param {(request: Request) => Promise<Response>} fetch
 * @param {Record<string, string>} [headers]
 */
export function sdkFor(fetch, headers = { 'x-caller-id': 'worker-1' }) {
  sessionsClient.setConfig({ baseUrl: 'http://localhost/communication', fetch, headers });
  transcriptsClient.setConfig({ baseUrl: 'http://localhost/communication', fetch, headers });
  eventsClient.setConfig({ baseUrl: 'http://localhost/platform', fetch, headers });
  return { sessions, transcripts, events, fetch };
}
