/**
 * The events each API sends, as an AsyncAPI document resolve writes beside it.
 *
 * Nobody writes these. Every resource sends a created, updated and deleted
 * event for the writes its API declares, and every state machine declares the
 * other events its resource sends under `emits:`. So the catalog is read from
 * those, once, and an event is documented wherever it can be sent:
 *
 *   created   the resource itself, as the API's schema declares it
 *   updated   the shared field-by-field change, ResourceUpdatedEvent
 *   deleted   the shared empty payload, ResourceDeletedEvent
 *   emitted   the data schema its machine declares, if any
 *   timer     the shared TimerCallbackEvent, for each timer a machine declares:
 *             the timer service sends `{domain}.{id}` when it fires, and the
 *             machine reacts to it
 *
 * Every event is named `{domain}.{resource}.{event}` (event-names.js). A
 * resource whose schema is the shared CloudEvents `Event` is an event itself —
 * an event log — and writing one sends nothing more. A POST to a path that is
 * no resource's collection is a call, not a create, and sends nothing.
 *
 * Each document is written beside the OpenAPI document whose resources send
 * the events, as `<name>-events-asyncapi.yaml`, the way a rules file's
 * endpoints are documented in an OpenAPI document generated beside it.
 */

import { eventType } from '../event-names.js';
import { readStateMachines } from '../contract-readers.js';
import { extractDomain, extractCapability } from '../contract-types.js';

const BASE_EVENTS = 'https://blueprint.codeforamerica.org/base/schemas/events.yaml';
const ENVELOPE = { $ref: `${BASE_EVENTS}#/$defs/Event` };

