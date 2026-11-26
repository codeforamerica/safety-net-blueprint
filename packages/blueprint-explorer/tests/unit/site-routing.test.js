/**
 * A site's routing, bundled by the build: config.yaml names a routing file,
 * which names a module; the build checks it against the contracts and bundles
 * both into site-routing.js, which adds the routes to BlueprintExplorer.routing
 * with the module in place of its path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { bundleSiteRouting } from '../../src/lib/site-routing.js';

const resolvedDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../blueprint-harness/generated/resolved');

/** A site folder with config.yaml, a routing file and a module. */
function site(routing) {
  const dir = mkdtempSync(join(tmpdir(), 'site-routing-'));
  writeFileSync(join(dir, 'config.yaml'), 'routing: routing.yaml\n');
  writeFileSync(join(dir, 'routing.yaml'), routing);
  writeFileSync(join(dir, 'whisper.js'), `
    const said = (word) => () => new Response(word);
    export const startStream = said('started');
    export const stopStream = said('stopped');
  `);
  return dir;
}

test('the routing file and its module are bundled into one script that adds the routes', async () => {
  const dir = site('routing:\n  - api: communication-transcription-sessions-adapter\n    match: { provider: whisper }\n    handler: ./whisper.js\n');
  await bundleSiteRouting({ configDir: dir, outDir: dir, resolvedDir });
  const bundled = readFileSync(join(dir, 'site-routing.js'), 'utf8');
  const page = { globalThis: {}, Response: class { constructor(body) { this.body = body; } } };
  page.globalThis = page;
  page.BlueprintExplorer = { routing: [{ api: 'intake', to: 'https://intake.example' }] };
  vm.runInNewContext(bundled, page);
  const [kept, added] = page.BlueprintExplorer.routing;
  assert.deepEqual(kept, { api: 'intake', to: 'https://intake.example' }, 'the site script\'s routes stay first');
  assert.equal(JSON.stringify(added.match), JSON.stringify({ provider: 'whisper' }));
  assert.equal(added.handler.startStream().body, 'started');
});

test('routing the contracts refuse fails the build, naming each problem', async () => {
  const dir = site('routing:\n  - api: communication-transcriptz\n    to: https://x.example\n  - api: communication-transcription-sessions-adapter\n    match: { provider: whisper }\n    handler: ./missing.js\n');
  await assert.rejects(bundleSiteRouting({ configDir: dir, outDir: dir, resolvedDir }),
    (error) => /communication-transcriptz" is no API/.test(error.message) && /handler \.\/missing\.js, which doesn't exist/.test(error.message));
  assert.equal(existsSync(join(dir, 'site-routing.js')), false);
});
