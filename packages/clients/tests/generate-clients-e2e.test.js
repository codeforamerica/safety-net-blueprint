/**
 * End-to-end test for the TypeScript client generation pipeline.
 *
 * These tests actually invoke the openapi-ts binary against a minimal spec so
 * that dependency version mismatches or binary resolution failures are caught
 * locally rather than only in CI.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'url';
import { exec } from '../scripts/generate-clients-typescript.js';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientsRoot = join(__dirname, '..');
const projectRoot = join(clientsRoot, '..', '..');

const MINIMAL_SPEC = `\
openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths:
  /items:
    get:
      operationId: listItems
      summary: List items
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ItemList'
components:
  schemas:
    Item:
      type: object
      required: [id]
      properties:
        id:
          type: string
        name:
          type: string
    ItemList:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/Item'
`;

const OPENAPI_TS_CONFIG = (specPath, outPath) => `\
export default {
  input: '${specPath}',
  output: {
    path: '${outPath}',
  },
  plugins: [
    { name: '@hey-api/typescript', enums: 'javascript', style: 'PascalCase' },
    { name: '@hey-api/sdk', validator: true },
    'zod',
    { name: '@hey-api/client-axios' },
  ],
};
`;

describe('Client generation pipeline (e2e)', () => {
  it('openapi-ts is installed in node_modules (not relying on global or registry)', () => {
    const localBin = join(clientsRoot, 'node_modules', '.bin', 'openapi-ts');
    const rootBin = join(projectRoot, 'node_modules', '.bin', 'openapi-ts');
    const found = existsSync(localBin) || existsSync(rootBin);
    assert.ok(
      found,
      `openapi-ts binary not found at ${localBin} or ${rootBin} — run npm install`
    );
  });

  it('generates TypeScript client files from a minimal OpenAPI spec', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'snb-e2e-'));
    try {
      const specPath = join(workDir, 'test-openapi.yaml');
      const outPath = join(workDir, 'out');
      const configPath = join(workDir, 'openapi-ts.config.js');

      writeFileSync(specPath, MINIMAL_SPEC);
      writeFileSync(configPath, OPENAPI_TS_CONFIG(specPath, outPath));

      // cwd must be within the project so npx resolves the installed version
      // from node_modules rather than fetching @latest from the registry
      await exec('npx', ['@hey-api/openapi-ts', '-f', configPath], { cwd: clientsRoot });

      assert.ok(existsSync(join(outPath, 'types.gen.ts')), 'types.gen.ts was not generated');
      assert.ok(existsSync(join(outPath, 'sdk.gen.ts')), 'sdk.gen.ts was not generated');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
