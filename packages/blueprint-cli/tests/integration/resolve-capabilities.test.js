/**
 * Capabilities: domains the framework provides beyond platform, which a
 * contract set includes by listing them in `x-capabilities`.
 *
 * Platform is infrastructure every set needs and always comes along; a
 * capability comes along only when asked for, so a set that does not use it
 * has none of its endpoints in its API, clients or docs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOLVE = join(__dirname, '../../scripts/resolve.js');

/** A one-domain contract set, with a config overlay listing `capabilities` when given. */
function contractSet(capabilities) {
  const dir = mkdtempSync(join(tmpdir(), 'capabilities-'));
  mkdirSync(join(dir, 'domains/demo'), { recursive: true });
  writeFileSync(join(dir, 'domains/demo/demo-openapi.yaml'), [
    'openapi: 3.1.0',
    'info: { title: Demo, version: 1.0.0, x-domain: demo }',
    'servers: [{ url: "http://localhost:1080/demo" }]',
    'paths: {}',
    '',
  ].join('\n'));
  if (capabilities) {
    mkdirSync(join(dir, 'overlays'));
    writeFileSync(join(dir, 'overlays/config.yaml'), [
      "overlay: '1.0.0'",
      'info: { title: Config, version: 1.0.0 }',
      'config:',
      `  x-capabilities: [${capabilities.join(', ')}]`,
      '',
    ].join('\n'));
  }
  return dir;
}

function resolveSet(dir) {
  const out = join(dir, 'out');
  const args = [RESOLVE, `--spec=${dir}`, `--out=${out}`];
  // --resolve: with no overlay and no flag, resolve only copies the set's own
  // files, and base contracts do not come into it at all.
  args.push(existsSync(join(dir, 'overlays')) ? `--overlay=${join(dir, 'overlays')}` : '--resolve');
  return { out, ...spawnSync(process.execPath, args, { encoding: 'utf8' }) };
}

describe('x-capabilities', () => {
  test('a set listing none gets platform and no capability', () => {
    const dir = contractSet();
    try {
      const { out, status, stderr } = resolveSet(dir);
      assert.equal(status, 0, stderr);
      assert.ok(existsSync(join(out, 'base/domains/platform/platform-events-openapi.yaml')), 'platform always comes along');
      assert.ok(!existsSync(join(out, 'base/domains/communication')), 'communication was not asked for');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a set listing communication gets it', () => {
    const dir = contractSet(['communication']);
    try {
      const { out, status, stderr } = resolveSet(dir);
      assert.equal(status, 0, stderr);
      assert.ok(existsSync(join(out, 'base/domains/communication/communication-transcripts-openapi.yaml')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a name the framework does not provide is refused, with the ones it does', () => {
    const dir = contractSet(['communicaton']);
    try {
      const { status, stderr } = resolveSet(dir);
      assert.notEqual(status, 0);
      assert.match(stderr, /x-capabilities names "communicaton", which the framework does not provide\. Available: communication\./);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
