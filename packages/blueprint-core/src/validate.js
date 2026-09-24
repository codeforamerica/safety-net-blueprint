/**
 * Validate a document set.
 *
 * Takes the whole collection because some checks are inherently cross-file:
 * a state machine's `call:` targets and `$variable.field` references are
 * checked against schemas and endpoints declared in other documents.
 *
 * Every contract type is either validated or explicitly reported as having no
 * validator. Nothing passes silently — a type this function does not know how
 * to check produces a diagnostic saying so, rather than an empty error list
 * that reads as success.
 */

import { validateSpec as validateApiPatterns } from './validator/pattern-validator.js';
import { validateWithinFile, validateCrossArtifact } from './validator/state-machine-validator.js';
import { validateRulesDoc } from './validator/rules-validator.js';
import {
  buildResourceSchemaIndex,
  validateBindFields,
  validateFieldsArrays,
  validateSortableConfig,
} from './compositions.js';
import { validateEvents } from './validator/event-validator.js';
import { validateSlaTypeFields, validateMetricFields } from './validator/field-reference-validator.js';
import { validateAnnotations } from './validator/annotation-validator.js';
import { validateSchemas } from './validator/json-schema-validator.js';
import { stemOf, setRootOf, isDeprecated } from './contract-types.js';
import {
  buildSchemaIndex,
  buildCollectionIndex,
  buildChannelIndex,
  buildCollectionPropertyIndex,
  buildSpecsByDomain,
  buildActionIndex,
  buildGraphIndex,
  buildRegistryEntryIndex,
} from './indexes.js';
import { resolverMap } from './paths.js';

/**
 * Contract types with no validator of their own.
 *
 * Structural correctness for these comes from JSON Schema validation via their
 * `$schema` declaration, which runs upstream. They are listed explicitly so
 * that a type missing from both places surfaces as a gap instead of passing.
 */
const SCHEMA_VALIDATED_ONLY = new Set([
  'asyncapi', 'schema', 'components', 'registry', 'config',
  'overlay', 'rules-examples', 'graph',
]);

/**
 * Types checked by a tool outside this function.
 *
 * Mock data is example values, not a contract — the mock server validates it
 * against the schemas it seeds, which is a different question from whether
 * the document is well formed. Listed so the check below still refuses to
 * pass a type nobody validates.
 */
const VALIDATED_ELSEWHERE = new Map([
  ['mock-data', 'blueprint-mock-server validate-mock-data'],
]);

/**
 * @param {import('../types.js').Doc[]} docs
 * @returns {import('../types.js').ValidationResult}
 */
export function validate(docs) {
  // filePath is what lets an external $ref be resolved relative to the document
  // that declares it. Without it a schema composed via allOf of a sibling file
  // looks like it has no properties at all.
  const yamlFiles = docs.map((doc) => ({
    relativePath: doc.relativePath ?? doc.path,
    filePath: doc.path,
    setRoot: setRootOf(doc),
    spec: doc.content,
  }));

  const schemaIndex = buildSchemaIndex(docs);
  const collectionIndex = buildCollectionIndex(docs);

  const context = {
    schemaIndex,
    collectionIndex,
    collectionProperties: buildCollectionPropertyIndex(collectionIndex, schemaIndex),
    domainSchemas: buildDomainSchemaIndex(docs),
    resourceSchemaIndex: buildResourceSchemaIndex(yamlFiles),
    validRoles: findRoleTypeEnum(docs),
    // Schema conformance is checked for the whole set at once, because AJV
    // needs every document registered before any can be validated against a
    // sibling's $id. Results are indexed so each document collects its own.
    schemaConformance: schemaConformanceByPath(yamlFiles),
    channels: buildChannelIndex(docs),
    annotations: {
      specsByDomain: buildSpecsByDomain(docs),
      actions: buildActionIndex(docs),
      channels: buildChannelIndex(docs).all,
      graphs: buildGraphIndex(docs),
      registryEntryIds: buildRegistryEntryIndex(docs),
    },
  };

  const results = docs.map((doc) => {
    const { errors, warnings } = validateDoc(doc, context);
    return {
      path: doc.path,
      type: doc.type,
      ok: errors.length === 0,
      // Underlying validators predate a common finding shape and some return
      // only { message, path }. Normalizing here means a caller can rely on
      // every finding having a rule to group and filter by.
      errors: errors.map((finding) => normalize(finding, doc)),
      warnings: warnings.map((finding) => normalize(finding, doc)),
    };
  });

  return {
    ok: results.every((r) => r.ok),
    results,
    report: formatReport(results),
  };
}

