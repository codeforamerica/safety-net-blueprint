/**
 * Resolve `x-relationship` annotations across the contract set.
 *
 * A foreign key annotated with `x-relationship` is rendered according to the
 * configured style — a `links` object of URI references, or the related
 * object expanded inline. Expanding renames the field (`memberId` → `member`),
 * so example data has to be reconciled with what changed.
 *
 * Schema resolution and example reconciliation are one pass, not two. The
 * renames and link data the first produces are consumed only by the second;
 * keeping them internal is what lets every pass share the contract
 * `(docs, ...) => { docs, warnings, applied }` instead of one pass needing a
 * wider return so it can hand state to a later one.
 *
 * Runs after overlays, so a state's customizations are annotated, and before
 * environment filtering, so removed nodes are not resolved first.
 */

import {
  discoverRelationships,
  resolveRelationships,
  buildSchemaIndex,
  buildExamplesIndex,
  resolveExampleRelationships,
  summarizeResolverDecisions,
} from '../relationships.js';

/** Examples live in their own documents and are reconciled after the schemas. */
const EXAMPLES_SUFFIX = '-openapi-examples.yaml';

/**
 * @param {import('../../types.js').Doc[]} docs
 * @returns {{ docs: object[], warnings: string[], applied: string[] }}
 */
export function resolveRelationshipAnnotations(docs) {
  const style = relationshipStyle(docs);
  const specsByPath = new Map(docs.map((doc) => [doc.relativePath ?? doc.path, doc.content]));
  const schemaIndex = buildSchemaIndex(specsByPath);

  const warnings = [];
  const applied = [];
  const renames = [];
  const links = [];

  const withSchemas = docs.map((doc) => {
    const found = discoverRelationships(doc.content, specsByPath);
    if (found.length === 0) return doc;

    const result = resolveRelationships(doc.content, style, schemaIndex, specsByPath);
    warnings.push(...result.warnings);
    renames.push(...result.expandRenames);
    links.push(...result.linksData);

    const where = doc.relativePath ?? doc.path;
    applied.push(
      `Resolved ${found.length} relationship(s), style ${style ?? 'none'} -> ${where}` +
      summarize(result.decisions)
    );

    return { ...doc, content: result.result };
  });

  if (renames.length === 0 && links.length === 0) {
    return { docs: withSchemas, warnings, applied };
  }

  return reconcileExamples(withSchemas, renames, links, warnings, applied);
}

/**
 * Bring example data in line with the fields relationship resolution renamed.
 *
 * @param {object[]} docs
 * @param {object[]} renames
 * @param {object[]} links
 * @param {string[]} warnings - Accumulated, appended to
 * @param {string[]} applied - Accumulated, appended to
 * @returns {{ docs: object[], warnings: string[], applied: string[] }}
 */
function reconcileExamples(docs, renames, links, warnings, applied) {
  const exampleDocs = docs.filter((doc) => (doc.relativePath ?? doc.path).endsWith(EXAMPLES_SUFFIX));
  if (exampleDocs.length === 0) return { docs, warnings, applied };

  const examplesIndex = buildExamplesIndex(exampleDocs.map((doc) => doc.content));
  const reconciled = new Map();

  for (const doc of exampleDocs) {
    const result = resolveExampleRelationships(doc.content, renames, examplesIndex, links);
    warnings.push(...result.warnings);
    reconciled.set(doc, result.result);
    applied.push(`Reconciled examples with renamed relationship fields -> ${doc.relativePath ?? doc.path}`);
  }

  return {
    docs: docs.map((doc) => (reconciled.has(doc) ? { ...doc, content: reconciled.get(doc) } : doc)),
    warnings,
    applied,
  };
}

/**
 * The style a state configured, or null to leave annotations as metadata.
 *
 * Read from the overlay configuration document in the set rather than passed
 * in, so the pass takes no option the documents do not already carry.
 *
 * @param {import('../../types.js').Doc[]} docs
 * @returns {string|null}
 */
function relationshipStyle(docs) {
  const config = docs.find((doc) => doc.type === 'overlay-config');
  return config?.content?.config?.['x-relationship']?.style ?? null;
}

/**
 * Per-schema counts, for a caller that reports detail.
 *
 * @param {object} [decisions]
 * @returns {string}
 */
function summarize(decisions) {
  if (!decisions) return '';

  const parts = Object.entries(summarizeResolverDecisions(decisions)).map(
    ([schema, c]) =>
      `${schema}: ${c.expandedForward} forward, ${c.expandedExplicitBackRef} explicit upward, ` +
      `${c.backRefsDowngraded} back-ref kept scalar, ${c.linksOnly} links-only`
  );

  return parts.length ? ` (${parts.join('; ')})` : '';
}
