/**
 * What each contract type is, stated once.
 *
 * Type detection, filename conventions, and which types are blueprint-authored
 * all read from this table. They were previously three separate lists — an
 * inline table in detectType, filename suffixes hardcoded wherever a sibling
 * spec had to be named, and a hand-maintained set of authored types — which
 * drift independently and fail quietly when they do.
 *
 * Fields, all optional:
 *   schema    basename of the blueprint schema a document of this type declares
 *   suffix    filename suffix identifying the type when content does not
 *   aliases   additional suffixes mapping to the same type
 *   authored  true when states author this by hand, so it is extended by
 *             overlay rather than replaced wholesale
 */

export const CONTRACT_TYPES = {
  openapi:          { suffix: '-openapi.yaml' },
  asyncapi:         { suffix: '-asyncapi.yaml' },
  'state-machine':  { schema: 'state-machine-schema.yaml', suffix: '-state-machine.yaml', authored: true },
  rules:            { schema: 'rules-schema.yaml', suffix: '-rules.yaml', authored: true },
  'rules-examples': { schema: 'rules-examples-schema.yaml', suffix: '-rules-examples.yaml' },
  graph:            { schema: 'graph-schema.yaml', suffix: '-graph.yaml' },
  compositions:     { schema: 'compositions-schema.yaml', suffix: '-compositions.yaml', authored: true },
  annotations:      { schema: 'annotations-schema.yaml', suffix: '-annotations.yaml', aliases: ['-annotations-docs.yaml'], authored: true },
  // Registries are generic: core knows the format, not which types exist. A
  // type like 'policies' is declared by the contracts that need it.
  registry:         { schema: 'registry-schema.yaml' },
  'sla-types':      { schema: 'sla-types-schema.yaml', suffix: '-sla-types.yaml', authored: true },
  metrics:          { schema: 'metrics-schema.yaml', suffix: '-metrics.yaml', authored: true },
  schema:           { suffix: '-schema.yaml' },
  'mock-data':      { suffix: '-mock-data.yaml' },
  config:           { suffix: '-config.yaml' },
  // Carries `actions:` to apply, a `config:` block of cross-cutting settings,
  // or both. One type: which of the two an overlay happens to declare is a
  // property of the document, not a different kind of document.
  overlay:          { suffix: '-overlay.yaml' },
  components:       {},
};

/**
 * Whether a document has been retired.
 *
 * A deprecated spec stays in the tree for reference but is not resolved,
 * validated or served. Stated once because three callers were each testing
 * `info['x-status']` themselves and a fourth would have made it four.
 *
 * @param {object} content - Parsed document content
 * @returns {boolean}
 */
export function isDeprecated(content) {
  return content?.info?.['x-status'] === 'deprecated';
}

/**
 * Extract a domain value from a file entry using layered heuristics.
 *
 * Priority:
 *   1. content.info['x-domain']  — explicit annotation on openapi/asyncapi specs
 *   2. content.domain            — top-level field on annotations files
 *   3. A path segment matching a known domain value
 *   4. The filename prefix before the first '-' if it matches a known domain value
 *   5. null
 *
 * @param {string} filename
 * @param {string} relativePath - Forward-slash relative path from the root dir
 * @param {object} content - Parsed YAML content
 * @param {Set<string>} knownDomains - Valid domain values from the resolved Domain enum
 * @returns {string|null}
 */
