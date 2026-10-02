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

describe('a page served from a subdirectory', () => {
  /** A minimal artifact with one postable collection. */
  const contracts = {
    artifactVersion: 1,
    docs: [{
      path: '/x/domains/demo/demo-openapi.yaml',
      relativePath: 'domains/demo/demo-openapi.yaml',
      domain: 'demo', type: 'openapi', provenance: null,
      content: {
        openapi: '3.1.0',
        info: { title: 'Demo', version: '1.0.0', 'x-domain': 'demo' },
        // The localhost server URL is where the domain prefix comes from, so
        // routes land at /demo/widgets as they do in a real contract set.
        servers: [{ url: 'http://localhost:1080/demo' }],
        paths: {
          '/widgets': {
            get: { operationId: 'listWidgets', responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WidgetList' } } } } } },
            post: {
              operationId: 'createWidget',
              requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WidgetCreate' } } } },
              responses: { 201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Widget' } } } } },
            },
          },
        },
        components: {
          schemas: {
            Widget: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, label: { type: 'string' } } },
            WidgetCreate: { type: 'object', required: ['label'], properties: { label: { type: 'string' } } },
            WidgetList: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Widget' } } } },
          },
        },
      },
    }],
  };

  // GitHub Pages serves a project site from /<repo>/, so this is the shape a
  // hosted page actually sees.
  const basePath = '/safety-net-blueprint/mock';
  const at = (path) => new URL(basePath + path, 'https://org.github.io');

  const serverAt = async () => {
    const { createMockServer } = await import('../../src/browser.js');
    return createMockServer({ contracts, basePath, seed: false });
  };

  test('routes resolve under the prefix', async () => {
    // Without stripping, every request 404s when hosted while the same page
    // works locally — the worst shape for a bug to take.
    const mock = await serverAt();
    assert.strictEqual((await mock.fetch(new Request(at('/demo/widgets')))).status, 200);
    assert.strictEqual((await mock.fetch(new Request(at('/health')))).status, 200);
  });

  test('a request without the prefix still resolves', async () => {
    // Called directly rather than through a hosted page — the mock should not
    // require the prefix it is told to tolerate.
    const mock = await serverAt();
    assert.strictEqual((await mock.fetch(new Request('https://org.github.io/demo/widgets'))).status, 200);
  });

  test('a stub registered on the contract path matches a prefixed request', async () => {
    // The interaction that was broken: routes matched on the stripped path
    // while handlers read the original, so a handler consulted the stub table
    // with `/safety-net-blueprint/mock/demo/widgets` and a stub registered for
    // `/demo/widgets` never matched. The route resolved; the stub silently
    // did not.
    const mock = await serverAt();

    const registered = await mock.fetch(new Request(at('/mock/stubs/http'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        match: { method: 'GET', url: '/demo/widgets' },
        response: { status: 503, body: { code: 'STUBBED' } },
      }),
    }));
    assert.strictEqual(registered.status, 201);

    const stubbed = await mock.fetch(new Request(at('/demo/widgets')));
    assert.strictEqual(stubbed.status, 503, 'the stub should have answered');
    assert.strictEqual((await stubbed.json()).code, 'STUBBED');

    // A stub is consumed when it matches, so the handler answers next time.
    assert.strictEqual((await mock.fetch(new Request(at('/demo/widgets')))).status, 200);
  });

  test('a body survives the rewrite', async () => {
    // The request is rebuilt to change its path, and a buffered rebuild would
    // consume the body before the handler read it.
    const mock = await serverAt();
    const created = await mock.fetch(new Request(at('/demo/widgets'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'from a hosted page' }),
    }));
    assert.strictEqual(created.status, 201);
    assert.strictEqual((await created.json()).label, 'from a hosted page');
  });

  test('an unknown path under the prefix is still a 404', async () => {
    const mock = await serverAt();
    assert.strictEqual((await mock.fetch(new Request(at('/demo/nothing-here')))).status, 404);
  });
});

