/**
 * The browser entry bundles, and keeps bundling.
 *
 * This is the acceptance criterion of #448 expressed as a test. Everything
 * else in the suite runs in Node, where a `node:fs` import is invisible — and
 * a bundler resolves a whole module graph before it tree-shakes, so one such
 * import anywhere behind `src/browser.js` fails a page build even if nothing
 * in a page would call it.
 *
 * The failure mode this guards against is specific and has already happened
 * twice in this package: `spec-loader.js` imported `discover`/`load` for a
 * function a page never calls, and `seeder.js` imported `extract` from core's
 * main entry rather than its `/browser` subpath. Both are invisible to every
 * other test here.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const entry = join(packageRoot, 'src/browser.js');

/** Bundle the browser entry, returning the output path. Throws on any error. */
function bundle({ minify = false } = {}) {
  const out = join(mkdtempSync(join(tmpdir(), 'mock-bundle-')), 'mock.js');
  const args = ['esbuild', entry, '--bundle', '--platform=browser', '--format=esm',
    '--log-level=error', `--outfile=${out}`];
  if (minify) args.push('--minify');

  const stderr = execFileSync('npx', args, { cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(stderr.trim(), '', 'esbuild reported problems');
  return out;
}

describe('the browser entry', () => {

  test('bundles for the browser platform with no Node builtins', () => {
    // platform=browser makes `fs`, `path` and the rest unresolvable, so this
    // fails loudly rather than producing a bundle that breaks at runtime.
    const out = bundle();
    assert.ok(statSync(out).size > 0, 'should produce a bundle');
  });

  test('the bundle actually runs, and serves a seeded request', async () => {
    // Building is not the same as working: a bundle can resolve cleanly and
    // still reference something only Node provides. This boots it.
    const out = bundle({ minify: true });
    const { createMockServer } = await import(out);

    const contracts = {
      artifactVersion: 1,
      docs: [
        {
          path: '/x/domains/demo/demo-openapi.yaml',
          relativePath: 'domains/demo/demo-openapi.yaml',
          domain: 'demo',
          type: 'openapi',
          provenance: null,
          content: {
            openapi: '3.1.0',
            info: { title: 'Demo', version: '1.0.0', 'x-domain': 'demo' },
            servers: [{ url: 'http://localhost:1080/demo' }],
            paths: {
              '/widgets': {
                get: {
                  operationId: 'listWidgets',
                  responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WidgetList' } } } } },
                },
              },
            },
            components: {
              schemas: {
                Widget: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, label: { type: 'string' } } },
                WidgetList: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Widget' } } } },
              },
            },
          },
        },
        {
          path: '/x/domains/demo/demo-mock-data.yaml',
          relativePath: 'domains/demo/demo-mock-data.yaml',
          domain: 'demo',
          type: 'mock-data',
          provenance: null,
          // A mock-data document holds each record directly under its key —
          // `value:` wrapping is the `components.examples` convention, not
          // this one.
          content: { WidgetExample1: { id: 'w1', label: 'First' } },
        },
      ],
    };

    const mock = await createMockServer({ contracts });
    assert.ok(mock.routes.size > 0, 'routes should be registered');

    const response = await mock.fetch(new Request('http://localhost/demo/widgets'));
    assert.strictEqual(response.status, 200);

    const body = await response.json();
    assert.ok(Array.isArray(body.items), 'a list endpoint should answer with items');
    assert.strictEqual(body.items.length, 1, 'and the mock-data record should have been seeded');
    assert.strictEqual(body.items[0].id, 'w1');
  });

  test('mock.fetch has fetch\'s signature, so it can replace the global', async () => {
    // The property the whole design rests on: substituting the mock for the
    // real network is the identity function, not an adapter (#283).
    const out = bundle({ minify: true });
    const { createMockServer } = await import(out);

    const mock = await createMockServer({
      contracts: {
        artifactVersion: 1,
        docs: [{
          path: '/x/a-openapi.yaml', relativePath: 'a-openapi.yaml', domain: 'a',
          type: 'openapi', provenance: null,
          content: { openapi: '3.1.0', info: { title: 'A', version: '1' }, paths: {} },
        }],
      },
      seed: false,
    });

    assert.strictEqual(typeof mock.fetch, 'function');
    assert.strictEqual(mock.fetch.length <= 2, true, 'takes a Request, like fetch');

    const viaGlobal = await mock.fetch(new Request('http://localhost/health'));
    assert.strictEqual(viaGlobal.status, 200);
  });
});
