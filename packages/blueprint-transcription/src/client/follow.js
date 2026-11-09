/**
 * Following a session's events through the platform's events SDK, generated
 * from platform-events-openapi.yaml: `streamEvents`, and `listEvents` polled
 * when the server has no stream (it answers 404, 405 or 501), as the contract
 * offers.
 *
 * The generated stream reconnects with Last-Event-ID on its own, but it also
 * retries HTTP errors forever (hey-api/hey-api#4471, which we added 501 to)
 * and doesn't reopen a stream that ended (hey-api/hey-api#4490, which we
 * opened and offered a pull request for), unlike EventSource. So it's given a
 * `fetch` that watches each answer's status, and opened again when it ends,
 * with the last id. When hey-api fixes either, upgrade @hey-api/openapi-ts
 * and remove that part here.
 */

const NO_STREAM = new Set([404, 405, 501]);
const POLL_MS = 2000;
const REOPEN_MS = 1000;

/**
 * @param {object} options
 * @param {{ streamEvents: Function, listEvents: Function }} options.events - the platform events SDK
 * @param {(request: Request) => Promise<Response>} [options.fetch] - the fetch its client is configured with
 * @param {Record<string, string>} options.filters - `type`, `source`, `subject`, as listing events takes them
 * @param {(event: object) => void} options.onEvent - each event, once, in order
 * @returns {{ stop: () => void }}
 */
export function followEvents({ events, fetch: send = (request) => globalThis.fetch(request), filters, onEvent }) {
  const stopped = new AbortController();
  const seen = new Set();
  let lastId;
  let lastTime;

  const take = (event) => {
    if (!event?.id || seen.has(event.id)) return;
    seen.add(event.id);
    lastId = event.id;
    lastTime = event.time ?? lastTime;
    onEvent(event);
  };
  // Following never keeps a Node process alive on its own; a page doesn't mind.
  const wait = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    stopped.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

  /** One stream, until it ends. What the server answered, when it refused. */
  async function stream() {
    const connection = new AbortController();
    stopped.signal.addEventListener('abort', () => connection.abort(), { once: true });
    let refused = null;
    const { stream: messages } = await events.streamEvents({
      query: filters,
      signal: connection.signal,
      headers: lastId ? { 'Last-Event-ID': lastId } : undefined,
      // Its waits between retries end when this stream does.
      sseSleepFn: (ms) => new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
        connection.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      }),
      // Its first answer decides: a refusal ends this stream here.
      fetch: async (request) => {
        const response = await send(request);
        if (!response.ok) { refused = response.status; connection.abort(); }
        return response;
      },
    });
    try {
      for await (const event of messages) take(event);
    } catch { /* ended by the abort above, or by stop */ }
    return refused;
  }

  async function poll() {
    const { data } = await events.listEvents({ query: { ...filters, ...(lastTime && { start: lastTime }), limit: 100 } });
    for (const event of data?.items ?? []) take(event);
  }

  (async () => {
    let polling = false;
    while (!stopped.signal.aborted) {
      try {
        if (polling) {
          await poll();
          await wait(POLL_MS);
          continue;
        }
        const refused = await stream();
        if (NO_STREAM.has(refused)) polling = true;
        // The log no longer has the last event: from now on.
        else if (refused === 410) lastId = undefined;
        if (!polling) await wait(REOPEN_MS);
      } catch {
        await wait(REOPEN_MS);
      }
    }
  })();

  return { stop: () => stopped.abort() };
}
