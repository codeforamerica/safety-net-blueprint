/**
 * A contract file that does not parse stops discover and load, naming the
 * file. discover used to skip it, so validate never saw the file and passed,
 * and a state machine with a typo simply was not in the set.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover, load } from '../../src/index.js';

describe('a contract file that does not parse', () => {
  let dir;
  const broken = () => join(dir, 'intake-state-machine.yaml');

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'discover-'));
    writeFileSync(join(dir, 'intake-openapi.yaml'), 'openapi: 3.1.0\ninfo: {title: Intake, version: 1.0.0}\n');
    writeFileSync(broken(), 'domain: intake\nmachine:\n  states: [open\n  initialState: open\n');
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  test('discover throws, naming the file and where it fails', () => {
    assert.throws(() => discover(dir), (err) => {
      assert.match(err.message, /intake-state-machine\.yaml is not valid YAML: /);
      assert.match(err.message, /\(line \d+, column \d+\)$/);
      return true;
    });
  });

  test('load throws the same way', () => {
    assert.throws(() => load(broken()), /intake-state-machine\.yaml is not valid YAML: /);
  });

  test('a set whose files all parse is discovered as before', () => {
    writeFileSync(broken(), 'domain: intake\nmachine:\n  states: [open]\n  initialState: open\n');
    assert.deepEqual(discover(dir).map((f) => f.relativePath).sort(), ['intake-openapi.yaml', 'intake-state-machine.yaml']);
  });
});
