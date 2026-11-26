/**
 * The typed events the client generator writes beside an API's client
 * (generateEventHelpers) narrow an event by its type and check what's
 * published: tests/fixtures/typed-events/use.ts compiles against the
 * harness's generated clients, its expected errors included. Errors in
 * hey-api's own client scaffold, which doesn't pass strict checking, are
 * left out: only the fixture's count.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, '../fixtures/typed-events/use.ts');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

test('typed events narrow by type and check what is published', () => {
  let output = '';
  try {
    execFileSync(process.execPath, [tsc, '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022',
      '--module', 'ESNext', '--moduleResolution', 'Bundler', '--lib', 'ES2022,DOM', fixture], { encoding: 'utf8' });
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  const fixtureErrors = output.split('\n').filter((line) => line.includes('typed-events/use.ts'));
  assert.deepEqual(fixtureErrors, []);
});
