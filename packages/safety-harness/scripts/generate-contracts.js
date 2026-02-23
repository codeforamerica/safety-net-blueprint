#!/usr/bin/env node
/**
 * Generate editable YAML contract files for the API Explorer.
 *
 * Fetches the mock server's /_manifest endpoint and writes one
 * {apiName}.list.form.yaml and one {apiName}.detail.form.yaml per API
 * into packages/safety-harness/contracts/forms/.
 *
 * Existing files are preserved unless --force is passed.
 *
 * Usage:
 *   node scripts/generate-contracts.js [--force]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load data classification policy from the contracts patterns file.
const patternsPath = join(__dirname, '..', '..', 'contracts', 'patterns', 'api-patterns.yaml');
const patterns = yaml.load(readFileSync(patternsPath, 'utf8'));
const PII_FIELDS = new Set(
  (patterns?.data_classification?.pii_fields?.fields ?? [])
    .map((f) => f.replace(/ \(.*\)/, '')),    // strip annotations like "address (all address fields)"
);
const SENSITIVE_FIELDS_FROM_POLICY = new Set(
  (patterns?.data_classification?.sensitive_fields?.fields ?? [])
    .map((f) => f.replace(/ \(.*\)/, '')),
);

const MANIFEST_URL = process.env.MANIFEST_URL ?? 'http://localhost:1080/_manifest';
const OUT_DIR = join(__dirname, '..', 'contracts', 'forms');
const PERM_DIR = join(__dirname, '..', 'contracts', 'permissions');
const force = process.argv.includes('--force');

// ── Helpers ─────────────────────────────────────────────────────────────────

function titleCase(s) {
  return s
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function resolveAllOf(schema) {
  if (!schema?.allOf) return schema ?? {};
  const merged = { type: 'object', properties: {}, required: [] };
  for (const part of schema.allOf) {
    const resolved = resolveAllOf(part);
    if (resolved.properties) {
      merged.properties = { ...merged.properties, ...resolved.properties };
    }
    if (resolved.required) {
      merged.required = [...merged.required, ...resolved.required];
    }
  }
  if (schema.properties) {
    merged.properties = { ...merged.properties, ...schema.properties };
  }
  if (schema.required) {
    merged.required = [...merged.required, ...schema.required];
  }
  return merged;
}

const SKIP_FIELDS = new Set(['additionalProperties']);
const READ_ONLY_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);

/** Check if a field name matches the PII policy (exact match or partial for annotated entries). */
function isPiiField(key) {
  return PII_FIELDS.has(key);
}
function isSensitiveField(key) {
  return SENSITIVE_FIELDS_FROM_POLICY.has(key);
}

function mapComponent(prop) {
  if (prop.enum) return 'select';
  if (prop.type === 'boolean') return 'checkbox-group';
  if (prop.type === 'string' && (prop.format === 'date' || prop.format === 'date-time')) {
    return 'date-input';
  }
  return 'text-input';
}

// ── Field generation (mirrors generateContract.ts logic) ────────────────────

function generateFields(properties, prefix, readOnlyRefs, piiRefs, requiredKeys) {
  const fields = [];
  const reqSet = new Set(requiredKeys ?? []);
  for (const [key, rawProp] of Object.entries(properties)) {
    if (SKIP_FIELDS.has(key)) continue;
    const prop = resolveAllOf(rawProp);
    const ref = prefix ? `${prefix}.${key}` : key;

    if (READ_ONLY_FIELDS.has(key) || rawProp.readOnly || prop.readOnly) {
      readOnlyRefs.add(ref);
    }
    if (isPiiField(key) || isSensitiveField(key)) {
      piiRefs.add(key);  // track by field name (last segment) for policy-based matching
    }

    const isRequired = reqSet.has(key);

    // Nested object → flatten
    if (prop.type === 'object' && prop.properties) {
      fields.push(...generateFields(prop.properties, ref, readOnlyRefs, piiRefs, prop.required));
      continue;
    }

    // Array of objects → field-array
    if (prop.type === 'array' && prop.items) {
      const itemSchema = resolveAllOf(prop.items);
      if (itemSchema.type === 'object' && itemSchema.properties) {
        const subFields = generateFields(itemSchema.properties, '', readOnlyRefs, piiRefs, itemSchema.required);
        const field = { ref, component: 'field-array', fields: subFields };
        if (prop.minItems != null) field.min_items = prop.minItems;
        if (prop.maxItems != null) field.max_items = prop.maxItems;
        fields.push(field);
        continue;
      }
      // Array of primitives with enum → checkbox-group
      if (prop.items.enum) {
        const labels = {};
        for (const v of prop.items.enum) labels[v] = titleCase(v);
        const field = { ref, component: 'checkbox-group', labels };
        if (isRequired) field.required = true;
        fields.push(field);
        continue;
      }
    }

    // Scalar field
    const field = { ref, component: mapComponent(prop) };
    if (prop.enum) {
      const labels = {};
      for (const v of prop.enum) labels[v] = titleCase(v);
      field.labels = labels;
    }
    if (prop.type === 'boolean') {
      field.labels = { true: titleCase(key) };
    }
    if (isRequired) field.required = true;
    fields.push(field);
  }
  return fields;
}

