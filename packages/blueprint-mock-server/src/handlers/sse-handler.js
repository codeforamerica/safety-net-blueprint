/**
 * Handler for GET /events/stream (Server-Sent Events)
 * Streams domain events to connected clients in real time.
 */

import { eventBus } from '../event-bus.js';

/**
 * Create SSE handler for the /events/stream endpoint.
 * @returns {Function} Express handler
 */
export function createSseHandler() {
  return (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Initial comment to confirm connection
    res.write(': connected\n\n');

    // Heartbeat every 30s to prevent proxy timeouts
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30000);

    const listener = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventBus.on('domain-event', listener);

    req.on('close', () => {
      clearInterval(heartbeat);
      eventBus.off('domain-event', listener);
    });
  };
}
