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