/**
 * Check every document declaring a `$schema` against the schema it names.
 *
 * Run once for the set: AJV needs all documents registered before any is
 * validated, so that a document extended by an overlay wins over the base
 * version of the same `$id`. Core's own bundled validation schemas are added
 * from the resolver map, which is why that no longer needs to be public.
 *
 * @param {{ relativePath: string, spec: object }[]} yamlFiles
 * @returns {Map<string, { rule: string, message: string, path: string }[]>}
 */
function schemaConformanceByPath(yamlFiles) {
  const byPath = new Map();
  const { results } = validateSchemas(yamlFiles, { resolverMap });

  for (const result of results) {
    // The schema could not be compiled, so conformance was not checked. This
    // happens when a document's refs have been rewritten for output and no
    // longer resolve — conformance belongs earlier in the pipeline, while
    // canonical URIs are intact. Reported so it is visible, not as a defect
    // in the document.
    if (result.uncheckable) {
      byPath.set(result.relativePath, {
        errors: [],
        warnings: [{
          rule: 'schema-conformance-unchecked',
          message: `Not checked against ${result.schemaRef}: ${result.uncheckable}`,
          path: result.relativePath,
        }],
      });
      continue;
    }

    if (result.valid) continue;

    byPath.set(result.relativePath, {
      errors: (result.errors ?? []).map((error) => ({
        rule: 'schema-conformance',
        message: error.instancePath
          ? `${error.instancePath} ${error.message} (against ${result.schemaRef})`
          : `${error.message} (against ${result.schemaRef})`,
        path: error.instancePath || result.relativePath,
      })),
      warnings: [],
    });
  }

  return byPath;
}

/**
 * Fragment refs that point nowhere within their own document.
 *
 * Catches a document made internally inconsistent by a rewrite — a `$ref`
 * moved from `#/$defs/X` to `#/components/schemas/X` without the definition
 * moving with it. External refs are another document's problem and are left
 * to the checks that can see it.
 *
 * Overlays are exempt: they reference their target spec's components by
 * design and are not self-contained.
 *
 * @param {import('../types.js').Doc} doc
 * @returns {{ rule: string, message: string, path: string }[]}
 */
function brokenFragmentRefs(doc) {
  if (doc.type === 'overlay') return [];

  return [...doc.refs()]
    .filter(([, ref]) => ref.resolved === false)
    .map(([literal, ref]) => ({
      rule: 'unresolved-fragment-ref',
      message: `$ref "${literal}" does not resolve within this document.`,
      path: ref.pointer,
    }));
}

/**
 * Give every finding the same shape: { rule, message, path }.
 *
 * `rule` falls back to the contract type, so a finding from a validator that
 * does not name its rules is still groupable rather than showing as undefined.
 *
 * @param {{ rule?: string, message: string, path?: string }} finding
 * @param {import('../types.js').Doc} doc
 * @returns {{ rule: string, message: string, path: string }}
 */
function normalize(finding, doc) {
  return {
    rule: finding.rule ?? `${doc.type}-validation`,
    message: finding.message,
    path: finding.path ?? (doc.relativePath ?? doc.path),
  };
}

/**
 * Group schema names by the domain that declares them.
 *
 * Pattern checks resolve a `$ref` against every schema in the same domain, not
 * only the ones in the file being checked — schemas are split across specs
 * within a domain.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {Map<string, Set<string>>}
 */
function buildDomainSchemaIndex(docs) {
  const index = new Map();

  for (const doc of docs) {
    if (doc.type !== 'openapi') continue;
    const domain = doc.content?.info?.['x-domain'];
    if (!domain) continue;

    if (!index.has(domain)) index.set(domain, new Set());
    const names = index.get(domain);
    for (const name of Object.keys(doc.content.components?.schemas ?? {})) names.add(name);
  }

  return index;
}

/**
 * Find the RoleType enum that defines which actor roles a state machine may name.
 *
 * Returns null when no document declares it, rather than falling back to a
 * built-in list — validating roles against the wrong vocabulary would report
 * confident nonsense. The caller turns a null into an explicit diagnostic.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {Set<string>|null}
 */
function findRoleTypeEnum(docs) {
  for (const doc of docs) {
    const values = doc.content?.$defs?.RoleType?.enum;
    if (Array.isArray(values) && values.length > 0) return new Set(values);
  }
  return null;
}

