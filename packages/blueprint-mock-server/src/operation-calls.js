/**
 * Checking an operation call a write carries — a suggestion's proposed change —
 * against the operation it names.
 *
 * A call is a value in the shared `OperationCall` shape
 * (base/schemas/operations.yaml): an operationId, its parameters by name and
 * location, and a requestBody with its payload. Wherever a request schema uses that shape, the call is
 * checked the way the operation would check the request it stands for: the
 * operationId is one the set declares, as overlays leave it; each parameter is
 * one the operation declares, every required one is given, and each value
 * matches its schema; and the body matches the operation's request schema.
 *
 * Operations a state machine adds — an action like `pauseTranscript` — are
 * calls too, so they are read from the documents, not from the routes.
 */

import { extract } from '@codeforamerica/blueprint-core/browser';
import { validate } from './validator.js';

const OPERATION_CALL = /(^|\/)schemas\/operations\.yaml#\/\$defs\/OperationCall$/;
const METHODS = ['get', 'put', 'post', 'patch', 'delete'];

/**
 * Every operation in the set: where it is — its method and full path — its
 * parameters and request schema, and the document they were declared in.
 *
 * Found by what names it, as core finds it (extract(docs, 'operations')): a
 * bare operationId one API declares, or `$apis.<api>.<id>`. An id two APIs
 * declare finds nothing bare; `whyNot` says which to write instead.
 *
 * @param {object[]} apiSpecs - From apiSpecsFromDocs
 * @returns {{ get: (ref: string) => object|undefined, whyNot: (ref: string) => string, [Symbol.iterator]: () => Iterator<[string, object]> }}
 */
export function operationsOf(apiSpecs) {
  // Keyed by document and id: an id is unique only within its document.
  const index = new Map();
  for (const api of apiSpecs ?? []) {
    const follow = api.resolve?.schema ?? ((x) => x);
    for (const [path, item] of Object.entries(api.doc?.content?.paths ?? {})) {
      for (const method of METHODS) {
        const operation = item?.[method];
        const id = operation?.operationId;
        if (!id || index.has(`${api.relativePath}#${id}`)) continue;
        const raw = operation.requestBody?.content?.['application/json']?.schema;
        // Each media type the operation takes, with its schema: a composition's
        // update takes application/json-patch+json and nothing else.
        const bodies = Object.fromEntries(Object.entries(follow(operation.requestBody)?.content ?? {})
          .map(([type, media]) => [type, {
            schema: media?.schema ? follow(media.schema) : null,
            ref: typeof media?.schema?.$ref === 'string' ? media.schema.$ref : null,
          }]));
        index.set(`${api.relativePath}#${id}`, {
          id,
          method: method.toUpperCase(),
          path: `${api.serverBasePath ?? ''}${path}`,
          parameters: [...(item.parameters ?? []), ...(operation.parameters ?? [])].map(follow),
          requestSchema: raw ? follow(raw) : null,
          requestSchemaRef: typeof raw?.$ref === 'string' ? raw.$ref : null,
          bodies,
          follow,
          bodyRequired: Boolean(follow(operation.requestBody)?.required),
          // What it answers, by status, for checking a routed handler's response.
          responses: operation.responses ?? {},
          relativePath: api.relativePath,
        });
      }
    }
  }
  const found = extract((apiSpecs ?? []).map((api) => api.doc).filter(Boolean), 'operations');
  // The API each belongs to, as core names it.
  for (const operation of found?.all ?? []) {
    const details = index.get(`${operation.file}#${operation.id}`);
    if (details) details.api = operation.api;
  }
  const lookup = (ref) => found?.find(ref) ?? { candidates: [] };
  return {
    get(ref) {
      const { operation } = lookup(ref);
      return operation && index.get(`${operation.file}#${operation.id}`);
    },
    whyNot(ref) {
      const { candidates } = lookup(ref);
      return candidates.length > 1
        ? `More than one API has the operationId "${ref}"; write ${candidates.map((o) => `$apis.${o.api}.${o.id}`).join(' or ')}.`
        : `No operation in the contract set has the operationId "${ref}".`;
    },
    *[Symbol.iterator]() {
      for (const operation of index.values()) yield [operation.id, operation];
    },
  };
}