/** `intake.application_member.created` → `IntakeApplicationMemberCreated`. */
const pascal = (type) => type.split(/[._-]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');

/** Whether a component schema is the shared CloudEvents envelope. */
function isEventSchema(schema) {
  return typeof schema?.$ref === 'string' && schema.$ref.endsWith('/schemas/events.yaml#/$defs/Event');
}

/**
 * Every event one OpenAPI document's resources send.
 *
 * @param {import('../../types.js').Doc} api
 * @param {object[]} machines - From readStateMachines, attached to this document
 * @returns {{ type: string, summary: string, data: object|null }[]}
 */
function eventsOf(api, machines) {
  const domain = api.domain ?? extractDomain(api.content);
  if (!domain) return [];
  const paths = api.content?.paths ?? {};
  const schemas = api.content?.components?.schemas ?? {};
  const fileName = (api.relativePath ?? '').split('/').pop();
  const events = [];

  for (const resource of api.model()?.resources ?? []) {
    if (!resource.name || isEventSchema(schemas[resource.name])) continue;
    const collection = paths[resource.path('collection')];
    const item = resource.path('item') ? paths[resource.path('item')] : null;
    if (collection?.post) {
      events.push({
        type: eventType(domain, resource.name, 'created'),
        summary: `A ${resource.name} was created. Carries the record as created.`,
        data: { $ref: `./${fileName}#/components/schemas/${resource.name}` },
      });
    }
    if (item?.patch) {
      events.push({
        type: eventType(domain, resource.name, 'updated'),
        summary: `A ${resource.name} was changed. Carries each changed field, before and after.`,
        data: { $ref: `${BASE_EVENTS}#/ResourceUpdatedEvent` },
      });
    }
    if (item?.delete) {
      events.push({
        type: eventType(domain, resource.name, 'deleted'),
        summary: `A ${resource.name} was deleted. The subject is the record's id.`,
        data: { $ref: `${BASE_EVENTS}#/ResourceDeletedEvent` },
      });
    }
  }

  for (const entry of machines) {
    for (const emitted of entry.machine.emits ?? []) {
      events.push({
        type: eventType(entry.domain, entry.object, emitted.id),
        summary: emitted.description ?? `${entry.object} ${emitted.id}.`,
        data: emitted.schema ?? null,
      });
    }
    for (const timer of entry.machine.timers ?? []) {
      events.push({
        type: `${entry.domain}.${timer.id}`,
        summary: `${timer.description ?? `The ${timer.id} timer fired.`} Sent by the timer service when the timer fires; the subject is the record the timer is for.`,
        data: { $ref: `${BASE_EVENTS}#/TimerCallbackEvent` },
        // The timer service sends it, not this API; the machine receives it.
        timer: true,
      });
    }
  }
  return events;
}

/** The event types the machines react to, each once, in the order first declared. */
function receivedBy(machines) {
  return [...new Set(machines.flatMap((entry) => (entry.machine.on ?? []).map((reaction) => reaction.type).filter(Boolean)))];
}

/** `a/b/c.yaml` → `a/d/e.yaml` as a relative reference: `../d/e.yaml`. */
function relativeFile(from, to) {
  const fromDir = from.split('/').slice(0, -1);
  const target = to.split('/');
  let shared = 0;
  while (shared < fromDir.length && shared < target.length - 1 && fromDir[shared] === target[shared]) shared++;
  const up = fromDir.slice(shared).map(() => '..');
  return [...(up.length ? up : ['.']), ...target.slice(shared)].join('/');
}

/**
 * Where each event's channel is defined: a generated document's, by type, or
 * a hand-written AsyncAPI document's, by key or by address.
 *
 * @returns {Map<string, { relativePath: string, key: string, messages: string[] }>}
 */
function channelHomes(positioned, catalogs) {
  const homes = new Map();
  const add = (relativePath, channels) => {
    for (const [key, channel] of Object.entries(channels ?? {})) {
      const home = { relativePath, key, messages: Object.keys(channel?.messages ?? {}) };
      for (const type of new Set([key, channel?.address].filter(Boolean))) {
        if (!homes.has(type)) homes.set(type, home);
      }
    }
  };
  for (const catalog of catalogs) add(catalog.relativePath, catalog.content.channels);
  for (const doc of positioned.filter((d) => d.type === 'asyncapi')) add(doc.relativePath, doc.content?.channels);
  return homes;
}

/** An operation on one channel of this document, with every message it carries. */
function operation(action, key, messageNames) {
  const channel = `#/channels/${key}`;
  return {
    action,
    channel: { $ref: channel },
    messages: messageNames.map((name) => ({ $ref: `${channel}/messages/${name}` })),
  };
}

/**
 * @param {import('../../types.js').Doc[]} positioned
 * @returns {{ relativePath: string, content: object, events: string[] }[]}
 */
export function buildEventCatalogs(positioned) {
  let machines = [];
  try {
    machines = readStateMachines(positioned);
  } catch {
    // A machine that cannot attach is reported where attachment is decided.
  }

  const catalogs = [];
  for (const api of positioned.filter((d) => d.type === 'openapi' && d.relativePath?.endsWith('-openapi.yaml'))) {
    const attached = machines.filter((m) => m.api?.relativePath === api.relativePath);
    const events = eventsOf(api, attached);
    const received = receivedBy(attached);
    if (events.length === 0 && received.length === 0) continue;

    const channels = {};
    const messages = {};
    const schemas = {};
    const operations = {};
    for (const { type, summary, data, timer } of events) {
      const name = pascal(type);
      channels[type] = { address: type, messages: { [name]: { $ref: `#/components/messages/${name}` } } };
      messages[name] = { name: type, summary, payload: { $ref: `#/components/schemas/${name}Event` } };
      const properties = { type: { type: 'string', const: type } };
      if (data) properties.data = data;
      schemas[`${name}Event`] = { allOf: [ENVELOPE, { type: 'object', properties }] };
      if (!timer) operations[`send${name}`] = operation('send', type, [name]);
    }

    const relativePath = api.relativePath.replace(/-openapi\.yaml$/, '-events-asyncapi.yaml');
    catalogs.push({
      relativePath,
      received,
      events: events.map((e) => e.type),
      content: {
        asyncapi: '3.0.0',
        info: {
          title: `${api.content?.info?.title ?? 'API'} events`,
          version: api.content?.info?.version ?? '0.0.0',
          'x-domain': api.domain ?? extractDomain(api.content),
          // A framework API's events belong to its capability, like the API.
          ...(extractCapability(api.content) ? { 'x-capability': extractCapability(api.content) } : {}),
          description: `The events ${api.relativePath.split('/').pop()} and the state machines attached to its resources send, and the events those machines receive. Generated by resolve; not edited by hand.`,
        },
        channels,
        operations,
        ...(Object.keys(messages).length ? { components: { messages, schemas } } : {}),
      },
    });
  }

  // A receive operation may only name a channel in its own document, so an
  // event sent elsewhere is listed here as a reference to the document that
  // defines it — the one place it's described. Done once every generated
  // document exists, since the sender may come later in the set.
  const homes = channelHomes(positioned, catalogs);
  for (const catalog of catalogs) {
    const { channels, operations } = catalog.content;
    for (const type of catalog.received) {
      const home = homes.get(type);
      // An event no document declares is reported by validation, not here.
      if (!home) continue;
      const local = home.relativePath === catalog.relativePath;
      const key = local ? home.key : type;
      if (!local) {
        channels[key] = { $ref: `${relativeFile(catalog.relativePath, home.relativePath)}#/channels/${home.key}` };
      }
      operations[`receive${pascal(type)}`] = operation('receive', key, home.messages);
    }
    delete catalog.received;
    if (Object.keys(operations).length === 0) delete catalog.content.operations;
  }
  return catalogs;
}
