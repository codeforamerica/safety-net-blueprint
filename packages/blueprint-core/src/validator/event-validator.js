/**
 * Cross-validate a state machine's event references against the events the
 * set documents.
 *
 * Every event a machine names in full must be documented: an AsyncAPI channel
 * written by hand, or one resolve generates from the APIs and the machines'
 * `emits:` declarations. An emit named by id is checked against the machine's
 * own `emits:` (state-machine-validator.js), which is what generates its
 * channel.
 *
 *   emit.type     a full type, written outside any machine — a shared
 *                 procedure's request to another domain.
 *   onEvent.type  subscribing across domains is the point of an event bus.
 *
 * Timer callbacks are exempt. They are derived from `timers:` declarations as
 * `{domain}.{resource}.{timerId}`, like every other event a resource sends
 * (event-names.js) — the timer declaration names the event and
 * `TimerCallbackEvent` in base-contracts gives its payload.
 */

import { eventType } from '../event-names.js';

/**
 * @param {import('../../types.js').Doc} doc - A state-machine document
 * @param {{ all: Set<string> }} channels - Every documented event type
 * @param {Set<string>} [domains] - The domains the set defines
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function validateEvents(doc, channels, domains = new Set()) {
  const errors = [];
  const machines = doc.model()?.machines ?? [];

  for (const { type, path } of [...emittedTypes(machines, doc.content?.procedures), ...subscribedTypes(machines)]) {
    const shape = eventNameError(type, domains);
    if (shape) errors.push({ ...shape, path });
  }

  for (const { type, path } of emittedTypes(machines, doc.content?.procedures)) {
    if (!channels.all.has(type)) {
      errors.push({
        rule: 'emit-type-undeclared',
        message: `emit type "${type}" is not an event the set documents.`,
        path,
      });
    }
  }

  const timerCallbacks = timerCallbackTypes(doc);
  for (const { type, path } of subscribedTypes(machines)) {
    if (isTimerCallback(type, timerCallbacks)) continue;
    if (!channels.all.has(type)) {
      errors.push({
        rule: 'subscription-type-undeclared',
        message: `subscription type "${type}" is not an event the set documents — an AsyncAPI channel, or one generated from an API or a machine's emits.`,
        path,
      });
    }
  }

  return errors;
}


const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/**
 * Whether an event type is named `{domain}.{resource}.{event}`
 * (event-names.js): a domain the set defines, then the resource and the event,
 * each in snake_case. A bus namespace ahead of the domain
 * (`x-event-type-prefix`, `ca.intake.application.submitted`) is allowed, so the
 * domain is found among the set's domains rather than taken as the first part,
 * and a version after the event (`.v2`) is allowed (docs/conventions/events.yaml).
 * With no domains to go by, the last three parts are checked.
 *
 * @param {string} type
 * @param {Set<string>} domains - The domains the set defines
 * @returns {{ rule: string, message: string }|null} The error, or null when it's well named
 */
export function eventNameError(type, domains) {
  const parts = String(type).split('.');
  const at = domains.size ? parts.findIndex((part) => domains.has(part)) : parts.length - 3;
  const [resource, event, ...extra] = at >= 0 ? parts.slice(at + 1) : [];
  // A breaking change to a payload is published as a new version: .v2.
  const versioned = extra.length === 0 || (extra.length === 1 && /^v\d+$/.test(extra[0]));
  if (at >= 0 && SNAKE.test(resource ?? '') && SNAKE.test(event ?? '') && versioned) return null;
  return {
    rule: 'event-name-shape',
    message: `Event "${type}" isn't named {domain}.{resource}.{event}: the domain, the resource that sends it, ` +
      'and what happened, the last two in snake_case (intake.application.submitted). A timer\'s callback is ' +
      'named the same way, for the resource whose machine declares the timer (intake.application.review_reminder).',
  };
}

