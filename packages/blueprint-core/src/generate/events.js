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
 *             the timer service sends `{domain}.{resource}.{id}` when it
 *             fires, and the machine reacts to it
 *
 * Every event is named `{domain}.{resource}.{event}` (event-names.js). A
 * resource whose schema is the shared CloudEvents `Event` is an event itself —
 * an event log — and writing one sends nothing more. A POST to a path that is
 * no resource's collection is a call, not a create, and sends nothing.
 *
 * Each document is written beside the OpenAPI document whose resources send
 * the events, as `<name>-events-asyncapi.yaml`, the way a rules file's
 * endpoints are documented in an OpenAPI document generated beside it.
 *
 * Each message carries one example, a whole CloudEvent, so a reader or a
 * tool can send it as it is. Its data comes from the resource's first sample
 * record where the record has it, and from the schema where it doesn't.
 */

import { eventType } from '../event-names.js';
import { readStateMachines } from '../contract-readers.js';
import { extractDomain, extractCapability } from '../contract-types.js';
import { buildExamples } from '../examples.js';

const BASE_EVENTS = 'https://blueprint.codeforamerica.org/base/schemas/events.yaml';

/**
 * An event's schema is written as OpenAPI 3.1 writes schemas — its data is the
 * API's own record, `discriminator` and `unevaluatedProperties` and all — so
 * it is labeled as one: AsyncAPI's multi-format schema, which a tool reads in
 * the format it names rather than as AsyncAPI's own.
 */
const OPENAPI_SCHEMA_FORMAT = 'application/vnd.oai.openapi;version=3.1.0';
const asOpenApi = (schema) => ({ schemaFormat: OPENAPI_SCHEMA_FORMAT, schema });
const ENVELOPE = { $ref: `${BASE_EVENTS}#/$defs/Event` };

// What an example event says where nothing in the set says otherwise.
const EXAMPLE_EVENT_ID = '00000000-0000-4000-8000-000000000000';
const EXAMPLE_SUBJECT = '00000000-0000-4000-8000-000000000001';
const EXAMPLE_TIME = '2024-01-01T00:00:00Z';
// Set by the server, so never what a change to a record changes.
const MANAGED_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'status']);

/** A schema's own type, leaving out `null` from a list of them. */
const typeOf = (schema) => (Array.isArray(schema?.type) ? schema.type.find((t) => t !== 'null') : schema?.type);

/**
 * A value for a schema: the record's, when it has the field, else what the
 * schema itself suggests — its const, example, default or first enum value,
 * then a value of its type. A reference is not followed; it gets `{}`.
 */
function sampleValue(schema, name, record) {
  if (record && name in record) return record[name];
  if (!schema || typeof schema !== 'object' || schema.$ref) return {};
  if ('const' in schema) return schema.const;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const type = typeOf(schema);
  if (type === 'object' || schema.properties) return sampleData(schema, null);
  if (type === 'array') return [];
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (schema.format === 'uuid') return EXAMPLE_SUBJECT;
  if (schema.format === 'date-time') return EXAMPLE_TIME;
  if (schema.format === 'date') return EXAMPLE_TIME.slice(0, 10);
  return 'example';
}

/** An object for a schema: its required fields, or all of them when none is required. */
function sampleData(schema, record) {
  const properties = schema?.properties ?? {};
  const names = Array.isArray(schema?.required) && schema.required.length ? schema.required : Object.keys(properties);
  return Object.fromEntries(names.map((name) => [name, sampleValue(properties[name], name, record)]));
}

/** A schema's properties, through `allOf` and references within its document. */
function propertiesOf(schema, schemas, seen = new Set()) {
  const local = typeof schema?.$ref === 'string' && schema.$ref.startsWith('#/components/schemas/')
    ? schemas[schema.$ref.split('/').pop()] : schema;
  if (!local || typeof local !== 'object' || seen.has(local)) return {};
  seen.add(local);
  return Object.assign({}, ...(local.allOf ?? []).map((part) => propertiesOf(part, schemas, seen)), local.properties ?? {});
}

/**
 * An updated event's one change: a field of the record whose schema lists
 * its values, moved to another of them; else a text field, given a new value.
 */
