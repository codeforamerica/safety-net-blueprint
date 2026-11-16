/**
 * Changes to one record take turns: an action or reaction on a record runs to
 * completion before the next on that record starts, and the next reads the
 * record as it was left, its `from` and guards checked then
 * (state-machine-schema.yaml, actions). Without it, a reaction arriving while
 * an action waits on a call reads the record as the action found it, and both
 * change it: the session's close and the transcript's closed event each
 * closed the session, and `closed` was sent twice.
 *
 * Work on a record that's free starts at once, so an action or reaction that
 * makes no calls still runs and finishes synchronously.
 */

const keyOf = (collection, id) => `${collection}/${id}`;

/**
 * What's changing the record now, settling when it's done; undefined when
 * nothing is.
 *
 * @param {object} instance - The mock instance (instance.js)
 * @param {string} collection
 * @param {string} id
 * @returns {Promise<void>|undefined}
 */
export function busyWith(instance, collection, id) {
  return instance.changing.get(keyOf(collection, id));
}

/**
 * Take the record's turn. Call what's returned to give it up; calling it again
 * does nothing.
 *
 * @param {object} instance
 * @param {string} collection
 * @param {string} id
 * @returns {() => void}
 */
export function takeTurn(instance, collection, id) {
  const key = keyOf(collection, id);
  let done;
  const turn = new Promise((resolve) => { done = resolve; });
  instance.changing.set(key, turn);
  let given = false;
  return () => {
    if (given) return;
    given = true;
    if (instance.changing.get(key) === turn) instance.changing.delete(key);
    done();
  };
}

/**
 * Wait until nothing is changing the record, then take its turn: at once,
 * with no wait, when it's free.
 *
 * @returns {Promise<() => void>|(() => void)}
 */
export function whenFree(instance, collection, id) {
  const busy = busyWith(instance, collection, id);
  if (!busy) return takeTurn(instance, collection, id);
  return busy.then(() => whenFree(instance, collection, id));
}