/**
 * Event names in an AsyncAPI document that aren't `{domain}.{resource}.{event}`:
 * each channel addressed by an event. A WebSocket's channels are addressed by
 * connection, or not at all, and are skipped.
 *
 * @param {import('../../types.js').Doc} doc - An AsyncAPI document
 * @param {Set<string>} domains - The domains the set defines
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function channelNameErrors(doc, domains) {
  const errors = [];
  for (const [key, channel] of Object.entries(doc.content?.channels ?? {})) {
    const address = channel?.address;
    if (typeof address !== 'string' || address.includes('/') || channel?.bindings?.ws) continue;
    const shape = eventNameError(address, domains);
    if (shape) errors.push({ ...shape, path: `${doc.path}#channels.${key}` });
  }
  return errors;
}

/**
 * Every event type emitted anywhere in the document.
 *
 * Steps are read from the normalized model, so branch and loop bodies are
 * reached by walking `children` rather than by knowing that `if` nests under
 * `then`, `match` under `when`, and `forEach` under `do`.
 *
 * @param {object[]} machines - doc.model.machines
 * @param {object[]} [topLevelProcedures] - doc.content.procedures
 * @returns {{ type: string, path: string }[]}
 */
function* emittedTypes(machines, topLevelProcedures) {
  for (const machine of machines) {
    for (const holderKey of ['actions', 'on', 'procedures']) {
      for (const holder of machine[holderKey] ?? []) {
        const where = `machines[${machine.object ?? '?'}].${holderKey}[${holder.id ?? holder.type ?? '?'}]`;
        yield* emitsIn(holder.steps, where);
      }
    }
  }

  // A base state machine declares shared procedures at the top level. Those
  // are not normalized into model.machines, so they are read from content.
  for (const procedure of topLevelProcedures ?? []) {
    yield* emitsIn(procedure.steps, `procedures[${procedure.id ?? '?'}]`);
  }
}

/**
 * @param {object[]} steps - Normalized step nodes, or authored steps for
 *   top-level procedures which the model does not cover
 * @param {string} where
 * @returns {Generator<{ type: string, path: string }>}
 */
function* emitsIn(steps, where) {
  for (const step of steps ?? []) {
    // Normalized nodes carry kind and type; authored steps nest under `emit`.
    const type = step.kind === 'emit' ? step.type : step.emit?.type;
    if (type) yield { type, path: where };

    yield* emitsIn(step.children ?? step.then ?? step.do, where);
    yield* emitsIn(step.else, where);
    yield* emitsIn(step.catch?.do, where);
    for (const branch of Object.values(step.when ?? {})) yield* emitsIn(branch, where);
  }
}

/**
 * @param {object[]} machines
 * @returns {{ type: string, path: string }[]}
 */
function* subscribedTypes(machines) {
  for (const machine of machines) {
    for (const event of machine.on ?? []) {
      if (event.type) {
        yield { type: event.type, path: `machines[${machine.object ?? '?'}].on` };
      }
    }
  }
}

/**
 * Whether a subscription is one of this document's own timer callbacks.
 *
 * A callback type is the machine's event named for the timer, and a state
 * may put its whole event vocabulary behind a bus namespace —
 * `x-event-type-prefix` rewrites the subscription to
 * `ca.intake.application.review_reminder` while leaving `domain` and the timer
 * id alone, so the reconstructed name is a suffix of the real one rather than
 * equal to it. Anchored on the separator, so a namespace is accepted but
 * `xintake.application.review_reminder` is not.
 *
 * @param {string} type - Subscription type from the resolved document
 * @param {Set<string>} callbacks - Callback names, `{domain}.{resource}.{timerId}`
 * @returns {boolean}
 */
function isTimerCallback(type, callbacks) {
  for (const callback of callbacks) {
    if (type === callback || type.endsWith(`.${callback}`)) return true;
  }
  return false;
}

/**
 * Timer callback types a document declares, as `{domain}.{resource}.{timerId}`.
 *
 * @param {import('../../types.js').Doc} doc
 * @returns {Set<string>}
 */
function timerCallbackTypes(doc) {
  const domain = doc.content?.domain;
  if (!domain) return new Set();

  return new Set(
    (doc.model()?.machines ?? []).flatMap((machine) => (machine.timers ?? [])
      .filter((timer) => timer.id && machine.object)
      .map((timer) => eventType(domain, machine.object, timer.id)))
  );
}
