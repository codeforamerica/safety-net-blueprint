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

/**
 * @param {import('../../types.js').Doc[]} docs
 * @param {string|null} [style] - From overlay config `x-relationship.style`;
 *   null leaves the annotations in place as metadata
 * @returns {{ docs: object[], warnings: string[], applied: string[] }}
 */
export function resolveRelationshipAnnotations(docs, style = null) {
  const specsByPath = new Map(docs.map((doc) => [doc.relativePath ?? doc.path, doc.content]));
  const schemaIndex = buildSchemaIndex(specsByPath);

  const warnings = [];
  const applied = [];
  const renames = [];

  const withSchemas = docs.map((doc) => {
    const found = discoverRelationships(doc.content, specsByPath);
    if (found.length === 0) return doc;

    const result = resolveRelationships(doc.content, style, schemaIndex, specsByPath);
    warnings.push(...result.warnings);
    renames.push(...result.expandRenames);

    const where = doc.relativePath ?? doc.path;
    applied.push(
      `Resolved ${found.length} relationship(s), style ${style ?? 'none'} -> ${where}` +
      summarize(result.decisions)
    );

    return { ...doc, content: result.result };
  });

  if (renames.length === 0) {
    return { docs: withSchemas, warnings, applied };
  }

  return reconcileExamples(withSchemas, renames, warnings, applied);
}

/**
 * Bring an API's documented examples in line with the fields expanding renamed.
 *
 * An example shown for a schema that was expanded still carries the key
 * (`profileId`) where the schema now has the related record (`profile`), so
 * it fails the schema it documents. Each such example gets the related record
 * in place of the key, looked up by id among the examples the set's APIs
 * document. A related record with no documented example is warned about.
 *
 * Only examples shown with an expanded schema change: a request body that
 * still takes the key keeps it. Seed data doesn't change either. A seed is
 * stored the way the server stores it, under the key, and expanded when read.
 *
 * @param {object[]} docs
 * @param {object[]} renames - From relationship resolution, each with the `schemaName` it changed
 * @param {string[]} warnings - Accumulated, appended to
 * @param {string[]} applied - Accumulated, appended to
 * @returns {{ docs: object[], warnings: string[], applied: string[] }}
 */
function reconcileExamples(docs, renames, warnings, applied) {
  const renamesOf = new Map();
  for (const rename of renames) {
    renamesOf.set(rename.schemaName, [...(renamesOf.get(rename.schemaName) ?? []), rename]);
  }

  // Only documented examples. Seeds and config entries are stored and input
  // shapes for other purposes, and lack what the server adds.
  const examplesIndex = buildExamplesIndex(docs.filter((doc) => doc.type === 'openapi').map((doc) => Object.fromEntries(
    Object.entries(doc.content?.components?.examples ?? {}).map(([name, example]) => [name, example?.value])
  )));

  const reconciled = docs.map((doc) => {
    if (doc.type !== 'openapi') return doc;

    const content = structuredClone(doc.content);
    let changed = false;
    for (const { examples, schemaName } of shownExamples(content)) {
      const toApply = renamesOf.get(schemaName);
      if (!toApply) continue;
      for (const [name, example] of Object.entries(examples)) {
        const target = example?.$ref ? componentExample(content, example.$ref) : example;
        if (!target || typeof target.value !== 'object' || target.value === null) continue;
        const result = resolveExampleRelationships({ [name]: target.value }, toApply, examplesIndex);
        warnings.push(...result.warnings);
        target.value = result.result[name];
        changed = true;
      }
    }
    if (!changed) return doc;

    applied.push(`Reconciled examples with renamed relationship fields -> ${doc.relativePath ?? doc.path}`);
    return { ...doc, content };
  });

  return { docs: reconciled, warnings, applied };
}

/**
 * Every set of named examples an API shows, with the local schema it's shown for.
 *
 * @param {object} content - An OpenAPI document
 * @returns {{ examples: object, schemaName: string }[]}
 */
function shownExamples(content) {
  const found = [];
  const collect = (media) => {
    for (const { schema, examples } of Object.values(media ?? {})) {
      const name = schema?.$ref?.match(/^#\/components\/schemas\/([^/]+)$/)?.[1];
      if (name && examples) found.push({ examples, schemaName: name });
    }
  };
  for (const item of Object.values(content.paths ?? {})) {
    for (const operation of Object.values(item ?? {})) {
      if (!operation || typeof operation !== 'object') continue;
      collect(operation.requestBody?.content);
      for (const response of Object.values(operation.responses ?? {})) collect(response?.content);
    }
  }
  return found;
}

/**
 * The example a local `#/components/examples/...` reference names, or null.
 *
 * @param {object} content
 * @param {string} ref
 * @returns {object|null}
 */
function componentExample(content, ref) {
  const name = ref.match(/^#\/components\/examples\/([^/]+)$/)?.[1];
  return name ? content.components?.examples?.[name] ?? null : null;
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
