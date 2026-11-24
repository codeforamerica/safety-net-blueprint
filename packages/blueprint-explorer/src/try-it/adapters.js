/**
 * What answers an adapter in Try it: the site's routing, or None, where the
 * developer stands in for the adapter.
 *
 * An adapter is an API answered outside the contracts (x-relationship
 * external), which a resource's state machine calls, as a transcription
 * session calls its adapter's startStream. Where the site routes it with a
 * match, the record a request names chooses which entry answers: a session's
 * profile names its provider, and the entry matching that provider answers.
 * Try it shows that choice where the record is picked (recordAdapters), with
 * None beside it, for the browser tab.
 *
 * Under None, each call to the adapter waits for the developer to answer it
 * (send-panel.js), and the mock checks the answer against the contract, as
 * it checks a routed handler's. An adapter that reports what it did with
 * events, listed in its own AsyncAPI document as what it sends, has them
 * offered to publish, since nothing else will.
 */

import { siteRouting } from './routing.js';

/** The choice for an adapter that's None. */
export const NONE = 'none';

const METHODS = ['get', 'put', 'post', 'patch', 'delete'];

// Forgotten on a reload by the same name (lib/control-panel.js).
const keyFor = (scope) => `blueprint-mock-adapters:${scope}`;

const stored = ({ scope }) => {
  try { return JSON.parse(sessionStorage.getItem(keyFor(scope)) ?? '{}') ?? {}; } catch { return {}; }
};

/** The site's routing entries for an API, in the routing file's order. */
const entriesFor = (api) => siteRouting().filter((entry) => entry.api === api);

/** The choice for an adapter that's answered as the site routes it. */
export const ROUTED = 'routed';

/** Whether an adapter is None in this tab, or answered as the site routes it. */
export function chosenAdapter(where, api) {
  return stored(where)[api] === NONE ? NONE : ROUTED;
}

/** Make an adapter None, or answered as routed, for the tab. The mock takes it when it next starts. */
export function chooseAdapter(where, api, value) {
  const choices = { ...stored(where), [api]: value };
  try { sessionStorage.setItem(keyFor(where.scope), JSON.stringify(choices)); } catch { /* the choice lasts this page only */ }
}

/** The documents of the APIs answered outside the contracts. */
const adapterDocs = (docs) => docs.filter((doc) => doc.type === 'openapi' && doc.adapter);

/**
 * The adapters an operation leads to: the APIs answered outside the
 * contracts whose operations its state machine action calls.
 *
 * @param {object} operation - The OpenAPI operation, its x-relationship naming its action
 * @param {{ apiName: string, callers: string[] }[]} calledOut - stubChoices(docs).operations
 * @returns {string[]}
 */
export function adaptersCalledBy(operation, calledOut) {
  const action = operation?.['x-relationship'];
  if (action?.type !== 'state-machine-action') return [];
  const caller = `${action.resource} › ${action.id}`;
  return [...new Set(calledOut.filter((called) => called.callers.includes(caller)).map((called) => called.apiName))];
}

/**
 * The routing the mock takes with the adapters' choices: an adapter that's
 * None has its routing entries give way to a handler for each of its
 * operations that waits for the developer.
 *
 * @param {object[]} routing - routingInUse's
 * @param {object[]} docs
 * @param {{ scope: string }} where
 * @param {(call: object) => Promise<Response>} hold - Waits for the developer's answer to a call
 * @returns {object[]}
 */
export function withAdapterChoices(routing, docs, where, hold) {
  let result = routing;
  for (const doc of adapterDocs(docs)) {
    if (chosenAdapter(where, doc.api) !== NONE) continue;
    result = [...result.filter((entry) => entry.api !== doc.api), { api: doc.api, handler: waitingHandlers(doc, hold) }];
  }
  return result;
}

/** A handler for each of an adapter's operations, each waiting for the developer's answer. */
function waitingHandlers(doc, hold) {
  const handlers = {};
  for (const [path, item] of Object.entries(doc.content?.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item?.[method];
      if (!operation?.operationId) continue;
      handlers[operation.operationId] = async (request, context) => {
        const text = await request.text();
        let body;
        try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
        return hold({ doc, operation, method: method.toUpperCase(), path, params: context?.params ?? {}, body });
      };
    }
  }
  return handlers;
}

/**
 * The adapters a kind of record chooses, as a session's profile chooses its
 * transcription adapter, through the contracts alone: a field of the record
 * drawn from a registry (x-enum-source) and a field of an adapter's request
 * drawn from the same one, which a routing entry's match names. For each
 * record, the entry its value matches.
 *
 * @param {string} resource - A schema's name, as an x-relationship names it
 * @param {object[]} docs
 * @returns {{ apis: string[], entryFor: (record: object) => { api: string, entry: object|null }[] }}
 *   The adapters such a record chooses, and for a record, the entry answering it for each
 */
