/**
 * Handler for GET /events/stream (Server-Sent Events)
 * Streams domain events to connected clients in real time.
 */

import { eventBus } from '../event-bus.js';

const HEARTBEAT_MS = 30000;

/**
 * Create the SSE handler for the /events/stream endpoint.
 *
 * An event stream is a `Response` whose body is a `ReadableStream` — SSE needs
 * no streaming abstraction of its own, because the platform already has one
 * (#448 step 4). The client disconnect that `req.on('close')` used to report
 * arrives as the request's `AbortSignal`, which is where the standard puts it.
 *
 * @returns {(request: Request) => Response}
 */
export function createSseHandler() {
  return (request) => {
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

        listener = (event) => send(`data: ${JSON.stringify(event)}\n\n`);
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
