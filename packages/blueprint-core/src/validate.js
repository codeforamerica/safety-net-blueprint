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
import { buildSchemaIndex, buildCollectionIndex } from './indexes.js';

/**
 * Contract types with no validator of their own.
 *
 * Structural correctness for these comes from JSON Schema validation via their
 * `$schema` declaration, which runs upstream. They are listed explicitly so
 * that a type missing from both places surfaces as a gap instead of passing.
 */
const SCHEMA_VALIDATED_ONLY = new Set([
  'asyncapi', 'schema', 'components', 'annotations', 'policies', 'registry',
  'metrics', 'sla-types', 'compositions', 'config', 'mock-data', 'overlay',
  'graph', 'rules-examples',
]);

/**
 * @param {import('../types.js').Doc[]} docs
 * @returns {import('../types.js').ValidationResult}
 */
export function validate(docs) {
  const context = {
    schemaIndex: buildSchemaIndex(docs),
    collectionIndex: buildCollectionIndex(docs),
    domainSchemas: buildDomainSchemaIndex(docs),
    validRoles: findRoleTypeEnum(docs),
  };

  const results = docs.map((doc) => {
    const { errors, warnings } = validateDoc(doc, context);
    return { path: doc.path, type: doc.type, ok: errors.length === 0, errors, warnings };
  });

  return {
    ok: results.every((r) => r.ok),
    results,
    report: formatReport(results),
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

  switch (doc.type) {
    case 'openapi': {
      // A deprecated spec is kept for consumers still on it and is not held to
      // current pattern rules.
      if (doc.content?.info?.['x-status'] === 'deprecated') break;

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
      break;

    case 'rules':
      errors.push(...validateRulesDoc(doc.content));
      break;

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
      if (!SCHEMA_VALIDATED_ONLY.has(doc.type)) {
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
