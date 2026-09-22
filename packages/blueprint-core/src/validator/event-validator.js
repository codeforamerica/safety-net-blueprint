/**
 * Cross-validate a state machine's event references against AsyncAPI catalogs.
 *
 * A state machine may only emit and subscribe to events that some AsyncAPI
 * document formally declares as a channel. Two rules, with different scopes:
 *
 *   emit.type     must be a channel in the machine's own eventsSpec. A domain
 *                 publishes its own events, so emitting one it does not
 *                 declare means the contract and the behaviour disagree.
 *   onEvent.type  must be a channel in any document. Subscribing across
 *                 domains is the point of an event bus.
 *
 * Timer callbacks are exempt. They are derived from `timers:` declarations as
 * `{domain}.{timerId}` and are internal scheduling infrastructure, deliberately
 * absent from domain catalogs.
 */

/**
 * @param {import('../../types.js').Doc} doc - A state-machine document
 * @param {{ bySpec: Map<string, Set<string>>, all: Set<string> }} channels
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function validateEvents(doc, channels) {
  const errors = [];
  const machines = doc.model?.machines ?? [];
  const eventsSpec = doc.content?.eventsSpec;
  const declared = eventsSpec ? channels.bySpec.get(eventsSpec) : null;

  if (eventsSpec && !declared) {
    errors.push({
      rule: 'events-spec-missing',
      message: `eventsSpec "${eventsSpec}" not found — emit types cannot be verified.`,
      path: 'eventsSpec',
    });
  }

  for (const { type, path } of emittedTypes(machines, doc.content?.procedures)) {
    if (!declared) {
      if (eventsSpec) continue; // already reported above
      errors.push({
        rule: 'emit-without-events-spec',
        message: `emit type "${type}" cannot be verified — no eventsSpec declared.`,
        path,
      });
    } else if (!declared.has(type)) {
      errors.push({
        rule: 'emit-type-undeclared',
        message: `emit type "${type}" is not a channel in ${eventsSpec}.`,
        path,
      });
    }
  }

  const timerCallbacks = timerCallbackTypes(doc);
  for (const { type, path } of subscribedTypes(machines)) {
    if (timerCallbacks.has(type)) continue;
    if (!channels.all.has(type)) {
      errors.push({
        rule: 'subscription-type-undeclared',
        message: `subscription type "${type}" is not a channel in any AsyncAPI document.`,
        path,
      });
    }
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
    for (const holderKey of ['actions', 'events', 'procedures']) {
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
    for (const branch of Object.values(step.when ?? {})) yield* emitsIn(branch, where);
  }
}

/**
 * @param {object[]} machines
 * @returns {{ type: string, path: string }[]}
 */
function* subscribedTypes(machines) {
  for (const machine of machines) {
    for (const event of machine.events ?? []) {
      if (event.type) {
        yield { type: event.type, path: `machines[${machine.object ?? '?'}].events` };
      }
    }
  }
}

/**
 * Timer callback types a document declares, as `{domain}.{timerId}`.
 *
 * @param {import('../../types.js').Doc} doc
 * @returns {Set<string>}
 */
function timerCallbackTypes(doc) {
  const domain = doc.content?.domain;
  if (!domain) return new Set();

  return new Set(
    (doc.model?.machines ?? [])
      .flatMap((machine) => machine.timers ?? [])
      .map((timer) => timer.id)
      .filter(Boolean)
      .map((id) => `${domain}.${id}`)
  );
}
