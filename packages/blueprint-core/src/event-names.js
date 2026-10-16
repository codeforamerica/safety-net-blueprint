/**
 * What an event is called: `domain.resource.event`.
 *
 * The domain as the set declares it (`case-management`), the resource as its
 * schema is named, in snake_case (`ApplicationMember` → `application_member`),
 * and the event by its own name (`created`, `paused`, `auto_resumed`). Every
 * event a resource sends is named this way — the create, update and delete
 * events of any resource, and the events its state machine declares under
 * `emits:` — so an event's name always says which resource sent it.
 *
 * A state machine's steps name an event of their own machine by its short name
 * (`emit: paused`), and the full name is worked out here: when a set is
 * resolved, so the resolved contracts carry it and a state's event-type prefix
 * applies to it, and when a set is read unresolved.
 */

/** `ApplicationMember` → `application_member`. */
export function snakeCase(name) {
  return String(name)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * @param {string} domain - As declared, e.g. `case-management`
 * @param {string} resource - The resource's schema name, e.g. `ApplicationMember`
 * @param {string} event - e.g. `created`, `paused`
 * @returns {string} e.g. `intake.application_member.created`
 */
export function eventType(domain, resource, event) {
  return `${domain}.${snakeCase(resource)}.${event}`;
}

/**
 * A machine with every short-named emit given its full type.
 *
 * `emit: paused` and `emit: { event: paused, data: ... }` become
 * `{ event: paused, type: 'communication.transcript.paused', ... }`. An emit
 * that already names a full `type` is left as written. The authored shape is
 * kept otherwise, since resolved output is written back out.
 *
 * @param {object} machine - An authored machine, with `object`
 * @param {string} domain
 * @returns {object} A copy with emits expanded, or the machine itself when none needed it
 */
export function expandEmits(machine, domain) {
  if (!machine?.object || !domain) return machine;
  const typeOf = (event) => eventType(domain, machine.object, event);

  let changed = false;
  const steps = (list) => (Array.isArray(list) ? list.map(step) : list);
  const step = (s) => {
    if (!s || typeof s !== 'object') return s;
    const next = { ...s };
    if (typeof next.emit === 'string') { next.emit = { event: next.emit, type: typeOf(next.emit) }; changed = true; }
    else if (next.emit?.event && !next.emit.type) { next.emit = { ...next.emit, type: typeOf(next.emit.event) }; changed = true; }
    if (next.then) next.then = steps(next.then);
    if (next.else) next.else = steps(next.else);
    if (next.do) next.do = steps(next.do);
    if (next.when) next.when = Object.fromEntries(Object.entries(next.when).map(([k, v]) => [k, steps(v)]));
    return next;
  };
  const holders = (list) => (Array.isArray(list) ? list.map((h) => (h?.steps ? { ...h, steps: steps(h.steps) } : h)) : list);

  const out = { ...machine };
  for (const key of ['actions', 'on', 'procedures']) {
    if (Array.isArray(machine[key])) out[key] = holders(machine[key]);
  }
  return changed ? out : machine;
}