export function recordAdapters(resource, docs) {
  const fields = registryFields(schemaNamed(resource, docs));
  // The entries matching on a request field drawn from a registry, by registry and value.
  const byValue = new Map();
  const apis = new Set();
  for (const doc of adapterDocs(docs)) {
    const request = requestFields(doc);
    for (const entry of entriesFor(doc.api)) {
      for (const [path, value] of Object.entries(entry.match ?? {})) {
        const registry = request.get(path);
        if (!registry || !fields.some((field) => field.registry === registry)) continue;
        apis.add(doc.api);
        byValue.set(`${doc.api} ${registry} ${value}`, entry);
      }
    }
  }
  return {
    apis: [...apis],
    entryFor: (record) => [...apis].map((api) => ({
      api,
      entry: fields.map((field) => byValue.get(`${api} ${field.registry} ${record?.[field.name]}`)).find(Boolean) ?? null,
    })),
  };
}

/** A component schema by name, from whichever document of the set declares it. */
function schemaNamed(name, docs) {
  for (const doc of docs.filter((d) => d.type === 'openapi')) {
    const schema = doc.content?.components?.schemas?.[name];
    if (schema) return { doc, schema };
  }
  return null;
}

/** A schema's properties, its allOf's merged in, following refs within its document. */
function propertiesOf(doc, schema, depth = 0) {
  const node = inDocument(doc, schema);
  if (!node || depth > 6) return {};
  return Object.assign({}, ...(node.allOf ?? []).map((part) => propertiesOf(doc, part, depth + 1)), node.properties ?? {});
}

/** The fields of a schema drawn from a registry. */
function registryFields(found) {
  if (!found) return [];
  return Object.entries(propertiesOf(found.doc, found.schema))
    .map(([name, field]) => ({ name, registry: inDocument(found.doc, field)?.['x-enum-source']?.registry }))
    .filter((field) => field.registry);
}

/** The registry each top-level field of an adapter's request bodies is drawn from, by name. */
function requestFields(doc) {
  const fields = new Map();
  for (const item of Object.values(doc.content?.paths ?? {})) {
    for (const method of METHODS) {
      const schema = item?.[method]?.requestBody?.content?.['application/json']?.schema;
      for (const [name, field] of Object.entries(propertiesOf(doc, schema))) {
        const registry = inDocument(doc, field)?.['x-enum-source']?.registry;
        if (registry) fields.set(name, registry);
      }
    }
  }
  return fields;
}

/**
 * What an adapter sends, from its own AsyncAPI document: each send
 * operation's event type, and an example of it, a whole CloudEvent. Its
 * channels refer to the resource's own, generated beside the resource's API,
 * where the messages are.
 *
 * @param {string} api
 * @param {object[]} docs
 * @returns {{ type: string, summary: string, example: object, dateTimes: string[], references: string[] }[]}
 *   Each event, with the fields of its data its schema says are date-times,
 *   and those that are another record's id (x-relationship)
 */
export function eventsSentBy(api, docs) {
  const own = docs.find((doc) => doc.type === 'asyncapi' && doc.api === api && doc.adapter);
  if (!own) return [];
  const events = [];
  for (const operation of Object.values(own.content?.operations ?? {})) {
    if (operation?.action !== 'send') continue;
    const sent = inDocument(own, operation.channel);
    // The adapter's channel refers to the resource's, in another document.
    const channel = typeof sent?.$ref === 'string' && !sent.$ref.startsWith('#') ? own.resolveRef(sent.$ref, docs) : sent;
    const home = docs.find((doc) => Object.values(doc.content?.channels ?? {}).includes(channel));
    if (!home) continue;
    for (const message of Object.values(channel.messages ?? {})) {
      const declared = inDocument(home, message);
      if (!declared?.name) continue;
      events.push({
        type: declared.name,
        summary: operation.summary ?? declared.summary ?? '',
        example: declared.examples?.[0]?.payload ?? { type: declared.name, data: {} },
        ...dataFields(home, payloadSchema(home, declared.payload)),
      });
    }
  }
  return events;
}

/**
 * A message payload's schema. AsyncAPI wraps a schema in another format with
 * its `schemaFormat` as `{ schemaFormat, schema }`, here and in the component
 * the payload refers to.
 */
function payloadSchema(doc, payload) {
  let node = inDocument(doc, payload);
  for (let i = 0; i < 4 && node && (node.schemaFormat || node.$ref); i += 1) node = inDocument(doc, node.schema ?? node);
  return node;
}

/** The fields of an event's data its schema says are date-times, and another record's id. */
function dataFields(doc, schema) {
  const parts = [schema, ...(schema?.allOf ?? [])].map((part) => inDocument(doc, part));
  const data = inDocument(doc, parts.find((part) => part?.properties?.data)?.properties.data);
  const fields = Object.entries(data?.properties ?? {}).map(([name, field]) => [name, inDocument(doc, field)]);
  return {
    dateTimes: fields.filter(([, field]) => field?.format === 'date-time').map(([name]) => name),
    references: fields.filter(([, field]) => field?.['x-relationship']).map(([name]) => name),
  };
}

/** A node, following a $ref within its own document (`#/...`). */
function inDocument(doc, node) {
  if (typeof node?.$ref !== 'string' || !node.$ref.startsWith('#')) return node;
  return node.$ref.slice(2).split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((at, key) => at?.[key], doc.content);
}
