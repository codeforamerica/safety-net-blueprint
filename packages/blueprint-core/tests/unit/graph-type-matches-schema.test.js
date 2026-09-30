/**
 * The declared `Graph` and graph-schema.yaml must describe the same document.
 *
 * `graph-schema.yaml` is the authority — a graph that violates it fails
 * `validate` whatever any TypeScript interface claims. The interface in
 * types.d.ts is a projection of it for consumers, and a projection can fall
 * behind: a field added to the schema, or one left declared after the schema
 * drops it, and nothing says so.
 *
 * This compares field names, not types. The schema is deliberately loose
 * about the interior of `inputs` and `facts`, and the interface is free to be
 * looser or tighter there; what it may not do is name a different set of
 * fields from the contract it claims to describe.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** The field names `graph-schema.yaml` defines for a graph document. */
function schemaFields() {
  const schema = yaml.load(readFileSync(join(packageRoot, 'schemas/graph-schema.yaml'), 'utf8'));
  return new Set(Object.keys(schema.properties ?? {}));
}

/** The field names the `Graph` interface declares. */
function interfaceFields() {
  const source = readFileSync(join(packageRoot, 'types.d.ts'), 'utf8');
  const body = source.match(/export interface Graph \{([^}]*)\}/)?.[1];
  assert.ok(body, 'types.d.ts must declare an interface named Graph');

  return new Set(
    [...body.matchAll(/^\s*(\$?[a-zA-Z][a-zA-Z0-9]*)\??\s*:/gm)].map((m) => m[1])
  );
}

describe('Graph in types.d.ts and graph-schema.yaml', () => {
  test('declares every field the schema defines', () => {
    const declared = interfaceFields();
    const missing = [...schemaFields()].filter((name) => !declared.has(name));

    assert.deepEqual(
      missing,
      [],
      `the schema defines these and the interface does not, so consumers cannot read them: ${missing.join(', ')}`
    );
  });

  test('declares no field the schema does not define', () => {
    const defined = schemaFields();
    const phantom = [...interfaceFields()].filter((name) => !defined.has(name));

    assert.deepEqual(
      phantom,
      [],
      `the interface promises fields no graph carries: ${phantom.join(', ')}`
    );
  });

  test('every field the schema requires is non-optional in the interface', () => {
    const schema = yaml.load(readFileSync(join(packageRoot, 'schemas/graph-schema.yaml'), 'utf8'));
    const source = readFileSync(join(packageRoot, 'types.d.ts'), 'utf8');
    const body = source.match(/export interface Graph \{([^}]*)\}/)[1];

    const optional = new Set(
      [...body.matchAll(/^\s*(\$?[a-zA-Z][a-zA-Z0-9]*)\?\s*:/gm)].map((m) => m[1])
    );
    const wrong = (schema.required ?? []).filter((name) => optional.has(name));

    assert.deepEqual(wrong, [], `required by the schema but optional in the interface: ${wrong.join(', ')}`);
  });
});
