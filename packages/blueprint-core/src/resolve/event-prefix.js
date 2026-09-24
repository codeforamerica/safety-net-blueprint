/**
 * Prefix every event type in the contract set.
 *
 * A state deploying alongside other systems on a shared bus needs its events
 * distinguishable — `ca.intake.application.submitted` rather than
 * `intake.application.submitted`. The prefix is declared once in the overlay
 * configuration as `x-event-type-prefix` and applied everywhere an event type
 * appears, because a prefix applied in one place and not another silently
 * breaks the link between publisher and subscriber.
 *
 * Three document types name event types, each differently:
 *   state machines  emit steps, and the type of each event handler
 *   asyncapi        channel addresses, message names, payload type consts
 *   annotations     the keys of the events section
 */

/**
 * @param {import('../../types.js').Doc[]} docs
 * @param {string|null} [prefix] - From overlay config `x-event-type-prefix`
 * @returns {{ docs: object[], warnings: string[], applied: string[] }}
 */
export function prefixEventTypes(docs, prefix = null) {
  if (!prefix) return { docs, warnings: [], applied: [] };

  const applied = [];

  const prefixed = docs.map((doc) => {
    const content = prefixDocument(doc, prefix);
    if (content === doc.content) return doc;

    applied.push(`Prefixed event types with "${prefix}" -> ${doc.relativePath ?? doc.path}`);
    return { ...doc, content };
  });

  return { docs: prefixed, warnings: [], applied };
}

/**
 * @param {import('../../types.js').Doc} doc
 * @param {string} prefix
 * @returns {object} New content, or the original when the type carries no event types
 */
function prefixDocument(doc, prefix) {
  switch (doc.type) {
    case 'state-machine': return prefixStateMachine(doc.content, prefix);
    case 'asyncapi':      return prefixAsyncApi(doc.content, prefix);
    case 'annotations':   return prefixAnnotations(doc.content, prefix);
    default:              return doc.content;
  }
}

/**
 * Emit steps and event handler types.
 *
 * Steps are walked through the authored shape rather than the normalized
 * model, because the result is written back out and has to keep the shape it
 * was authored in.
 *
 * @param {object} content
 * @param {string} prefix
 * @returns {object}
 */
function prefixStateMachine(content, prefix) {
  if (!Array.isArray(content.machines)) return content;

  const prefixSteps = (steps) => (steps ?? []).map((step) => {
    const next = { ...step };
    if (next.emit?.type) next.emit = { ...next.emit, type: prefix + next.emit.type };
    if (next.then) next.then = prefixSteps(next.then);
    if (next.else) next.else = prefixSteps(next.else);
    if (next.do) next.do = prefixSteps(next.do);
    if (next.when) {
      next.when = Object.fromEntries(
        Object.entries(next.when).map(([value, branch]) => [value, prefixSteps(branch)])
      );
    }
    return next;
  });

  const prefixHolders = (holders, alsoType) => holders.map((holder) => ({
    ...holder,
    ...(alsoType && holder.type ? { type: prefix + holder.type } : {}),
    ...(holder.steps ? { steps: prefixSteps(holder.steps) } : {}),
  }));

  // Only rewrite sections the document actually has. Mapping over `?? []` and
  // assigning the result would add `procedures: []` to a machine that declares
  // none, so resolved output would carry keys nobody wrote.
  const prefixSection = (machine, key, alsoType) =>
    Array.isArray(machine[key]) ? { [key]: prefixHolders(machine[key], alsoType) } : {};

  return {
    ...content,
    machines: content.machines.map((machine) => ({
      ...machine,
      ...prefixSection(machine, 'actions', false),
      ...prefixSection(machine, 'events', true),
      ...prefixSection(machine, 'procedures', false),
    })),
  };
}

/**
 * Three places name an event type in an AsyncAPI document:
 *
 *   channels          the map key, and the `address` field when present
 *   components.messages[*].name
 *   components.schemas[*].allOf[*].properties.type.const
 *
 * The last is the discriminating const in an event envelope, which is what a
 * subscriber matches on — missing it would leave the payload claiming an
 * unprefixed type while its channel says otherwise.
 *
 * @param {object} content
 * @param {string} prefix
 * @returns {object}
 */
function prefixAsyncApi(content, prefix) {
  const next = { ...content };

  if (content.channels && typeof content.channels === 'object') {
    next.channels = Object.fromEntries(
      Object.entries(content.channels).map(([address, channel]) => [
        prefix + address,
        typeof channel?.address === 'string'
          ? { ...channel, address: prefix + channel.address }
          : channel,
      ])
    );
  }

  if (content.components) {
    next.components = { ...content.components };

    if (content.components.messages && typeof content.components.messages === 'object') {
      next.components.messages = mapValues(content.components.messages, (message) =>
        typeof message?.name === 'string' ? { ...message, name: prefix + message.name } : message
      );
    }

    if (content.components.schemas && typeof content.components.schemas === 'object') {
      next.components.schemas = mapValues(content.components.schemas, (schema) =>
        Array.isArray(schema?.allOf)
          ? { ...schema, allOf: schema.allOf.map((part) => prefixTypeConst(part, prefix)) }
          : schema
      );
    }
  }

  return next;
}

/**
 * @param {object} part - One allOf member
 * @param {string} prefix
 * @returns {object}
 */
function prefixTypeConst(part, prefix) {
  const value = part?.properties?.type?.const;
  if (typeof value !== 'string') return part;

  return {
    ...part,
    properties: {
      ...part.properties,
      type: { ...part.properties.type, const: prefix + value },
    },
  };
}

/**
 * @param {object} object
 * @param {(value: *) => *} fn
 * @returns {object}
 */
function mapValues(object, fn) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, fn(value)]));
}

/**
 * The keys of the events section, which are event types.
 *
 * @param {object} content
 * @param {string} prefix
 * @returns {object}
 */
function prefixAnnotations(content, prefix) {
  if (!content.events || typeof content.events !== 'object') return content;

  return {
    ...content,
    events: Object.fromEntries(
      Object.entries(content.events).map(([type, annotation]) => [prefix + type, annotation])
    ),
  };
}
