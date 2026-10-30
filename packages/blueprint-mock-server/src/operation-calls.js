/**
 * Checking an operation call a write carries — a suggestion's proposed change —
 * against the operation it names.
 *
 * A call is a value in the shared `OperationCall` shape
 * (base/schemas/operations.yaml): an operationId, its parameters by name and
 * location, and a body. Wherever a request schema uses that shape, the call is
 * checked the way the operation would check the request it stands for: the
 * operationId is one the set declares, as overlays leave it; each parameter is
 * one the operation declares, every required one is given, and each value
 * matches its schema; and the body matches the operation's request schema.
 *
 * Operations a state machine adds — an action like `pauseTranscript` — are
 * calls too, so they are read from the documents, not from the routes.
 */

import { validate } from './validator.js';

const OPERATION_CALL = /(^|\/)schemas\/operations\.yaml#\/\$defs\/OperationCall$/;
const METHODS = ['get', 'put', 'post', 'patch', 'delete'];

/**
 * Every operation in the set, by operationId: its parameters and request
 * schema, and the document they were declared in.
 *
 * @param {object[]} apiSpecs - From apiSpecsFromDocs
 * @returns {Map<string, { parameters: object[], requestSchema: object|null, requestSchemaRef: string|null, bodyRequired: boolean, relativePath: string }>}
 */
export function operationsOf(apiSpecs) {
  const index = new Map();
  for (const api of apiSpecs ?? []) {
    const follow = api.resolve?.schema ?? ((x) => x);
    for (const item of Object.values(api.doc?.content?.paths ?? {})) {
      for (const method of METHODS) {
        const operation = item?.[method];
        const id = operation?.operationId;
        if (!id || index.has(id)) continue;
        const raw = operation.requestBody?.content?.['application/json']?.schema;
        index.set(id, {
          parameters: [...(item.parameters ?? []), ...(operation.parameters ?? [])].map(follow),
          requestSchema: raw ? follow(raw) : null,
          requestSchemaRef: typeof raw?.$ref === 'string' ? raw.$ref : null,
          bodyRequired: Boolean(follow(operation.requestBody)?.required),
          relativePath: api.relativePath,
        });
      }
    }
  }
  return index;
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
  if (!operation) {
    return [{ field: at('operationId'), message: `No operation in the contract set has the operationId "${call.operationId}".` }];
  }

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
    if (!given.some((p) => p.name === declared.name && p.in === declared.in)) {
      problems.push({ field: at('parameters'), message: `${call.operationId} requires the ${declared.in} parameter "${declared.name}".` });
    }
  }

  if (call.body === undefined) {
    if (operation.bodyRequired) problems.push({ field: at('body'), message: `${call.operationId} requires a body.` });
  } else if (!operation.requestSchema) {
    problems.push({ field: at('body'), message: `${call.operationId} takes no body.` });
  } else {
    const { valid, errors } = validate(call.body, operation.requestSchema, `${call.operationId}-body`,
      { relativePath: operation.relativePath, ref: operation.requestSchemaRef });
    if (!valid) {
      for (const error of errors) {
        problems.push({ field: error.field === 'body' ? at('body') : at(`body.${error.field}`), message: error.message });
      }
    }
  }
  return problems;
}