/**
 * The operation calls in a body, where its schema uses the OperationCall shape.
 *
 * Walks the schema and the body together. Of a `oneOf` with a discriminator,
 * only the branch the body names is walked.
 *
 * @param {*} body
 * @param {object} schema - The request schema
 * @param {(schema: *) => *} follow - Resolves a ref
 * @param {string} [at] - Where in the body this is
 * @returns {Array<{ field: string, call: object }>}
 */
export function callsIn(body, schema, follow = (x) => x, at = '') {
  if (!schema || body === null || typeof body !== 'object') return [];
  if (typeof schema.$ref === 'string' && OPERATION_CALL.test(schema.$ref)) {
    return Array.isArray(body) ? [] : [{ field: at, call: body }];
  }
  const resolved = follow(schema);
  if (!resolved || typeof resolved !== 'object') return [];

  if (Array.isArray(body)) {
    return body.flatMap((value, i) => callsIn(value, resolved.items, follow, `${at}[${i}]`));
  }

  const found = [];
  for (const member of resolved.allOf ?? []) found.push(...callsIn(body, member, follow, at));
  if (Array.isArray(resolved.oneOf)) {
    const { propertyName, mapping } = resolved.discriminator ?? {};
    const chosen = propertyName && mapping?.[body[propertyName]];
    const branches = chosen ? [{ $ref: chosen }] : resolved.oneOf;
    for (const branch of branches) found.push(...callsIn(body, branch, follow, at));
  }
  for (const [name, definition] of Object.entries(resolved.properties ?? {})) {
    if (body[name] === undefined) continue;
    found.push(...callsIn(body[name], definition, follow, at ? `${at}.${name}` : name));
  }
  return found;
}

/**
 * What is wrong with a call, as details for a 422. Empty when the operation
 * would accept it.
 *
 * @param {{ field: string, call: object }} found - From callsIn
 * @param {ReturnType<typeof operationsOf>} operations
 * @returns {Array<{ field: string, message: string }>}
 */
export function callProblems({ field, call }, operations) {
  const at = (name) => (field ? `${field}.${name}` : name);
  const operation = operations.get(call.operationId);
  if (!operation) return [{ field: at('operationId'), message: operations.whyNot(call.operationId) }];

  const problems = [];
  const given = call.parameters ?? [];
  given.forEach((parameter, i) => {
    const declared = operation.parameters.find((p) => p.name === parameter.name && p.in === parameter.in);
    if (!declared) {
      problems.push({ field: at(`parameters[${i}]`), message: `${call.operationId} has no ${parameter.in} parameter "${parameter.name}".` });
      return;
    }
    if (!declared.schema) return;
    const { valid, errors } = validate(parameter.value, declared.schema, `${call.operationId}-${parameter.in}-${parameter.name}`);
    if (!valid) {
      for (const error of errors) problems.push({ field: at(`parameters[${i}].value`), message: error.message });
    }
  });
  for (const declared of operation.parameters) {
    if (!(declared.required || declared.in === 'path')) continue;
    // A key guards one request, so whatever makes the call supplies it.
    if (declared.in === 'header' && declared.name.toLowerCase() === 'idempotency-key') continue;
    if (!given.some((p) => p.name === declared.name && p.in === declared.in)) {
      problems.push({ field: at('parameters'), message: `${call.operationId} requires the ${declared.in} parameter "${declared.name}".` });
    }
  }

  const payload = call.requestBody?.payload;
  const contentType = call.requestBody?.contentType ?? 'application/json';
  const body = operation.bodies?.[contentType];
  if (payload === undefined) {
    if (operation.bodyRequired) problems.push({ field: at('requestBody.payload'), message: `${call.operationId} requires a body.` });
  } else if (Object.keys(operation.bodies ?? {}).length === 0) {
    problems.push({ field: at('requestBody.payload'), message: `${call.operationId} takes no body.` });
  } else if (!body) {
    problems.push({ field: at('requestBody.contentType'), message: `${call.operationId} takes ${Object.keys(operation.bodies).join(' or ')}, not ${contentType}.` });
  } else if (body.schema) {
    const { valid, errors } = validate(payload, body.schema, `${call.operationId}-body-${contentType}`,
      { relativePath: operation.relativePath, ref: body.ref });
    if (!valid) {
      for (const error of errors) {
        problems.push({ field: error.field === 'body' ? at('requestBody.payload') : at(`requestBody.payload.${error.field}`), message: error.message });
      }
    }
  }
  return problems;
}
