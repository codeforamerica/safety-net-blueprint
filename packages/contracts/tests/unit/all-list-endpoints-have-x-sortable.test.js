/**
 * Meta-test: every collection-GET endpoint across every domain spec must
 * either declare x-sortable (opting into the documented sort convention)
 * or be on a documented exemption list (operations that genuinely have no
 * useful sort, e.g., singleton sub-resources or read-only catalogs without
 * meaningful order beyond insertion).
 *
 * Phase 5 of #288. Prevents new list endpoints from silently shipping
 * without sort support, and protects the migration from regressions.
 *
 * Endpoints on the EXEMPT list:
 *   - Must be explicitly justified by comment in this file
 *   - Continue to reject ?sort= with 400 INVALID_SORT_FIELD at runtime
 *     (verified separately by the search-engine-sort.test.js cases)
 *
 * NOTE: the legacy applications-openapi.yaml is marked x-status: deprecated
 * and is excluded from this check (the resolver and validator already skip it).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONTRACTS_DIR = join(__dirname, '..', '..');

/**
 * Endpoints we deliberately do not extend with x-sortable. Listed here as
 * "{spec}:{path}" with a brief why. Adding a new entry requires updating
 * this file in the same PR — the audit trail is the comment.
 */
const EXEMPT = new Set([
  // Cross-resource search has its own ordering semantics (relevance) and
  // does not flow through the standard list-handler path — it goes through
  // search-handler.js, which builds its own ORDER BY using a relevance
  // proxy. x-sortable would be misleading here. Phase 1 of #288 documented
  // this. The deprecated search-openapi.yaml is auto-skipped by loadSpec.
  'platform-openapi.yaml:/search',
]);

function loadSpec(file) {
  const raw = readFileSync(join(CONTRACTS_DIR, file), 'utf8');
  if (raw.includes('x-status: deprecated')) return null;
  return yaml.load(raw);
}

/**
 * Resolve a local JSON-pointer-style $ref against the spec root. Returns
 * null on miss. Sufficient for our meta-test which only follows one hop.
 */
function resolveRef(spec, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let node = spec;
  for (const p of parts) {
    if (node == null || typeof node !== 'object') return null;
    node = node[p];
  }
  return node ?? null;
}

/**
 * Returns true when the operation's 200 response is shaped like a list —
 * i.e., the response schema has an `items` array property. List endpoints
 * flow through executeSearch and therefore need x-sortable. Singleton
 * endpoints (e.g., GET /applications/{id}/interview) do not.
 */
function isListEndpoint(spec, operation) {
  const schema = operation.responses?.['200']?.content?.['application/json']?.schema;
  if (!schema) return false;

  // Inspect direct properties and allOf branches (and a single $ref hop)
  const containers = [schema];
  if (Array.isArray(schema.allOf)) containers.push(...schema.allOf);
  if (schema.$ref) {
    const r = resolveRef(spec, schema.$ref);
    if (r) {
      containers.push(r);
      if (Array.isArray(r.allOf)) containers.push(...r.allOf);
    }
  }

  for (const c of containers) {
    const items = c?.properties?.items;
    if (items?.type === 'array') return true;
  }
  return false;
}

test('every collection-GET endpoint declares x-sortable or is exempt', async (t) => {
  const specFiles = readdirSync(CONTRACTS_DIR)
    .filter(f => f.endsWith('-openapi.yaml'));

  let checked = 0;
  let missing = [];

  for (const file of specFiles) {
    const spec = loadSpec(file);
    if (!spec || !spec.paths) continue;

    for (const [path, methods] of Object.entries(spec.paths)) {
      const getOp = methods.get;
      if (!getOp) continue;
      if (!isListEndpoint(spec, getOp)) continue;

      const key = `${file}:${path}`;
      checked++;

      if (EXEMPT.has(key)) continue;

      if (!getOp['x-sortable']) {
        missing.push(key);
      }
    }
  }

  assert.ok(checked > 0, 'meta-test discovered no list endpoints — check loader logic');
  assert.deepStrictEqual(
    missing,
    [],
    `the following collection-GET endpoints do not declare x-sortable and are not on the EXEMPT list:\n  ${missing.join('\n  ')}\n\n` +
    `Either add an x-sortable extension to each operation or add the operation key to the EXEMPT set in this test with a justification comment.`
  );
  console.log(`  ✓ Checked ${checked} list endpoints; ${EXEMPT.size} exempt`);
});

console.log('\n✓ all-list-endpoints-have-x-sortable meta-test complete\n');
