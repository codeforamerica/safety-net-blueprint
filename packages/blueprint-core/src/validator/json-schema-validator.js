/**
 * JSON Schema Validation Core
 *
 * Validates YAML files that declare a $schema field against their referenced
 * schemas using AJV 2020-12. This module exports a pure function that works
 * on in-memory spec objects, making it usable both from the resolve pipeline
 * and from the standalone CLI.
 *
 * WHY IN-MEMORY VALIDATION MATTERS
 * ---------------------------------
 * Schemas like annotations-schema.yaml reference RoleType and Domain from
 * blueprint-core/base-contracts/schemas/enums.yaml. Those enums are intentionally
 * minimal in the base package — states extend them via overlay (e.g. adding
 * case_worker, applicant to RoleType; adding intake, eligibility to Domain).
 *
 * If validation ran against source files on disk, AJV would see only the base
 * enum values and reject every safety-net file that uses an extended value.
 *
 * By running after overlays are applied (but before canonical URI rewriting),
 * the in-memory specs already contain the overlay-extended enums, so AJV sees
 * the full valid value set. Canonical $ref URIs are still intact at this point,
 * so AJV can resolve cross-schema references normally via its internal registry.
 *
 * SCHEMA LOADING ORDER
 * --------------------
 * Specs (in-memory) are loaded into AJV FIRST so overlay-extended schemas win.
 * resolverMap schemas (blueprint-core validation schemas like state-machine-schema.yaml
 * that are not present in the in-memory specs) are loaded SECOND, skipping any
 * $id already registered. This ensures:
 *   - base/schemas/enums.yaml: overlay-extended version from specs wins
 *   - state-machine-schema.yaml, annotations-schema.yaml, etc.: loaded from source
 *
 * $schema RESOLUTION
 * ------------------
 * Files declare $schema as one of:
 *   - bare filename:    state-machine-schema.yaml
 *   - canonical URI:    https://blueprint.codeforamerica.org/schemas/state-machine-schema.yaml
 *   - external URL:     https://json-schema.org/... (skipped — not validated locally)
 *
 * Resolution order for bare filenames:
 *   1. Direct AJV lookup (exact match)
 *   2. Blueprint-core canonical URI: https://blueprint.codeforamerica.org/schemas/<name>
 *   3. Suffix search: any registered $id ending with /<name>
 */

import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

/** Compare paths one way, whatever the platform wrote them as. */
function normalizePath(path) {
  return path.split('\\').join('/');
}

/**
 * Every `$ref` in a document that points at another file by relative path.
 *
 * Fragment-only refs resolve within the document and absolute URLs are
 * already addressable, so neither needs an alias.
 *
 * @param {object} spec - Parsed document
 * @returns {Set<string>}
 */
function relativeRefsIn(spec) {
  const refs = new Set();

  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);

    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        if (!value.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(value)) refs.add(value);
      }
      walk(value);
    }
  })(spec);

  return refs;
}

// =============================================================================
// Helpers
// =============================================================================

function findFiles(dir, exts) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) results.push(...findFiles(full, exts));
      else if (exts.some(e => entry.name.endsWith(e))) results.push(full);
    }
  } catch { /* skip missing or unreadable dirs */ }
  return results;
}

// =============================================================================
// Core validation
// =============================================================================

/**
 * Validate an array of in-memory specs against their declared $schema.
 *
 * Called by the resolve pipeline after overlays are applied and before
 * canonical URI rewriting. Also called by validateSchemasFromDir for
 * standalone CLI use.
 *
 * @param {Array<{relativePath: string, spec: object}>} specs
 *   All in-memory specs. Schemas with $id are pre-loaded into AJV; files
 *   declaring $schema are validated. Typically includes base-contracts files
 *   (at base/ paths) which carry overlay-extended enum values.
 *
 * @param {object} [options]
 * @param {object} [options.resolverMap]
 *   Map of canonical URI prefix → local directory path exported from
 *   blueprint-core. Used to load blueprint-core validation schemas
 *   (state-machine-schema.yaml, annotations-schema.yaml, etc.) that are not
 *   present in the specs array. Any $id already registered from specs is
 *   skipped, so overlay-extended schemas always win over base versions.
 *
 * @returns {{ valid: boolean, results: Array<ValidationResult> }}
 */