export function extractDomain(filename, relativePath, content, knownDomains) {
  if (content?.info?.['x-domain']) return content.info['x-domain'];
  if (content?.domain) return content.domain;

  const segments = relativePath.split('/').slice(0, -1);

  for (const segment of segments) {
    if (knownDomains.has(segment)) return segment;
  }

  const dashIdx = filename.indexOf('-');
  if (dashIdx > 0) {
    const prefix = filename.slice(0, dashIdx);
    if (knownDomains.has(prefix)) return prefix;
  }

  // A directory under `domains/` names a domain whether or not the Domain enum
  // lists it. Checked after the enum, so it only answers where the enum was
  // silent — and the enum can be silent: a set may declare `domains/scheduling`
  // without having added `scheduling` to the enum yet, which left every
  // document there domainless unless it happened to say so itself. That split a
  // domain in half, with `scheduling-openapi.yaml` carrying `x-domain` and
  // `scheduling-mock-data.yaml` carrying nothing — so a per-domain bundle of it
  // shipped an API with an empty store.
  //
  // Not a general path fallback, which is why the enum check stays: `base/` and
  // `common/` hold documents shared across domains, and inferring `base` as a
  // domain from the directory name would be worse than inferring nothing.
  const domainsIdx = segments.indexOf('domains');
  if (domainsIdx !== -1 && segments[domainsIdx + 1]) {
    return segments[domainsIdx + 1];
  }

  return null;
}


/**
 * `x-relationship.resource` values that name no resource.
 *
 * `External` identifies a record in a system outside the blueprint;
 * `Polymorphic` identifies one whose type is selected by a sibling
 * discriminator field. Neither can be resolved to a schema, so both stay
 * scalar foreign keys — there is nothing to expand or link to.
 */
export const RESERVED_RESOURCES = new Set(['External', 'Polymorphic']);

/**
 * @param {string} [resource] - An x-relationship resource value
 * @returns {boolean} True when the value names no resolvable schema
 */
export function isReservedResource(resource) {
  return RESERVED_RESOURCES.has(resource);
}

const BY_SCHEMA = new Map(
  Object.entries(CONTRACT_TYPES)
    .filter(([, def]) => def.schema)
    .map(([type, def]) => [def.schema, type])
);

// Longest suffix first, so -rules-examples.yaml is not claimed by -rules.yaml
// and -annotations-docs.yaml is not claimed by -annotations.yaml.
const BY_SUFFIX = Object.entries(CONTRACT_TYPES)
  .flatMap(([type, def]) => [def.suffix, ...(def.aliases ?? [])].filter(Boolean).map((s) => [s, type]))
  .sort(([a], [b]) => b.length - a.length);

/**
 * The type a blueprint `$schema` basename identifies.
 *
 * @param {string} schemaRef - Value of a document's $schema
 * @returns {string|null}
 */
export function typeFromSchema(schemaRef) {
  if (typeof schemaRef !== 'string') return null;
  return BY_SCHEMA.get(schemaRef.split('/').pop()) ?? null;
}

/**
 * The type a filename identifies.
 *
 * @param {string} filename
 * @returns {string|null}
 */
export function typeFromFilename(filename) {
  if (typeof filename !== 'string') return null;
  return BY_SUFFIX.find(([suffix]) => filename.endsWith(suffix))?.[1] ?? null;
}

/**
 * Detect the contract file type from parsed document content and/or filename.
 *
 * Detection order:
 *   1. doc.$schema URI — canonical for all blueprint contract types
 *   2. doc.openapi / doc.asyncapi version fields — OpenAPI/AsyncAPI have no $schema
 *   3. Filename suffix — fallback for files without a type marker in content
 *
 * @param {string} filename
 * @param {object} [doc] - parsed YAML content (optional)
 * @returns {string}
 */
export function detectType(filename, doc) {
  if (doc && typeof doc === 'object') {
    const schema = doc.$schema;
    // A JSON Schema document names a json-schema.org meta-schema. Checked
    // before the blueprint table so these are typed by what they declare
    // rather than falling through to the filename.
    if (typeof schema === 'string' && schema.includes('json-schema.org')) return 'schema';

    const bySchema = typeFromSchema(schema);
    if (bySchema) return bySchema;

    // Version fields are how these three declare themselves; an overlay names
    // the Overlay Specification version the same way OpenAPI and AsyncAPI do,
    // and is not required to carry a -overlay.yaml suffix.
    if (doc.openapi) return 'openapi';
    if (doc.asyncapi) return 'asyncapi';
    // Carrying `actions:`, `config:` or both — all of them are overlays.
    if (doc.overlay) return 'overlay';
  }

  const byFilename = typeFromFilename(filename);
  if (byFilename) return byFilename;

  // OpenAPI component libraries carry no version field or $schema — they are
  // bare maps of component objects. Checked last, so it only ever reclassifies
  // what would otherwise be 'unknown'. One type covers all of them; callers
  // wanting a specific library match on the shape of the objects inside.
  if (isComponentLibrary(doc)) return 'components';
  return 'unknown';
}