function sampleChange(record, properties) {
  const fields = Object.entries(properties).filter(([name, schema]) => !MANAGED_FIELDS.has(name) && !schema?.readOnly && name in record);
  const listed = fields.find(([name, schema]) => Array.isArray(schema?.enum) && schema.enum.some((v) => v !== record[name]));
  if (listed) {
    const [name, schema] = listed;
    return { field: name, before: record[name], after: schema.enum.find((v) => v !== record[name]) };
  }
  const text = fields.find(([name]) => typeof record[name] === 'string');
  return text ? { field: text[0], before: record[text[0]], after: 'example' } : null;
}

/** The example CloudEvent for one event. */
function exampleEvent({ type, kind, dataSchema, timerId }, { domain, record, properties }) {
  const subject = record?.id ?? EXAMPLE_SUBJECT;
  let data;
  if (kind === 'created') data = record ?? {};
  else if (kind === 'updated') data = { changes: [record && sampleChange(record, properties)].filter(Boolean) };
  else if (kind === 'deleted') data = {};
  // domain.timerType.objectId, as TimerRequestedEvent names it.
  else if (kind === 'timer') data = { timerId: `${domain}.${timerId}.${subject}` };
  else if (dataSchema && !dataSchema.$ref) data = sampleData(dataSchema, record);
  return {
    specversion: '1.0',
    id: EXAMPLE_EVENT_ID,
    source: `/${domain}`,
    type,
    subject,
    time: EXAMPLE_TIME,
    datacontenttype: 'application/json',
    ...(data !== undefined ? { data } : {}),
  };
}

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
        example: { kind: 'created', object: resource.name },
      });
    }
    if (item?.patch) {
      events.push({
        type: eventType(domain, resource.name, 'updated'),
        summary: `A ${resource.name} was changed. Carries each changed field, before and after.`,
        data: { $ref: `${BASE_EVENTS}#/ResourceUpdatedEvent` },
        example: { kind: 'updated', object: resource.name },
      });
    }
    if (item?.delete) {
      events.push({
        type: eventType(domain, resource.name, 'deleted'),
        summary: `A ${resource.name} was deleted. The subject is the record's id.`,
        data: { $ref: `${BASE_EVENTS}#/ResourceDeletedEvent` },
        example: { kind: 'deleted', object: resource.name },
      });
    }
  }

  for (const entry of machines) {
    for (const emitted of entry.machine.emits ?? []) {
      events.push({
        type: eventType(entry.domain, entry.object, emitted.id),
        summary: emitted.description ?? `${entry.object} ${emitted.id}.`,
        data: emitted.schema ?? null,
        example: { kind: 'emitted', object: entry.object, dataSchema: emitted.schema ?? null },
      });
    }
    for (const timer of entry.machine.timers ?? []) {
      events.push({
        type: eventType(entry.domain, entry.object, timer.id),
        summary: `${timer.description ?? `The ${timer.id} timer fired.`} Published by the timer service when the timer fires; the subject is the record the timer is for.`,
        data: { $ref: `${BASE_EVENTS}#/TimerCallbackEvent` },
        // The timer service sends it, not this API; the machine receives it.
        timer: true,
        example: { kind: 'timer', object: entry.object, timerId: timer.id },
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
  const samples = buildExamples(positioned);
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
    const domain = api.domain ?? extractDomain(api.content);
    const apiSchemas = api.content?.components?.schemas ?? {};
    for (const { type, summary, data, timer, example } of events) {
      const name = pascal(type);
      // Two events whose names differ only in their separators would share a
      // message, and the second would replace the first without a word.
      if (messages[name] && messages[name].name !== type) {
        throw new Error(`${api.relativePath}: events "${messages[name].name}" and "${type}" would both be documented as ${name}. Rename one.`);
      }
      const record = samples[example.object]?.[0]?.data ?? null;
      const payload = exampleEvent({ type, ...example }, {
        domain, record, properties: propertiesOf({ $ref: `#/components/schemas/${example.object}` }, apiSchemas),
      });
      channels[type] = { address: type, messages: { [name]: { $ref: `#/components/messages/${name}` } } };
      messages[name] = {
        name: type,
        summary,
        payload: asOpenApi({ $ref: `#/components/schemas/${name}Event` }),
        examples: [{ name: 'Example', summary: `An example ${type} event.`, payload }],
      };
      const properties = { type: { type: 'string', const: type } };
      if (data) properties.data = data;
      // An event that declares its data always carries it, so a typed client
      // can read it without checking it's there.
      schemas[`${name}Event`] = asOpenApi({ allOf: [ENVELOPE, { type: 'object', required: data ? ['type', 'data'] : ['type'], properties }] });
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
