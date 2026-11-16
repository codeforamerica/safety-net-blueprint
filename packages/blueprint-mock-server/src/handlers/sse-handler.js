/**
 * Handler for GET /events/stream (Server-Sent Events)
 * Streams domain events to connected clients in real time.
 *
 * Each event is one SSE message: an `id:` line with the event's id and a
 * `data:` line with the event. A reader that reconnects sends the last id it
 * had in `Last-Event-ID`, as a browser's EventSource does, and is sent every
 * event after it from the log before carrying on live; an id the log doesn't
 * have is answered 410 Gone. The `type`, `source` and `subject` filters are
 * listing events' (platform-events-openapi.yaml).
 */


const HEARTBEAT_MS = 30000;

/**
 * Whether an event passes the stream's filters. `type` takes a trailing
 * wildcard, `intake.*`, as listing events does.
 *
 * @param {URLSearchParams} query
 * @returns {(event: object) => boolean}
 */
export function eventFilter(query) {
  const type = query.get('type');
  const source = query.get('source');
  const subject = query.get('subject');
  const typeMatches = !type ? () => true
    : type.endsWith('*') ? (t) => t?.startsWith(type.slice(0, -1))
      : (t) => t === type;
  return (event) => typeMatches(event.type)
    && (!source || event.source === source)
    && (!subject || event.subject === subject);
}

/**
 * The events in the log after the one with `id`, oldest first, or null when
 * the log doesn't have it. The log is in the order events were recorded.
 */
function eventsAfter(store, id) {
  const all = store.findAll('events', {}, { limit: null }).items
    .map((event, order) => ({ event, order }))
    .sort((a, b) => (a.event.time < b.event.time ? -1 : a.event.time > b.event.time ? 1 : a.order - b.order))
    .map(({ event }) => event);
  const at = all.findIndex((event) => event.id === id);
  return at === -1 ? null : all.slice(at + 1);
}

const message = (event) => `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;

/**
 * Create the SSE handler for the /events/stream endpoint.
 *
 * An event stream is a `Response` whose body is a `ReadableStream` — SSE needs
 * no streaming abstraction of its own, because the platform already has one
 * (#448 step 4). The client disconnect that `req.on('close')` used to report
 * arrives as the request's `AbortSignal`, which is where the standard puts it.
 *
 * @param {{ store?: object, instance: object }} deps - the store the event log
 *   is in, for catching up, and the mock whose events it streams (instance.js)
 * @returns {(request: Request) => Response}
 */
export function createSseHandler({ store, instance }) {
  return (request) => {
    const eventBus = instance.bus;
    const passes = eventFilter(new URL(request.url).searchParams);
    const lastEventId = request.headers.get('last-event-id');
    let missed = [];
    if (lastEventId && store) {
      missed = eventsAfter(store, lastEventId);
      if (missed === null) {
        return Response.json({
          code: 'GONE',
          message: `The event log has no event "${lastEventId}", so the events after it can't be sent. Read what you need afresh and connect without Last-Event-ID.`,
        }, { status: 410 });
      }
    }

    const encoder = new TextEncoder();
    let heartbeat;
    let listener;

    const body = new ReadableStream({
      start(controller) {
        const send = (text) => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            // The stream is already closed — the client went away between the
            // abort firing and this write. Nothing to report.
          }
        };

        // Initial comment to confirm connection
        send(': connected\n\n');

        // Heartbeat to prevent proxy timeouts
        heartbeat = setInterval(() => send(': heartbeat\n\n'), HEARTBEAT_MS);
        // Node keeps the process alive for a pending timer; a heartbeat should
        // not be a reason the server cannot exit.
        heartbeat.unref?.();

        // What was missed, then live. Both happen in this one turn, so no
        // event falls between them.
        for (const event of missed) if (passes(event)) send(message(event));
        listener = (event) => { if (passes(event)) send(message(event)); };
        eventBus.on('domain-event', listener);

        request.signal?.addEventListener('abort', () => {
          clearInterval(heartbeat);
          eventBus.off('domain-event', listener);
          try { controller.close(); } catch { /* already closed */ }
        });
      },

      cancel() {
        clearInterval(heartbeat);
        eventBus.off('domain-event', listener);
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  };
}
