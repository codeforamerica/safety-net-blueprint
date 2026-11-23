/**
 * Checking routing: where each domain, API, socket and operation is answered
 * in one deployment (schemas/routing-schema.yaml). Routing is configuration,
 * not a contract, but it's checked like one: against its schema, and against
 * the contracts it routes, so a typo fails before anything runs rather than
 * on a call. The runtime that reads routing (the mock server, the explorer,
 * an app running the mock in its page) runs the same checks, so the messages
 * are the same everywhere (docs/conventions/patterns/routing.yaml).
 *
 * Runs in a browser as well as in Node: the schema comes from its JSON copy.
 */

import Ajv from 'ajv/dist/2020.js';
import schema from '../schemas/routing-schema.json' with { type: 'json' };
import { readOperations } from './operations.js';

/** The domain an entry names to route every domain, as a proxy's catch-all is written. */
export const EVERY_DOMAIN = '*';

let compiled = null;
const schemaCheck = () => {
  compiled ??= new Ajv({ allErrors: true, strict: false }).compile(schema);
  return compiled;
};

/** A route, named by what a person wrote. */
export function entryName(entry, index) {
  const matching = entry?.match && typeof entry.match === 'object'
    ? ` matching ${Object.entries(entry.match).map(([path, value]) => `${path}=${value}`).join(', ')}` : '';
  if (entry?.domain === EVERY_DOMAIN) return 'The routing entry for every domain';
  if (typeof entry?.domain === 'string') return `Routed domain "${entry.domain}"`;
  if (typeof entry?.api === 'string') return `Routed API "${entry.api}"${matching}`;
  if (typeof entry?.operation === 'string') return `Routed operation "${entry.operation}"${matching}`;
  return `Routing entry #${index + 1}`;
}

/** What the schema says is wrong, one sentence each, naming the entry. */
function schemaProblems(document) {
  const validate = schemaCheck();
  if (validate(document)) return [];
  const entries = Array.isArray(document?.routing) ? document.routing : [];
  const problems = validate.errors
    // A failed oneOf or anyOf reports each branch's own failure too; those
    // say what one alternative wanted, not what's wrong.
    .filter((error) => !/\/(oneOf|anyOf)\/\d/.test(error.schemaPath))
    .map((error) => {
      const [, index, rest = ''] = error.instancePath.match(/^\/routing\/(\d+)(.*)$/) ?? [];
      const subject = index === undefined
        ? (error.instancePath === '' ? 'The routing configuration' : 'routing')
        : entryName(entries[Number(index)], Number(index));
      const field = rest.split('/').slice(1).join('.');
      const under = field ? `${field}.` : '';
      if (/\/properties\/handler\//.test(error.schemaPath)) return `${subject}'s handler, in a file, is a JavaScript module: a path ending .js or .mjs`;
      if (error.schemaPath.includes('/then/') || error.keyword === 'if') return `${subject} has a match, so it routes an API or an operation, not a domain`;
      if (error.keyword === 'oneOf' && !field) return `${subject} needs exactly one of "domain", "api" or "operation"`;
      if (error.keyword === 'anyOf' && !field) return `${subject} needs exactly one of "to" or "handler"`;
      if (error.keyword === 'additionalProperties') return `${subject} has an unknown key "${under}${error.params.additionalProperty}"`;
      if (error.keyword === 'required') return `${subject} needs "${under}${error.params.missingProperty}"`;
      return field ? `${subject} "${field}" ${error.message}` : `${subject} ${error.message}`;
    });
  return [...new Set(problems)];
}

/**
 * What the contracts declare that routing names: operations, which API is in
 * which domain, which APIs are reached over their own connection, each
 * operation's request fields, and which operations something outside the
 * contracts answers.
 *
 * @param {import('../types.js').Doc[]} docs
 */
export function routingFacts(docs) {
  const operations = readOperations(docs);
  const domainOfFile = new Map(docs.map((doc) => [doc.relativePath, doc.domain ?? doc.content?.domain ?? doc.content?.info?.['x-domain']]));
  const domainOfApi = new Map((operations?.all ?? []).map((operation) => [operation.api, domainOfFile.get(operation.file)]).filter(([, domain]) => domain));
  const sockets = new Set(docs.filter((doc) => doc.type === 'asyncapi' && doc.protocols?.includes('ws')).map((doc) => doc.api));
  const { requestFields, external } = operationFacts(docs);
  return { operations, domainOfApi, sockets, requestFields, external };
}

/**
 * Per operation, keyed `api#operationId`: its request body's top-level fields,
 * each with the values it allows when it lists them (enum), and whether
 * something outside the contracts answers it (x-relationship external, on it
 * or at its document's root).
 *
 * @returns {{ requestFields: Map<string, Map<string, unknown[]|null>>, external: Set<string> }}
 */
function operationFacts(docs) {
  const requestFields = new Map();
  const external = new Set();
  for (const doc of docs) {
    if (doc.type !== 'openapi') continue;
    const wholeApi = doc.content?.['x-relationship']?.type === 'external';
    for (const item of Object.values(doc.content?.paths ?? {})) {
      for (const operation of Object.values(item ?? {})) {
        if (!operation?.operationId) continue;
        const key = `${doc.api}#${operation.operationId}`;
        if (wholeApi || operation['x-relationship']?.type === 'external') external.add(key);
        const json = operation.requestBody?.content?.['application/json']?.schema;
        const fields = new Map();
        collectFields(json, doc.content, fields);
        if (fields.size) requestFields.set(key, fields);
      }
    }
  }
  return { requestFields, external };
}

/** A request schema's top-level fields, through same-document refs and allOf, oneOf, anyOf. */
function collectFields(schema, root, fields, seen = new Set()) {
  if (!schema || typeof schema !== 'object' || seen.has(schema)) return;
  seen.add(schema);
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/')) {
    collectFields(schema.$ref.slice(2).split('/').reduce((at, key) => at?.[key], root), root, fields, seen);
    return;
  }
  for (const [field, property] of Object.entries(schema.properties ?? {})) {
    if (!fields.has(field)) fields.set(field, Array.isArray(property?.enum) ? property.enum : null);
  }
  for (const part of [...(schema.allOf ?? []), ...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]) collectFields(part, root, fields, seen);
}