// ── Schema finders ──────────────────────────────────────────────────────────

function findPrimarySchema(schemas) {
  const names = Object.keys(schemas);
  const primaryName = names.find(
    (n) =>
      !n.includes('List') &&
      !n.includes('Create') &&
      !n.includes('Update') &&
      !n.includes('Error') &&
      !n.includes('Pagination'),
  );
  if (!primaryName) return undefined;
  return resolveAllOf(schemas[primaryName]);
}

/** Find the Update schema; falls back to the primary schema. */
function findUpdateSchema(schemas) {
  const names = Object.keys(schemas);
  const updateName = names.find((n) => n.includes('Update'));
  if (updateName) return resolveAllOf(schemas[updateName]);
  return findPrimarySchema(schemas);
}

// ── Detail contract generation ──────────────────────────────────────────────

function buildDetailContract(api, schema) {
  const properties = schema.properties ?? {};
  const readOnlyRefs = new Set();
  const piiRefs = new Set();   // field names (last segment) from data classification policy
  const topRequired = new Set(schema.required ?? []);

  const generalFields = [];
  const pages = [];

  for (const [key, rawProp] of Object.entries(properties)) {
    if (SKIP_FIELDS.has(key)) continue;
    const prop = resolveAllOf(rawProp);

    if (READ_ONLY_FIELDS.has(key) || rawProp.readOnly || prop.readOnly) {
      readOnlyRefs.add(key);
    }
    if (isPiiField(key) || isSensitiveField(key)) {
      piiRefs.add(key);
    }

    const isRequired = topRequired.has(key);

    // Top-level objects → own page
    if (prop.type === 'object' && prop.properties) {
      const fields = generateFields(prop.properties, key, readOnlyRefs, piiRefs, prop.required);
      if (fields.length > 0) {
        pages.push({ id: key, title: titleCase(key), fields });
      }
      continue;
    }

    // Top-level array of objects → own page
    if (prop.type === 'array' && prop.items) {
      const itemSchema = resolveAllOf(prop.items);
      if (itemSchema.type === 'object' && itemSchema.properties) {
        const subFields = generateFields(itemSchema.properties, '', readOnlyRefs, piiRefs, itemSchema.required);
        const field = { ref: key, component: 'field-array', fields: subFields };
        if (prop.minItems != null) field.min_items = prop.minItems;
        if (prop.maxItems != null) field.max_items = prop.maxItems;
        pages.push({ id: key, title: titleCase(key), fields: [field] });
        continue;
      }
    }

    // Scalar → general page
    const field = { ref: key, component: mapComponent(prop) };
    if (prop.enum) {
      const labels = {};
      for (const v of prop.enum) labels[v] = titleCase(v);
      field.labels = labels;
    }
    if (prop.type === 'boolean') {
      field.labels = { true: titleCase(key) };
    }
    if (prop.type === 'array' && prop.items?.enum) {
      field.component = 'checkbox-group';
      const labels = {};
      for (const v of prop.items.enum) labels[v] = titleCase(v);
      field.labels = labels;
    }
    if (isRequired) field.required = true;
    generalFields.push(field);
  }

  if (generalFields.length > 0) {
    pages.unshift({ id: 'general', title: 'General', fields: generalFields });
  }

  // Build actions — detail gets Update and Delete only (no Create)
  const actions = [];
  const endpoints = api.endpoints ?? [];
  const identityParam = endpoints
    .find((e) => e.method === 'GET' && e.path.includes('{'))
    ?.path.match(/\{(\w+)\}/)?.[1];

  for (const ep of endpoints) {
    const method = ep.method.toUpperCase();
    if (method === 'GET') continue;

    const isCollection = !ep.path.includes('{');

    // Skip POST (Create) — detail view only gets Update + Delete
    if (method === 'POST' && isCollection) continue;

    if (method === 'PATCH' || method === 'PUT') {
      actions.push({
        id: ep.operationId ?? 'update',
        label: 'Save',
        method,
        style: 'default',
      });
    } else if (method === 'DELETE') {
      actions.push({
        id: ep.operationId ?? 'delete',
        label: 'Delete',
        method: 'DELETE',
        style: 'warning',
        confirm: `Are you sure you want to delete this ${api.name.replace(/-/g, ' ')}?`,
        navigate: api.baseResource,
      });
    } else {
      actions.push({
        id: ep.operationId ?? ep.path,
        label: titleCase(ep.operationId ?? ep.summary ?? method),
        method,
        endpoint: ep.path,
        style: 'secondary',
      });
    }
  }

  const contract = {
    form: {
      id: `${api.name}-detail`,
      title: api.title,
      schema: api.name,
      layout: { navigation: 'in-page', display: 'scrollable' },
      ...(api.baseResource
        ? {
            resource: {
              endpoint: api.baseResource,
              ...(identityParam ? { identity: identityParam } : {}),
            },
          }
        : {}),
      ...(actions.length > 0 ? { actions } : {}),
      pages,
    },
  };

  return { contract, readOnlyRefs, piiRefs };
}

