/**
 * In-memory event bus for broadcasting domain events to SSE clients.
 * Singleton shared across all handlers in the same process.
 */

import { EventEmitter } from 'events';

const eventBus = new EventEmitter();

// Support many concurrent SSE clients without warnings
eventBus.setMaxListeners(200);

export { eventBus };
