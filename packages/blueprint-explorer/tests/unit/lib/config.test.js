import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../../src/lib/config.js';

describe('loadConfig', () => {
  it('gives the defaults when there is no config.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'explorer-config-'));
    try {
      assert.deepEqual(loadConfig(dir), { name: 'Blueprint' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads config.yaml when there is one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'explorer-config-'));
    try {
      writeFileSync(join(dir, 'config.yaml'), 'name: Pizza delivery\n');
      assert.equal(loadConfig(dir).name, 'Pizza delivery');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