// ── Per-role permissions generation ─────────────────────────────────────────

function buildPermissions(readOnlyRefs, piiRefs) {
  const roles = ['admin', 'applicant', 'caseworker', 'reviewer'];
  return roles.map((role) => {
    const fields = {};
    for (const ref of readOnlyRefs) {
      fields[ref] = 'read-only';
    }
    // PII masking by role — caseworkers and reviewers see masked PII
    if (role === 'caseworker' || role === 'reviewer') {
      for (const fieldName of piiRefs) {
        fields[fieldName] = 'masked';
      }
    }
    // Applicant can see/edit their own SSN
    if (role === 'applicant' && piiRefs.has('socialSecurityNumber')) {
      fields['socialSecurityNumber'] = 'editable';
    }
    return {
      role,
      defaults: role === 'reviewer' ? 'read-only' : 'editable',
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    };
  });
}

// ── List contract generation ────────────────────────────────────────────────

function deriveListColumns(schema, maxColumns = 5) {
  if (!schema) return [{ from: 'id', label: 'ID' }];
  const resolved = resolveAllOf(schema);
  const props = resolved.properties;
  if (!props) return [{ from: 'id', label: 'ID' }];

  const columns = [];
  for (const key of Object.keys(props)) {
    const prop = resolveAllOf(props[key]);
    if (prop.type === 'object' || prop.type === 'array') continue;
    if (prop.format === 'date-time') continue;
    columns.push({ from: key, label: titleCase(key) });
    if (columns.length >= maxColumns) break;
  }
  return columns.length > 0 ? columns : [{ from: 'id', label: 'ID' }];
}

function buildListContract(api, schema) {
  const columns = deriveListColumns(schema);
  const detailFormId = `${api.name}-detail`;
  const detailFetch = `${api.baseResource}/{id}`;

  // Build actions — list gets Create only
  const actions = [];
  const endpoints = api.endpoints ?? [];
  for (const ep of endpoints) {
    const method = ep.method.toUpperCase();
    const isCollection = !ep.path.includes('{');

    if (method === 'POST' && isCollection) {
      actions.push({
        id: ep.operationId ?? 'create',
        label: 'Create',
        method: 'POST',
        style: 'default',
        navigate: api.baseResource ? `${api.baseResource}/{id}` : undefined,
      });
    }
  }

  const listPage = {
    id: 'list',
    title: api.title,
    source: 'api',
    columns,
    detail: { form: detailFormId, fetch: detailFetch },
  };

  const contract = {
    form: {
      id: `${api.name}-list`,
      title: api.title,
      schema: api.name,
      layout: { navigation: 'none', display: 'data-table' },
      ...(actions.length > 0 ? { actions } : {}),
      pages: [listPage],
    },
  };

  return { contract, columns };
}

// ── Write helpers ───────────────────────────────────────────────────────────

function writeYaml(filePath, data, label) {
  if (!force && existsSync(filePath)) {
    console.log(`  SKIP ${label} (already exists)`);
    return false;
  }
  const content = yaml.dump(data, {
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
  writeFileSync(filePath, content, 'utf8');
  console.log(`  WRITE ${label}`);
  return true;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Fetching manifest from ${MANIFEST_URL}...`);
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    console.error(`Failed to fetch manifest: HTTP ${res.status}`);
    process.exit(1);
  }
  const { apis } = await res.json();
  console.log(`Found ${apis.length} API(s): ${apis.map((a) => a.name).join(', ')}\n`);

  mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  let skipped = 0;

  for (const api of apis) {
    console.log(`${api.title} (${api.name}):`);
    const schema = findPrimarySchema(api.schemas ?? {});

    // List contract
    const listPath = join(OUT_DIR, `${api.name}.list.form.yaml`);
    const { contract: listContract } = buildListContract(api, schema);
    if (writeYaml(listPath, listContract, `${api.name}.list.form.yaml`)) {
      written++;
    } else {
      skipped++;
    }

    // Detail contract (form only — permissions are written as separate files)
    const detailPath = join(OUT_DIR, `${api.name}.detail.form.yaml`);
    const { contract: detailContract, readOnlyRefs, piiRefs } = buildDetailContract(api, schema);
    if (writeYaml(detailPath, detailContract, `${api.name}.detail.form.yaml`)) {
      written++;
    } else {
      skipped++;
    }

    // Per-role permissions as separate files
    const permDir = join(PERM_DIR, api.name);
    mkdirSync(permDir, { recursive: true });
    const permissions = buildPermissions(readOnlyRefs, piiRefs);
    for (const perm of permissions) {
      const permPath = join(permDir, `${perm.role}.yaml`);
      if (writeYaml(permPath, perm, `permissions/${api.name}/${perm.role}.yaml`)) {
        written++;
      } else {
        skipped++;
      }
    }
  }

  console.log(`\nDone: ${written} written, ${skipped} skipped.`);
  if (skipped > 0 && !force) {
    console.log('Tip: use --force to overwrite existing files.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
