/**
 * The mock's own routes carry the operationIds contracts/mock-openapi.yaml
 * declares, so a scenario can call them by name.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { CONTROL_OPERATIONS } from '../../src/platform-routes.js';

test('every route the document declares has its operationId, and no other', () => {
  const doc = yaml.load(readFileSync(new URL('../../contracts/mock-openapi.yaml', import.meta.url), 'utf8'));
  const declared = {};
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of ['get', 'post', 'delete', 'patch', 'put']) {
      if (item[method]?.operationId) declared[`${method.toUpperCase()} ${path}`] = item[method].operationId;
    }
  }
  assert.deepStrictEqual(CONTROL_OPERATIONS, declared);
});
