/**
 * Capabilities: what the framework provides beyond platform, which a contract
 * set includes by listing them in `x-capabilities`.
 *
 * Platform is infrastructure every set needs and always comes along; a
 * capability comes along only when asked for, so a set that does not use it
 * has none of its endpoints in its API, clients or docs. The unit is the
 * capability each framework file declares, not its domain.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

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
      assert.ok(!existsSync(join(out, 'base/domains/communication')), 'transcripts were not asked for');
      assert.ok(!existsSync(join(out, 'base/domains/decision-support')), 'suggestions were not asked for');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a set listing transcripts gets every file that declares it', () => {
    const dir = contractSet(['transcripts']);
    try {
      const { out, status, stderr } = resolveSet(dir);
      assert.equal(status, 0, stderr);
      for (const file of ['openapi', 'state-machine', 'config', 'config-schema', 'mock-data', 'registry-transcription-services']) {
        assert.ok(existsSync(join(out, `base/domains/communication/communication-transcripts-${file}.yaml`)), file);
      }
      assert.ok(existsSync(join(out, 'base/domains/communication/communication-transcripts-events-asyncapi.yaml')), 'its generated events come along');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a set listing suggestions gets the decision-support files, and not transcripts', () => {
    const dir = contractSet(['suggestions']);
    try {
      const { out, status, stderr } = resolveSet(dir);
      assert.equal(status, 0, stderr);
      for (const file of ['openapi', 'state-machine', 'events-asyncapi']) {
        assert.ok(existsSync(join(out, `base/domains/decision-support/decision-support-suggestions-${file}.yaml`)), file);
      }
      assert.ok(!existsSync(join(out, 'base/domains/communication')), 'transcripts were not asked for');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a set narrows who may accept a suggestion, and changes how long one waits, by overlay", () => {
    const dir = contractSet(['suggestions']);
    try {
      writeFileSync(join(dir, 'overlays/suggestions.yaml'), [
        "overlay: '1.0.0'",
        'info: { title: Suggestions, version: 1.0.0 }',
        'actions:',
        "  - target: $.machines[?(@.object == 'Suggestion')].actions[?(@.id == 'accept')].guards[0]",
        '    update: { actors: [admin], conditions: [callOnlyForAnOperation, sameOperation] }',
        "  - target: $.machines[?(@.object == 'Suggestion')].on[?(@.type == 'decision-support.suggestion.created')].steps[0].then[0].set",
        '    update: { field: expiresAt, value: $now+P3D }',
        '',
      ].join('\n'));
      const { out, status, stderr } = resolveSet(dir);
      assert.equal(status, 0, stderr);
      const resolved = readFileSync(join(out, 'base/domains/decision-support/decision-support-suggestions-state-machine.yaml'), 'utf8');
      const [machine] = yaml.load(resolved).machines;
      const accept = machine.actions.find((action) => action.id === 'accept');
      assert.deepEqual(accept.guards[0].actors, ['admin']);
      const created = machine.on.find((entry) => entry.type.endsWith('decision-support.suggestion.created'));
      assert.equal(created.steps[0].then[0].set.value, '$now+P3D');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a domain name is not a capability: listing communication is refused, with the capabilities there are', () => {
    const dir = contractSet(['communication']);
    try {
      const { status, stderr } = resolveSet(dir);
      assert.notEqual(status, 0);
      assert.match(stderr, /x-capabilities names "communication", which the framework does not provide\. Available: suggestions, transcripts\./);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
