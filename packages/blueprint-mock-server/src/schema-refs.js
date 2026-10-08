/**
 * Following a `$ref` to the schema it names, one hop at a time.
 *
 * The server used to be handed specs with every `$ref` already inlined, by
 * `$RefParser.dereference`. That is why it needed a dereferenced copy of a
 * contract set it already held in full: the refs all point at documents in the
 * same set, so nothing was missing — only pre-flattened (#448).
 *
 * Inlining is expensive in a way that matters here. Dereferencing duplicates
 * every shared schema at every site that references it: the harness contracts
 * go from 212K to 720K on disk, and a bundled artifact from 0.67 MB to 3.95 MB.
 * In memory it is the same multiplication. So this resolves a ref when
 * something actually needs to see through it, and returns the node that is
 * already there rather than a copy of it — a pointer hop, not a flattening.
 *
 * One hop, deliberately. A caller walking a schema tree meets refs as it goes
 * and resolves each where it meets it, which is also what keeps the cost
 * proportional to what is read rather than to the size of the set.
 */

/**
 * Walk a JSON pointer into a document.
 *
 * @param {*} content - Parsed document
 * @param {string} pointer - e.g. `/components/schemas/Application`
 * @returns {*} The node, or undefined when any segment is missing
 */
function pointerInto(content, pointer) {
  let node = content;
  for (const rawSegment of pointer.split('/').filter(Boolean)) {
    // JSON Pointer escapes: ~1 is '/', ~0 is '~'. Order matters.
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object') return undefined;
    node = node[segment];
  }
  return node;
}

/**
 * The node a `$ref` names, within the contract set.
 *
 * Handles both forms the specs use. A same-document ref (`#/components/...`)
 * is a pointer into the referring document; a cross-file one goes through the
 * Doc's own resolver, which matches the file part against the set's relative
 * paths.
 *
 * @param {string} ref - A `$ref` value
 * @param {import('@codeforamerica/blueprint-core').Doc} doc - The document holding the ref
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs - The set
 * @returns {*} The referenced node, or undefined when it names nothing here
 */
export function resolveRefNode(ref, doc, docs) {
  if (typeof ref !== 'string' || !ref) return undefined;

  if (ref.startsWith('#')) {
    return pointerInto(doc.content, ref.slice(1));
  }

  // Canonical https refs resolve through the schema registry, not the set.
  if (ref.startsWith('http://') || ref.startsWith('https://')) return undefined;

  const found = doc.resolveRef(ref, docs);
  // resolveRef answers `{}` for a ref it cannot place, which is
  // indistinguishable from an empty schema — report nothing instead.
  return found && Object.keys(found).length > 0 ? found : undefined;
}

/**
 * A schema with its top-level `$ref` followed, if it has one.
 *
 * Returns the schema untouched when it is not a ref, so a caller can apply it
 * to anything it is about to read without checking first. Only the top level:
 * nested refs are resolved by whatever walks into them.
 *
 * @param {*} schema
 * @param {import('@codeforamerica/blueprint-core').Doc} doc
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
 * @returns {*} The resolved schema, or the original
 */
export function followSchema(schema, doc, docs) {
  if (!schema || typeof schema !== 'object' || typeof schema.$ref !== 'string') return schema;
  const resolved = resolveRefNode(schema.$ref, doc, docs);
  if (resolved === undefined) return schema;

  // A ref alongside sibling keywords: the ref supplies the base and the
  // siblings narrow it. Keeping both matches how the specs are written —
  // `{ allOf: [$ref], nullable: true }` and `{ $ref, description }` both occur.
  const { $ref, ...siblings } = schema;
  return Object.keys(siblings).length > 0 ? { ...resolved, ...siblings } : resolved;
}

/**
 * A resolver bound to one document and its set.
 *
 * Handed to the route generator and handlers as part of an API's metadata, so
 * a caller that meets a `$ref` while walking a schema can follow it without
 * having to carry the whole document set around to do it.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc} doc
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
 * @returns {{ node: (ref: string) => *, schema: (schema: *) => * }}
 */
export function resolverFor(doc, docs) {
  return {
    node: (ref) => resolveRefNode(ref, doc, docs),
    schema: (schema) => followSchema(schema, doc, docs),
  };
}
