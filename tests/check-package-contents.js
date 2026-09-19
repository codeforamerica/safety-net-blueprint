/**
 * Verifies that each publishable npm package includes the expected files.
 * Runs `npm pack --dry-run --json` and checks for required file patterns.
 */

import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Recursively list all files under a directory, returning paths relative to that directory.
 */
function listFilesRecursive(dir, base = dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(full, base) : [relative(base, full).replace(/\\/g, '/')];
  });
}

const PACKAGES = [
  {
    workspace: 'packages/blueprint-core',
    required: [
      'src/index.js',
      'schemas/state-machine-schema.yaml',
      'README.md',
      ...listFilesRecursive('packages/blueprint-core/base-contracts').map(f => `base-contracts/${f}`),
      ...listFilesRecursive('packages/blueprint-core/assets').map(f => `assets/${f}`),
    ],
  },
  {
    workspace: 'packages/blueprint-cli',
    required: ['scripts/resolve.js', 'scripts/scaffold-api.js', 'scripts/validate.js', 'README.md'],
  },
  {
    workspace: 'packages/blueprint-mock-server',
    required: ['cli/server.js', 'src/route-generator.js', 'tests/test-utils.js', 'README.md'],
  },
  {
    workspace: 'packages/safety-net-contracts',
    required: [
      'src/domains/intake/intake-openapi.yaml',
      'src/domains/eligibility/eligibility-openapi.yaml',
      'src/domains/workflow/workflow-openapi.yaml',
      'src/overlays/config.yaml',
      'README.md',
    ],
  },
];

for (const pkg of PACKAGES) {
  test(`${pkg.workspace} contains required files`, () => {
    const output = execSync(`npm pack --dry-run --json --workspace=${pkg.workspace}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const files = JSON.parse(output)[0].files.map(f => f.path);
    const missing = pkg.required.filter(r => !files.includes(r));
    assert.deepEqual(missing, [], `Missing files: ${missing.join(', ')}`);
  });
}
