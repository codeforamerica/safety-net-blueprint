/**
 * Adapters in Try it. An adapter is an API answered outside the contracts
 * (x-relationship external), which a resource's state machine calls, as a
 * transcription session calls its adapter's startStream.
 *
 * On an API reference page in the mock, every adapter answers with its
 * contract's example response, so each operation is one request and one
 * response: a session's start returns with the session connecting, and
 * nothing connects it. In another environment, the site's routing answers it.
 */

const METHODS = ['get', 'put', 'post', 'patch', 'delete'];

/** The documents of the APIs answered outside the contracts. */
const adapterDocs = (docs) => docs.filter((doc) => doc.type === 'openapi' && doc.adapter);

/**
 * The routing with every adapter answered from its contract: each adapter's
 * routing entries give way to a handler for each of its operations that
 * answers with the first success response's example.
 *
 * @param {object[]} routing - routingInUse's
 * @param {object[]} docs
 * @returns {object[]}
 */
export function answeredFromExamples(routing, docs) {
  let result = routing;
  for (const doc of adapterDocs(docs)) {
    result = [...result.filter((entry) => entry.api !== doc.api), { api: doc.api, handler: exampleHandlers(doc, docs) }];
  }
  return result;
}

/** A handler for each of an adapter's operations, answering with its contract's example. */
function exampleHandlers(doc, docs) {
  const handlers = {};
  for (const item of Object.values(doc.content?.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item?.[method];
      if (!operation?.operationId) continue;
      const [status, response] = Object.entries(operation.responses ?? {}).find(([code]) => /^2\d\d$/.test(code)) ?? ['200', null];
      const body = responseExample(doc, docs, response);
      handlers[operation.operationId] = async () => new Response(body === undefined ? null : JSON.stringify(body), {
        status: Number(status), headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      });
    }
  }
  return handlers;
}

/** A node, its `$ref` followed within its document or into another of the set. */
const followed = (doc, node, docs) => {
  const at = inDocument(doc, node);
  return typeof at?.$ref === 'string' ? doc.resolveRef(at.$ref, docs) : at;
};

/** A response's example body, from the contract: its own, a named one, or its schema's. */
function responseExample(doc, docs, response) {
  const content = followed(doc, response, docs)?.content?.['application/json'];
  if (!content) return undefined;
  if (content.example !== undefined) return content.example;
  const named = Object.values(content.examples ?? {})[0];
  if (named) return followed(doc, named, docs)?.value;
  return followed(doc, content.schema, docs)?.example ?? {};
}

/** A node, following a $ref within its own document (`#/...`). */
function inDocument(doc, node) {
  if (typeof node?.$ref !== 'string' || !node.$ref.startsWith('#')) return node;
  return node.$ref.slice(2).split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((at, key) => at?.[key], doc.content);
}
