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
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';

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
  // policies-schema.yaml, etc.) that live in blueprint-core and are not included
  // in the in-memory specs. Skips any $id already registered in step 1.
  for (const localDir of Object.values(resolverMap)) {
    for (const file of findFiles(localDir.replace(/\/$/, ''), ['.yaml', '.yml'])) {
      try {
        const schema = yaml.load(readFileSync(file, 'utf8'));
        if (schema?.$id && !ajv.getSchema(schema.$id)) {
          ajv.addSchema(schema);
        }
      } catch { /* skip unparseable files */ }
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
      valid = false;
      results.push({
        relativePath,
        schemaRef,
        valid: false,
        errors: [{ message: err.message }]
      });
    }
  }

  return { valid, results };
}

// =============================================================================
// Disk-based entry point (for standalone CLI use)
// =============================================================================

/**
 * Load YAML files from a directory tree and validate them.
 *
 * Thin wrapper around validateSchemas for use by the standalone CLI
 * (json-schema.js). Reads files from disk, parses them, and delegates
 * to validateSchemas. Not used by the resolve pipeline (which passes
 * in-memory specs directly).
 *
 * @param {string[]} filePaths - Absolute paths to YAML files to load
 * @param {string} baseDir - Base directory for computing relative paths
 * @param {object} [options] - Same options as validateSchemas
 * @returns {{ valid: boolean, results: Array<ValidationResult> }}
 */
function validateSchemasFromFiles(filePaths, baseDir, options) {
  const specs = [];
  for (const filePath of filePaths) {
    try {
      const spec = yaml.load(readFileSync(filePath, 'utf8'));
      if (spec && typeof spec === 'object') {
        const relativePath = filePath.startsWith(baseDir + '/')
          ? filePath.slice(baseDir.length + 1)
          : filePath;
        specs.push({ relativePath, spec });
      }
    } catch { /* skip unparseable files */ }
  }
  return validateSchemas(specs, options);
}

export { validateSchemas, validateSchemasFromFiles, findFiles };
