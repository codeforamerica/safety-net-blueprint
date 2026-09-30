/**
 * Where each blueprint extension is allowed to appear.
 *
 * Internal to core. Not on the package entry point — `validate` is what
 * consumers reach this through.
 *
 * A specification extension is legal anywhere in OpenAPI 3.1, so a misplaced
 * one is not a schema error: it parses, it validates, and it does nothing.
 * `x-status: deprecated` written at the document root rather than under
 * `info` reads as correct to its author while every tool in the pipeline goes
 * on treating the API as live. Silent no-ops are the reason this is an error
 * rather than a warning — a warning on an otherwise green run is not read.
 *
 * Only extensions listed here are checked. Contracts carry plenty of others —
 * x-data-classification, x-search, x-pagination, x-derived, x-casing — and
 * states are free to invent more; nothing below restricts that. What it
 * catches is a *blueprint* extension written somewhere blueprint tooling
 * provably will not look for it.
 *
 * Kept in step with docs/conventions/extensions.yaml by
 * tests/check-extension-locations.js, since the convention doc is the human
 * description of the same rule and core cannot read it — `docs/` is not part
 * of the published package.
 */

/**
 * Contexts an extension can be written in.
 *
 * root            the document's own top level, peer to info and paths
 * info            inside the info object
 * operation       inside an HTTP method object under paths
 * schema-property inside a single property of a schema
 */
export const EXTENSION_LOCATIONS = {
  'x-domain': ['info', 'operation'],
  'x-enum-source': ['schema-property'],
  'x-events': ['root'],
  'x-relationship': ['schema-property', 'operation'],
  'x-sortable': ['operation'],
  'x-status': ['info', 'operation'],
  'x-visibility': ['info', 'operation'],
};

/** How each context reads in a diagnostic. */
export const LOCATION_LABELS = {
  root: 'the document root',
  info: 'info',
  operation: 'an operation',
  'schema-property': 'a schema property',
};
