/**
 * The validate-mock-data command checks records the way the server serves
 * them, which means seeding first: a relationship the contracts expand is
 * inlined from the store, and the record it points at may come from config
 * rather than mock data. Checked without seeding, the harness's transcripts —
 * whose profiles are seeded from config — failed with a bare profileId the
 * read schema doesn't have, while the server booted on them fine.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '../../cli/validate-mock-data.js');
const HARNESS = join(__dirname, '../../../blueprint-harness/generated/resolved');

test('a record pointing at a config-seeded resource is checked as served', () => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, `--spec=${HARNESS}`], { encoding: 'utf8' });
  assert.equal(status, 0, stdout + stderr);
  assert.match(stdout, /All mock data valid/);
});
