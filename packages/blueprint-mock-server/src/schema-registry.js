/**
 * An ajv instance that knows the whole contract set.
 *
 * Validation was the one place that genuinely needed dereferenced specs, and
 * it needed them for a reason worth stating: ajv compiles a schema, and a
 * `$ref` it cannot resolve is a hard error, not a skipped check. So when the
 * server stopped being handed pre-inlined specs, mock-data validation failed
 * with `can't resolve reference ../case-management/case-management-schema.yaml`
 * (#448).
 *
 * Inlining was never the only answer. `$ref` resolution is what JSON Schema
 * `$id` is *for*: register each document under an identifier, and ajv follows
 * a relative ref from one document to another itself. That is the junction
 * model, natively — one registration per document, rather than a copy of every
 * shared schema at every site that references it.
 *
 * `validator.js` used to strip `$id` before compiling, with a comment saying
 * the validator "only needs to check structure, not resolve cross-schema $refs
 * by ID". That was true only because something else had already resolved them.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

/** Scheme for document identifiers. Hierarchical, so `../` resolves. */
const SCHEME = 'blueprint:///';

/**
 * Document types a `$ref` from a schema can name.
 *
 * Deliberately a list rather than "everything with a relativePath". A
 * blueprint contract is not a JSON Schema document and reads as a broken one:
 * `platform-registry-policies.yaml` declares `type: policies`, which ajv takes
 * for the JSON Schema `type` keyword and rejects as an unknown type. Nothing
 * refs into a registry, an annotations file or a state machine from a schema,
 * so registering them buys nothing and costs a spurious error.
 */
const REF_TARGET_TYPES = new Set(['openapi', 'asyncapi', 'schema', 'components']);

/**
 * The identifier a document is registered under.
 *
 * Built from the path a `$ref` names it with, so a relative ref resolves by
 * ordinary URI arithmetic: `../case-management/case-management-schema.yaml`
 * from `blueprint:///domains/client-management/client-management-openapi.yaml`
 * lands on `blueprint:///domains/case-management/case-management-schema.yaml`.
 *
 * @param {string} relativePath - Path within the contract set
 * @returns {string}
 */
export function schemaIdFor(relativePath) {
  return `${SCHEME}${relativePath}`;
}

/**
 * An ajv configured the way the server has always validated.
 *
 * @param {object} [options] - Merged over the defaults
 * @returns {import('ajv').default}
 */
export function createAjv(options = {}) {
  // The default build, which is the dialect the server has always validated
  // against. The 2020-12 build is tempting — it is the dialect the documents
  // declare — but it enforces `unevaluatedProperties`, which draft-07 ignores
  // as unknown, so switching would silently make validation stricter and fail
  // seed data that has always passed. That is a change worth making
  // deliberately, not as a side effect of resolving refs differently.
  const ajv = new Ajv({ strict: false, allErrors: true, ...options });
  addFormats(ajv);
  return ajv;
}

/**
 * A document ajv will accept, derived from one it will not.
 *
 * Two things are removed, and one added:
 *
 *   `$schema`   names the dialect, and a blueprint contract names a blueprint
 *               schema file rather than a meta-schema, which ajv cannot
 *               resolve as a dialect.
 *   `nullable`  only where no sibling `type` is declared. ajv 8 handles
 *               `{ type: string, nullable: true }` correctly, and removing it
 *               there would reject the `null` that such a field exists to
 *               allow. What it cannot handle is `{ allOf: [$ref], nullable:
 *               true }`, where it throws for want of a `type` — so the
 *               keyword goes only when there is nothing for it to qualify.
 *   `$id`       set to the document's path, so relative refs out of it resolve.
 *
 * One normalized copy per document — bounded by the size of the set, not
 * multiplied by the number of references into it, which is the whole reason
 * for registering rather than inlining.
 *
 * @param {*} node
 * @returns {*}
 */
function withoutOpenApiExtensions(node) {
  if (Array.isArray(node)) return node.map(withoutOpenApiExtensions);
  if (!node || typeof node !== 'object') return node;

  // `nullable` is meaningful to ajv only alongside a `type` it can widen.
  const keepsNullable = typeof node.type === 'string' || Array.isArray(node.type);

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema') continue;
    if (key === 'nullable' && !keepsNullable) continue;
    out[key] = withoutOpenApiExtensions(value);
  }
  return out;
}

/**
 * Register every document a `$ref` could name.
 *
 * An OpenAPI or AsyncAPI document, a shared schema library and a component
 * library can all be named by a `$ref` from a schema; the blueprint contract
 * types cannot, and do not survive being read as JSON Schema — see
 * `REF_TARGET_TYPES`. A document with no `relativePath` is skipped too, since
 * there is then no path a ref could name it with.
 *
 * Each document's own `$id` is replaced with its path-derived one. The two
 * would otherwise compete to define the base that relative refs resolve
 * against, and only the path knows where the document actually sits. The
 * replacement is a shallow copy — one per document, not one per reference.
 *
 * @param {import('ajv').default} ajv
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
 * @returns {{ registered: number, skipped: string[] }}
 */
export function registerDocuments(ajv, docs) {
  let registered = 0;
  const skipped = [];

  for (const doc of docs) {
    if (!doc.relativePath || !doc.content || typeof doc.content !== 'object') continue;
    if (!REF_TARGET_TYPES.has(doc.type)) continue;

    const $id = schemaIdFor(doc.relativePath);
    if (ajv.getSchema($id)) continue;

    try {
      ajv.addSchema({ ...withoutOpenApiExtensions(doc.content), $id }, $id);
      registered += 1;
    } catch (error) {
      // A document ajv will not accept is worth naming, but not worth
      // stopping a boot for: a ref into it fails later with a message that
      // says which ref, which is more useful than this one.
      skipped.push(`${doc.relativePath}: ${error.message}`);
    }
  }

  return { registered, skipped };
}

/**
 * A validator for one schema within a registered document.
 *
 * Addressed by pointer rather than handed the schema object, which is what
 * makes refs inside it resolvable: ajv knows which document the pointer is
 * in, so it knows the base to resolve them against. Handing over the detached
 * object loses that, and is why a ref failed "from id #" — no base at all.
 *
 * @param {import('ajv').default} ajv
 * @param {string} relativePath - The document holding the schema
 * @param {string} pointer - JSON pointer, e.g. `/components/schemas/Case`
 * @returns {import('ajv').ValidateFunction|null} Null when it does not resolve
 */
export function validatorFor(ajv, relativePath, pointer) {
  try {
    return ajv.getSchema(`${schemaIdFor(relativePath)}#${pointer}`) ?? null;
  } catch {
    return null;
  }
}

/**
 * A validator for the schema a `$ref` names, resolved from a document.
 *
 * The ref is resolved as a URI against the referring document's identifier,
 * which is what makes both forms work from one call: `#/components/schemas/X`
 * stays in the document, and `../intake/intake-schema.yaml#/$defs/Application`
 * crosses to another. Ordinary URI arithmetic, because the identifiers were
 * built to make it so.
 *
 * @param {import('ajv').default} ajv
 * @param {string} relativePath - The document the ref was written in
 * @param {string} ref - A `$ref` value
 * @returns {import('ajv').ValidateFunction|null} Null when it does not resolve
 */
export function validatorForRef(ajv, relativePath, ref) {
  if (!relativePath || typeof ref !== 'string' || !ref) return null;

  try {
    const resolved = new URL(ref, schemaIdFor(relativePath)).href;
    return ajv.getSchema(resolved) ?? null;
  } catch {
    return null;
  }
}
