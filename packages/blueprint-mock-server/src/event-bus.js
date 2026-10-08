/**
 * In-memory event bus for broadcasting domain events to SSE clients.
 * Singleton shared across all handlers in the same process, or in the page.
 *
 * Hand-rolled rather than `node:events` because this is three methods and the
 * import was the only thing binding the event stream to Node (#448). It keeps
 * `EventEmitter`'s contract for the two calls anything here makes — `on`/`off`
 * with the same listener identity, and `emit` broadcasting to all of them.
 */

/** @type {Map<string, Set<Function>>} */
const listeners = new Map();

const eventBus = {
  /**
   * @param {string} event
   * @param {Function} listener
   */
  on(event, listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);
    return eventBus;
  },

  /**
   * @param {string} event
   * @param {Function} listener - The same reference passed to `on`
   */
  off(event, listener) {
    listeners.get(event)?.delete(listener);
    return eventBus;
  },

  /**
   * @param {string} event
   * @param {...unknown} args
   * @returns {boolean} Whether anything was listening
   */
  emit(event, ...args) {
    const registered = listeners.get(event);
    if (!registered || registered.size === 0) return false;
    // Iterate a copy: a listener that unsubscribes itself while handling an
    // event would otherwise mutate the set mid-iteration.
    for (const listener of [...registered]) {
      try {
        listener(...args);
      } catch (error) {
        // One subscriber throwing must not stop the others, and must not
        // escape into whatever emitted the event.
        console.error(`Event listener for "${event}" threw:`, error);
      }
    }
    return true;
  },

  /** @param {string} event */
  listenerCount(event) {
    return listeners.get(event)?.size ?? 0;
  },

  /**
   * Drop every listener, or every listener for one event.
   *
   * @param {string} [event] - All events when omitted
   */
  removeAllListeners(event) {
    if (event === undefined) listeners.clear();
    else listeners.delete(event);
    return eventBus;
  },

  /** No-op, kept so callers written against EventEmitter still work. */
  setMaxListeners() {
    return eventBus;
  },
};

export { eventBus };