describe('the single-file build', () => {
  /**
   * What can be checked without a browser, and what cannot.
   *
   * The single file inlines the bundle as a classic script and the artifact as
   * a JSON tag, because `file://` blocks fetching either as cross-origin. Two
   * ways that assembly can go wrong silently, and both did:
   *
   *   `String.replace` with a *string* replacement interprets `$&`, `` $` ``
   *   and `$'`. A minified bundle is full of `$` sequences, so the page was
   *   spliced into the middle of itself and the bundle truncated to 82 KB of
   *   543 KB. The file was written, looked plausible, and did not run.
   *
   *   A `</script` sequence anywhere in the inlined code ends the element
   *   early, truncating everything after it.
   *
   * Both are detectable by reading the file, which is what this does. What it
   * cannot do is run it: the page's own logic is a `<script type="module">`,
   * and executing that needs a real browser — jsdom does not run module
   * scripts, so a jsdom test here would pass while the page was broken.
   * Playwright against `file://` is the honest way to close that gap.
   */

  const buildPage = () => {
    const out = mkdtempSync(join(tmpdir(), 'mock-page-'));
    execFileSync(process.execPath, [
      resolve(packageRoot, '../blueprint-cli/scripts/build-mock-page.js'),
      `--spec=${resolve(packageRoot, '../blueprint-harness/generated/resolved')}`,
      `--out=${out}`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out;
  };

  test('inlines the whole bundle, not a truncated prefix of it', () => {
    const out = buildPage();
    const html = readFileSync(join(out, 'standalone.html'), 'utf8');
    const standalone = statSync(join(out, 'standalone.html')).size;
    const served = statSync(join(out, 'mock.js')).size;

    // The single file carries the bundle, the artifact and the page, so it
    // must be larger than the bundle alone. A truncated inline would not be.
    assert.ok(standalone > served,
      `standalone.html (${standalone}) should exceed mock.js (${served}) — a smaller file means the inline was cut short`);

    const openedAt = html.indexOf('<script>');
    const closedAt = html.indexOf('</script>', openedAt);
    const inlined = closedAt - openedAt - '<script>'.length;
    assert.ok(inlined > served * 0.95,
      `the inlined script is ${inlined} bytes against a ${served}-byte bundle — it was truncated`);
  });

  test('carries no unescaped script-closing sequence', () => {
    const out = buildPage();
    const html = readFileSync(join(out, 'standalone.html'), 'utf8');

    // Four elements: the bundle, the artifact, the page's module, and nothing
    // else. More closes than that means something inlined ended an element.
    const closes = html.match(/<\/script>/g) ?? [];
    assert.strictEqual(closes.length, 3,
      `expected exactly 3 </script> closes, found ${closes.length} — an inlined payload ended an element early`);
  });

  test('inlines an artifact that still parses', () => {
    const out = buildPage();
    const html = readFileSync(join(out, 'standalone.html'), 'utf8');

    const json = html.match(/<script type="application\/json" id="contracts-data">([\s\S]*?)<\/script>/);
    assert.ok(json, 'the artifact should be inlined as a JSON script tag');

    // `<` is escaped as < on the way in, which JSON.parse undoes — the
    // same thing the page does with the tag's textContent.
    const contracts = JSON.parse(json[1]);
    assert.strictEqual(contracts.artifactVersion, 1);
    assert.ok(contracts.docs.length > 0, 'and should carry the documents');
  });

  test('needs no network: nothing is fetched at runtime', () => {
    const out = buildPage();
    const html = readFileSync(join(out, 'standalone.html'), 'utf8');

    // The page prefers the inlined copies and only falls back to fetching,
    // so both lookups must find something present in this file.
    assert.ok(html.includes('id="contracts-data"'), 'the artifact must be inlined');
    assert.ok(html.includes('globalThis.BlueprintMock'), 'the bundle must be read from a global');
    assert.ok(html.includes('var BlueprintMock'), 'and the inlined bundle must define it');
  });
});
