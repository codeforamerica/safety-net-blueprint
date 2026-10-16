/**
 * Unit tests for performSetup's boot checks.
 *
 * A failed check stops the server from booting, so its message is all a
 * person has to go on. It used to say only "Validation failed" and point at
 * `npm run validate`, a different validator that need not report the same
 * thing.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { performSetup } from '../../src/setup.js';
import { createMemoryStore } from '../../src/stores/memory-store.js';

test('a spec that fails validation names each error at boot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'setup-'));
  try {
    writeFileSync(join(dir, 'intake-openapi.yaml'), yaml.dump({
      openapi: '3.1.0',
      info: { title: 'Intake', version: '1.0.0', 'x-domain': 'intake' },
      servers: [{ url: 'http://localhost:1080/intake' }],
      paths: {
        '/applications': {
          get: { operationId: 'listApplications', responses: { 200: { description: 'ok' } } },
        },
      },
      components: {
        schemas: {
          Application: {
            type: 'object', required: ['id', 'status'], additionalProperties: false,
            properties: { id: { type: 'string' }, status: { type: 'string' } },
          },
        },
        examples: {
          ApplicationExample1: { value: { id: 'a1' } },
        },
      },
    }));

    await assert.rejects(
      performSetup({ specsDir: dir, verbose: false, store: createMemoryStore() }),
      (error) => {
        assert.match(error.message, /^Spec validation failed:/);
        assert.match(error.message, /intake: Example 'ApplicationExample1'.*required property 'status'/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
