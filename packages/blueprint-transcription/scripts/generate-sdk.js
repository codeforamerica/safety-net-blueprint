#!/usr/bin/env node
/**
 * Generate the SDK the driver is given, from the harness's contracts, as a
 * developer generates theirs from their own: blueprint-generate-ts-clients
 * with the fetch client, so a page can hand it the in-page mock's fetch.
 * Written to generated/sdk/, which isn't committed, and only again when the
 * contracts are newer than it.
 *
 * Usage: npm run sdk -w packages/blueprint-transcription
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contracts = join(root, '..', 'blueprint-harness', 'generated', 'resolved');
const out = join(root, 'generated', 'sdk');
const stamp = join(out, '.generated');

const newest = (dir) => Math.max(...readdirSync(dir, { recursive: true })
  .map((file) => statSync(join(dir, file)))
  .filter((stat) => stat.isFile())
  .map((stat) => stat.mtimeMs));

if (existsSync(stamp) && statSync(stamp).mtimeMs >= newest(contracts)) process.exit(0);

execFileSync(process.execPath, [
  join(root, '..', 'blueprint-cli', 'scripts', 'generate-ts-clients.js'),
  '--http-client=fetch', `--spec=${contracts}`, `--out=${out}`,
], { stdio: ['ignore', 'ignore', 'inherit'] });
writeFileSync(stamp, '');
console.log('Generated generated/sdk/ from the harness\'s contracts');