/**
 * Whether a document is a bare map of OpenAPI component objects.
 *
 * A component library has no document-level marker at all — no version field,
 * no $schema, no $id — and every top-level key is a component name mapping to
 * an object. Rather than guess at which keys a component carries (Parameter,
 * Response, Schema and Example objects share almost nothing), this checks only
 * that shape. It runs last, so it can only reclassify documents that would
 * otherwise be 'unknown'.
 *
 * @param {object} [doc] - parsed YAML content
 * @returns {boolean}
 */
function isComponentLibrary(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  if (doc.$schema || doc.$id || doc.openapi || doc.asyncapi) return false;

  const values = Object.values(doc);
  if (values.length === 0) return false;

  return values.every(
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  );
}

/**
 * Whether states author documents of this type by hand.
 *
 * Authored content is extended by overlay; replacing it wholesale discards a
 * baseline the state did not write.
 *
 * @param {string} type
 * @returns {boolean}
 */
export function isAuthored(type) {
  return CONTRACT_TYPES[type]?.authored === true;
}

/**
 * Strip a type's suffix from a path, leaving the stem shared by its siblings.
 *
 * `domains/intake/intake-compositions.yaml` → `domains/intake/intake`
 *
 * @param {string} path - Relative path within the contract set
 * @param {string} type
 * @returns {string|null} The stem, or null when the path does not carry the suffix
 */
export function stemOf(path, type) {
  const suffix = CONTRACT_TYPES[type]?.suffix;
  if (!suffix || !path.endsWith(suffix)) return null;
  return path.slice(0, -suffix.length);
}

/**
 * The path of a sibling document of another type, sharing a stem.
 *
 * `domains/intake/intake` + `openapi` → `domains/intake/intake-openapi.yaml`
 *
 * @param {string} stem
 * @param {string} type
 * @returns {string|null} The path, or null when the type has no filename convention
 */
export function siblingPath(stem, type) {
  const suffix = CONTRACT_TYPES[type]?.suffix;
  return suffix ? `${stem}${suffix}` : null;
}

/**
 * The filename at the end of a contract path, optionally with a suffix removed.
 *
 * `node:path`'s `basename` for the one case this package uses it for: naming
 * and comparing contract documents. Written out rather than imported so the
 * modules that compare documents by filename stay free of Node builtins and
 * can run in a browser (#448).
 *
 * Both separators are treated as separators, because callers pass two kinds of
 * string: a `relativePath` within the set, always `/`-separated, and a `path`
 * from `discover`, which is an OS path. `basename` is platform-dependent and
 * splits on `\` only on Windows; this does so everywhere, which is correct for
 * both kinds and wrong only for a posix filename with a literal backslash in
 * it — not a thing a contract set contains.
 *
 * Checked against `basename` case by case in `contract-types.test.js`,
 * including the corners: a trailing separator names the directory it ends, and
 * a suffix that is the entire filename strips to an empty string.
 *
 * @param {string} path - A path separated by `/` or `\`
 * @param {string} [suffix] - Removed from the end of the filename when present
 * @returns {string}
 */
export function fileNameOf(path, suffix) {
  if (typeof path !== 'string') return '';
  // A trailing separator names the directory, so drop it before taking the
  // last segment — `basename('domains/intake/')` is `intake`.
  const segments = path.replace(/[/\\]+$/, '').split(/[/\\]/);
  const name = segments[segments.length - 1];
  if (suffix && name.endsWith(suffix)) return name.slice(0, -suffix.length);
  return name;
}
