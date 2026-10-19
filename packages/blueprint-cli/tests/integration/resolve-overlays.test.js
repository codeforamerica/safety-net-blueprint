/**
 * Integration tests for blueprint-resolve's --overlay, given more than once.
 *
 * A package's contracts can depend on the package's own overlays —
 * safety-net-contracts adds its roles that way — so a state resolving them
 * applies the package's overlays and then its own. One --overlay meant
 * copying the package's files into the state's folder (#478).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOLVE = join(__dirname, '../../scripts/resolve.js');

const overlay = (title, update) => yaml.dump({
  overlay: '1.0.0',
  info: { title, version: '1.0.0' },
  actions: [{ target: '$.info.description', file: 'demo-openapi.yaml', update }],
});

describe('blueprint-resolve --overlay', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'resolve-overlays-'));
    mkdirSync(join(dir, 'spec'));
    writeFileSync(join(dir, 'spec/demo-openapi.yaml'), yaml.dump({
      openapi: '3.1.0',
      info: { title: 'Demo', version: '1.0.0', 'x-domain': 'demo', description: 'As written.' },
      paths: {},
    }));
    mkdirSync(join(dir, 'package-overlays'));
    writeFileSync(join(dir, 'package-overlays/package.yaml'), overlay('The package', 'From the package.'));
    mkdirSync(join(dir, 'state-overlays'));
    writeFileSync(join(dir, 'state-overlays/state.yaml'), overlay('The state', 'From the state.'));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const resolve = (...args) => spawnSync(process.execPath, [RESOLVE, `--spec=${join(dir, 'spec')}`, ...args], { encoding: 'utf8' });
  const description = (out) => yaml.load(readFileSync(join(out, 'demo-openapi.yaml'), 'utf8')).info.description;

  test('given more than once, applies each in the order given', () => {
    const out = join(dir, 'out-package-then-state');
    const { status, stderr } = resolve(`--overlay=${join(dir, 'package-overlays')}`, `--overlay=${join(dir, 'state-overlays')}`, `--out=${out}`);
    assert.equal(status, 0, stderr);
    assert.equal(description(out), 'From the state.');
  });

  test('the order decides which applies last', () => {
    const out = join(dir, 'out-state-then-package');
    const { status, stderr } = resolve(`--overlay=${join(dir, 'state-overlays')}`, `--overlay=${join(dir, 'package-overlays')}`, `--out=${out}`);
    assert.equal(status, 0, stderr);
    assert.equal(description(out), 'From the package.');
  });

  test('--spec given twice is refused, not silently replaced', () => {
    const { status, stderr } = spawnSync(process.execPath, [RESOLVE, '--spec=a', '--spec=b', `--out=${join(dir, 'x')}`], { encoding: 'utf8' });
    assert.notEqual(status, 0);
    assert.match(stderr, /--spec is given more than once/);
  });
});