/**
 * Check routing against its schema and against the contract set. Every
 * problem is listed, not only the first: an entry naming nothing is the
 * failure this repository keeps finding — a declaration nobody reads, which
 * looks configured and does nothing.
 *
 * Warnings are what routing allows and the routing pattern advises against:
 * a single operation routed apart from its resource's other operations, which
 * splits the resource's data between two places.
 *
 * @param {unknown} document - A routing file's content: `{ routing: [...] }`
 * @param {import('../types.js').Doc[] | ReturnType<typeof routingFacts>} contracts - The contract set, or its facts
 * @returns {{ errors: string[], warnings: string[], entries: Array<{ entry: object, name: string, operation: object|null, except: object[] }> }}
 *   `entries` is for a runtime applying the routing
 */
export function validateRouting(document, contracts) {
  const errors = schemaProblems(document);
  const warnings = [];
  if (errors.length) return { errors, warnings, entries: [] };
  const { operations, domainOfApi, sockets, requestFields = new Map(), external = new Set() } = Array.isArray(contracts) ? routingFacts(contracts) : contracts;
  const apis = new Set(domainOfApi.keys());
  const domains = new Set(domainOfApi.values());
  const routing = document.routing;

  const find = (ref, name) => {
    const { operation, candidates } = operations?.find(ref) ?? { candidates: [] };
    if (operation) return operation;
    errors.push(candidates.length > 1
      ? `${name} names an operation more than one API declares; write ${candidates.map((o) => `$apis.${o.api}.${o.id}`).join(' or ')}`
      : `${name} names no operation the contracts declare`);
    return null;
  };

  const seen = new Set();
  const entries = routing.map((entry, index) => {
    const name = entryName(entry, index);
    const id = `${entry.domain ? `domain ${entry.domain}` : entry.api ? `api ${entry.api}` : `operation ${entry.operation}`}${entry.match ? ` match ${JSON.stringify(entry.match)}` : ''}`;
    if (seen.has(id)) errors.push(`${name} is configured more than once`);
    seen.add(id);
    const answers = ['to', 'handler'].filter((key) => entry[key] !== undefined);
    if (answers.length !== 1) errors.push(`${name} needs exactly one of "to" or "handler"`);
    if (entry.handler !== undefined && !['function', 'string', 'object'].includes(typeof entry.handler)) {
      errors.push(`${name}'s handler is a module's path in a file; in code, a function, (request) => response, a module, or for an API reached over its own connection, a class used as new WebSocket(url, protocols)`);
    }

    let operation = null;
    if (entry.domain && entry.domain !== EVERY_DOMAIN && !domains.has(entry.domain)) {
      errors.push(`${name} declares no APIs. Domains the contracts declare: ${[...domains].sort().join(', ')}`);
    }
    if (entry.api && !apis.has(entry.api)) {
      errors.push(`${name} is no API the contracts declare. APIs: ${[...apis].sort().join(', ')}`);
    }
    if (entry.api && sockets.has(entry.api)) {
      if (entry.except) errors.push(`${name} is reached over its own connection, which goes one place, so it takes no except`);
      if (entry.includeHeaders) errors.push(`${name} is reached over its own connection, which passes on the subprotocols the client offered and no headers, so it takes no includeHeaders`);
      if (entry.match) errors.push(`${name} is reached over its own connection, which goes one place, so it takes no match`);
    }
    if (entry.operation) {
      operation = find(entry.operation, name);
      if (operation && sockets.has(operation.api)) {
        errors.push(`${name} is an operation of ${operation.api}, which is reached over its own connection; its messages all travel on it, so route the API instead`);
      }
      if (operation?.kind === 'asyncapi' && operation.action !== 'receive') {
        errors.push(`${name} is a send operation; an API sends its own events. Route the receive operation that hears it instead.`);
      }
      if (entry.except) errors.push(`${name} is one operation, so it takes no except`);
    }
    if (!(entry.api && sockets.has(entry.api)) && /^wss?:/.test(entry.to ?? '')) {
      errors.push(`${name} is routed to a WebSocket URL, ${entry.to}; only an API reached over its own connection is. Use an http or https URL`);
    }

    if (entry.match) {
      // Each field a match names is in the body of a request the entry
      // covers, and its value is one that field allows.
      const covered = (operations?.all ?? []).filter((o) => o.kind === 'openapi'
        && (operation ? o === operation : o.api === entry.api));
      for (const [path, value] of Object.entries(entry.match)) {
        const field = path.split('.')[0];
        const declaring = covered.map((o) => requestFields.get(`${o.api}#${o.id}`)).filter((fields) => fields?.has(field));
        if (covered.length && !declaring.length) {
          errors.push(`${name} matches "${path}", which no request it routes has`);
          continue;
        }
        const allowed = path === field ? [...new Set(declaring.flatMap((fields) => fields.get(field) ?? []))] : [];
        if (allowed.length && !allowed.includes(value)) {
          errors.push(`${name} matches ${path} "${value}", which ${field} doesn't allow. It allows: ${allowed.join(', ')}`);
        }
      }
    }

    const except = (entry.except ?? []).map((item) => {
      if (item.api) {
        if (entry.domain === EVERY_DOMAIN && !apis.has(item.api)) {
          errors.push(`${name} excepts API "${item.api}", which the contracts don't declare. APIs: ${[...apis].sort().join(', ')}`);
        } else if (entry.domain !== EVERY_DOMAIN && (!entry.domain || domainOfApi.get(item.api) !== entry.domain)) {
          errors.push(`${name} excepts API "${item.api}", which isn't inside it. An except names an API in the entry's domain, or an operation in the entry's domain or API.`);
        }
        return { api: item.api };
      }
      const excepted = find(item.operation, `${name}'s except`);
      if (excepted) {
        const inside = entry.api ? excepted.api === entry.api
          : entry.domain === EVERY_DOMAIN || domainOfApi.get(excepted.api) === entry.domain;
        if (!inside) errors.push(`${name} excepts "${item.operation}", which isn't inside it.`);
      }
      return { operation: excepted };
    }).filter((item) => item.api || item.operation);
    return { entry, name, operation, except };
  });

  // A single operation routed on its own, when no match chooses it per request
  // and something other than the contracts doesn't answer it anyway, splits
  // its API's data: what one place creates, the other doesn't have.
  for (const { entry, name, operation } of entries) {
    if (!operation || operation.kind !== 'openapi' || entry.match || external.has(`${operation.api}#${operation.id}`)) continue;
    const apiRouted = entries.some((other) => other.entry !== entry && (other.entry.api === operation.api
      || other.entry.domain === EVERY_DOMAIN || (other.entry.domain && other.entry.domain === domainOfApi.get(operation.api))));
    if (!apiRouted) {
      warnings.push(`${name} is routed apart from the rest of ${operation.api}. If it reads or writes that API's records, the two places will disagree about what exists; route the API instead. Routing one operation fits when something outside the contracts answers it, or it keeps no data of its own.`);
    }
  }
  return { errors, warnings, entries };
}