function validateSchemas(specs, { resolverMap = {} } = {}) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  // Without this, every `format: uuid` and `format: uri` in the contracts is
  // ignored with a warning to stderr — declared and never checked.
  addFormats(ajv);

  // --- Step 1: Pre-load in-memory specs ---
  // Load these first so overlay-extended schemas (e.g. enums.yaml with
  // the full RoleType and Domain enum values) are registered before the
  // resolverMap schemas. If a $id is already registered, skip it.
  for (const { spec } of specs) {
    if (spec?.$id) {
      try {
        if (!ajv.getSchema(spec.$id)) ajv.addSchema(spec);
      } catch { /* skip invalid schemas */ }
    }
  }

  // --- Step 2: Pre-load blueprint-core schemas via resolverMap ---
  // Adds validation schemas (state-machine-schema.yaml, annotations-schema.yaml,
  // registry-schema.yaml, etc.) that live in blueprint-core and are not included
  // in the in-memory specs. Skips any $id already registered in step 1.
  for (const localDir of Object.values(resolverMap)) {
    for (const file of findFiles(localDir.replace(/\/$/, ''), ['.yaml', '.yml'])) {
      try {
        const schema = yaml.load(readFileSync(file, 'utf8'), { schema: yaml.CORE_SCHEMA });
        if (schema?.$id && !ajv.getSchema(schema.$id)) {
          ajv.addSchema(schema);
        }
      } catch { /* skip unparseable files */ }
    }
  }

  // --- Step 2b: Alias schemas under the URIs their siblings' refs compute ---
  //
  // Written contracts carry an absolute `$id` but relative `$ref`s: resolve
  // rewrites canonical blueprint URLs to real paths so file-following tools
  // can read the output. A validator does not follow paths — it resolves a
  // relative ref against the document's own `$id`, so `../../base/schemas/
  // auth.yaml` from `.../safety-net/domains/data-exchange/x-schema.yaml`
  // becomes `.../safety-net/base/schemas/auth.yaml`, a URI nothing registered.
  //
  // The schema then fails to compile and the document is reported unchecked
  // rather than wrong — conformance silently not run. Registering each
  // referenced document under the URI its referrer actually computes closes
  // that, without touching what gets written.
  const byRelativePath = new Map(
    specs.filter((s) => s.relativePath).map((s) => [normalizePath(s.relativePath), s.spec])
  );

  for (const { relativePath, spec } of specs) {
    if (!relativePath || typeof spec?.$id !== 'string') continue;

    for (const ref of relativeRefsIn(spec)) {
      const [filePart] = ref.split('#');
      if (!filePart) continue;

      const target = byRelativePath.get(
        normalizePath(join(dirname(relativePath), filePart))
      );
      if (!target) continue;

      try {
        const uri = new URL(filePart, spec.$id).href;
        if (!ajv.getSchema(uri)) ajv.addSchema(target, uri);
      } catch { /* $id is not a URL, or the ref escapes it — leave it alone */ }
    }
  }

  // --- Step 3: Find files to validate ---
  // Only files declaring $schema are validated. External URLs (http/https) are
  // skipped — they are not locally registered schemas.
  const filesToValidate = specs.filter(({ spec }) =>
    spec &&
    typeof spec === 'object' &&
    spec.$schema &&
    !spec.$schema.startsWith('http')
  );

  // --- Step 4: Validate ---
  const results = [];
  let valid = true;

  for (const { relativePath, spec } of filesToValidate) {
    const schemaRef = spec.$schema;

    try {
      // Resolve the schema by trying three strategies in order:
      //   1. Direct lookup — works for canonical URIs declared as $schema
      //   2. Blueprint-core prefix — for bare filenames like "state-machine-schema.yaml"
      //   3. Suffix search — fallback for domain-specific schemas with long $id paths
      let validate = ajv.getSchema(schemaRef);

      if (!validate && !schemaRef.startsWith('https://')) {
        validate = ajv.getSchema(`https://blueprint.codeforamerica.org/schemas/${schemaRef}`);
      }

      if (!validate && !schemaRef.startsWith('https://')) {
        const match = Object.keys(ajv.schemas).find(id => id.endsWith(`/${schemaRef}`));
        if (match) validate = ajv.getSchema(match);
      }

      if (!validate) {
        valid = false;
        results.push({
          relativePath,
          schemaRef,
          valid: false,
          errors: [{ message: `Schema not found: ${schemaRef}` }]
        });
        continue;
      }

      // Strip $schema before validating — it is not part of the data model
      const { $schema, ...data } = spec;
      const isValid = validate(data);

      if (isValid) {
        results.push({ relativePath, schemaRef, valid: true });
      } else {
        valid = false;
        results.push({ relativePath, schemaRef, valid: false, errors: validate.errors });
      }
    } catch (err) {
      // AJV throws when it cannot compile the schema — typically because a
      // $ref points somewhere it cannot reach. That says nothing about
      // whether the document conforms; it says the check could not run.
      // Reporting it as a document error blames the contract for a tooling
      // problem, so it is surfaced as uncheckable instead.
      results.push({
        relativePath,
        schemaRef,
        valid: true,
        uncheckable: err.message
      });
    }
  }

  return { valid, results };
}

export { validateSchemas };