/**
 * Run the checks that apply to one document's type.
 *
 * @param {import('../types.js').Doc} doc
 * @param {{ schemaIndex: Map, collectionIndex: Map, domainSchemas: Map, validRoles: Set|null }} context
 * @returns {{ errors: object[], warnings: object[] }}
 */
function validateDoc(doc, context) {
  const errors = [];
  const warnings = [];

  errors.push(...brokenFragmentRefs(doc));
  const conformance = context.schemaConformance.get(doc.relativePath ?? doc.path);
  if (conformance) {
    errors.push(...conformance.errors);
    warnings.push(...conformance.warnings);
  }

  switch (doc.type) {
    case 'openapi': {
      // A deprecated spec is kept for consumers still on it and is not held to
      // current pattern rules.
      if (isDeprecated(doc.content)) break;

      const domain = doc.content?.info?.['x-domain'];
      const sameDomainSchemas = context.domainSchemas.get(domain) ?? new Set();
      for (const finding of validateApiPatterns(doc.content, doc.path, sameDomainSchemas)) {
        (finding.severity === 'warning' ? warnings : errors).push(finding);
      }
      break;
    }

    case 'state-machine':
      if (context.validRoles === null) {
        errors.push({
          rule: 'missing-role-vocabulary',
          message:
            'No $defs.RoleType.enum found in the document set, so actor roles cannot be ' +
            'checked. Resolve the contracts before validating state machines.',
          path: doc.path,
        });
        break;
      }
      errors.push(...validateWithinFile(doc.path, doc.content, { validRoles: context.validRoles }));
      errors.push(
        ...validateCrossArtifact(doc.path, doc.content, context.schemaIndex, context.collectionIndex)
      );
      errors.push(...validateEvents(doc, context.channels));
      break;

    case 'rules':
      errors.push(...validateRulesDoc(doc.content));
      break;

    case 'sla-types':
      errors.push(...validateSlaTypeFields(doc, context.collectionProperties));
      break;

    case 'metrics':
      errors.push(...validateMetricFields(doc, context.collectionProperties));
      break;

    case 'annotations':
      errors.push(...validateAnnotations(doc, context.annotations));
      break;

    case 'compositions': {
      // The composition validators take { domain, doc }; domain is the stem of
      // the relative path, which is how a composition names its target spec.
      const compositionDoc = {
        domain: stemOf(doc.relativePath ?? doc.path, 'compositions'),
        doc: doc.content,
      };
      errors.push(
        ...validateBindFields(compositionDoc, context.resourceSchemaIndex),
        ...validateFieldsArrays(compositionDoc, context.resourceSchemaIndex),
        ...validateSortableConfig(compositionDoc)
      );
      break;
    }

    case 'unknown':
      errors.push({
        rule: 'unrecognized-contract-type',
        message:
          'File could not be typed — no $schema declaration and no recognized filename suffix. ' +
          'Add a $schema, rename it to a recognized suffix, or move it out of the contract tree.',
        path: doc.path,
      });
      break;

    default:
      if (VALIDATED_ELSEWHERE.has(doc.type)) {
        break; // covered by the tool named above
      } else if (!SCHEMA_VALIDATED_ONLY.has(doc.type)) {
        errors.push({
          rule: 'no-validator',
          message:
            `Contract type '${doc.type}' has no validator and is not registered as ` +
            'schema-validated-only. It is not being checked.',
          path: doc.path,
        });
      }
  }

  return { errors, warnings };
}

/**
 * Render results for a human.
 *
 * Never truncated — a summary that hides errors costs more time than the lines
 * it saves. Callers wanting a short form should count `results` instead.
 *
 * @param {object[]} results
 * @returns {string}
 */
function formatReport(results) {
  const lines = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const result of results) {
    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;

    if (result.ok && result.warnings.length === 0) continue;

    lines.push(`  ${result.ok ? '⚠' : '✗'} ${result.path}`);
    for (const error of result.errors) {
      lines.push(`      error   ${error.rule ?? 'error'}: ${error.message}`);
    }
    for (const warning of result.warnings) {
      lines.push(`      warning ${warning.rule ?? 'warning'}: ${warning.message}`);
    }
  }

  const clean = results.length - results.filter((r) => !r.ok || r.warnings.length).length;
  lines.push('');
  lines.push(
    `  ${results.length} documents — ${clean} clean, ` +
    `${totalErrors} error(s), ${totalWarnings} warning(s)`
  );

  return lines.join('\n');
}
