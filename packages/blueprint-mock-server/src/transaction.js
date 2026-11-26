/**
 * A transaction over one domain's records, as a service that owns the domain
 * would make one: an action, or a reaction to an event, and every call it
 * makes to its own domain, happen together or not at all.
 *
 * Two parts, as a database with a transactional outbox has them:
 *
 * - **An undo log** (undo-log.js) of the writes to the domain's collections,
 *   and of its events as they're saved. A rollback puts back every record
 *   they changed, the action's own and the ones its calls changed.
 * - **A hold on its events** (event-bus.js), so nothing hears them until the
 *   transaction commits, and nothing ever does if it rolls back. Its events
 *   are the domain's events it caused: the one named `cause` — an action's
 *   first event — and every event of the domain whose `causationid` names
 *   one of them. An event anyone else sends meanwhile passes through.
 *
 * Another domain is another service, which a real one couldn't roll back: a
 * call to it is done once it succeeds, and its events go out. A contract that
 * has to undo it handles the failure with `catch:` and calls what undoes it.
 */

import { openUndoLog } from './undo-log.js';
import { EVENTS_COLLECTION } from './emit-event.js';

/**
 * Open a transaction over a domain's records and events.
 *
 * @param {{ store: object, instance: object, domain: string, cause: string }} options -
 *   `cause` is the id of the action's first event, or of the event a reaction
 *   reacts to
 * @returns {{ commit: () => void, rollback: () => void }}
 */
export function openTransaction({ store, instance, domain, cause }) {
  const source = `/${domain}`;
  const ours = new Set([cause]);
  // An event of the domain this caused, which then causes others in turn.
  const caused = (event) => {
    if (event?.source !== source || !(ours.has(event.id) || ours.has(event.causationid))) return false;
    ours.add(event.id);
    return true;
  };
  const undo = openUndoLog(store, {
    only: (collection, record) => (collection === EVENTS_COLLECTION ? caused(record) : collection.startsWith(`${domain}/`)),
  });
  const events = instance.bus.hold(caused);
  // Closed once: a second commit or rollback does nothing.
  let open = true;
  return {
    commit() {
      if (!open) return;
      open = false;
      undo.commit();
      events.release();
    },
    rollback() {
      if (!open) return;
      open = false;
      undo.rollback();
      events.discard();
    },
  };
}
