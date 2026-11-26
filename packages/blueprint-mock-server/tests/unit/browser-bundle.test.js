/**
 * The browser entry bundles, and keeps bundling.
 *
 * This is the acceptance criterion of #448 expressed as a test. Everything
 * else in the suite runs in Node, where a `node:fs` import is invisible — and
 * a bundler resolves a whole module graph before it tree-shakes, so one such
 * import anywhere behind `src/server.js` fails a page build even if nothing
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
import { mkdtempSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildBrowser } from '../../scripts/build-browser.js';
import { noticeProblems } from '../../../../scripts/third-party-notices.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Bundle the browser entry the way the published esm-browser file is built,
 * returning the output path. Built once: every test reads the same file.
 * Throws on any error.
 */
let built;
async function bundle() {
  built ??= buildBrowser(join(mkdtempSync(join(tmpdir(), 'mock-bundle-')), 'mock.js'));
  return (await built).outfile;
}

/** A minimal artifact with one postable collection, whose create requires `label`. */
const postableContracts = {
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

describe('the browser entry', () => {

  test('resolves by the names the README tells people to import', async () => {
    // The browser entry existed for some time without being listed in
    // `exports`, so the documented import failed for everyone outside this
    // repo. Nothing caught it: the page's build bundles the file by path, and
    // every test here reached it by path too. This asks Node the question a
    // consumer asks. /browser is the older name for /server.
    for (const [specifier, file, name] of [
      // In Node, /server also has the HTTP server; a bundler for a page gets server.js.
      ['@codeforamerica/blueprint-mock-server/server', '/src/server.node.js', 'startMockServer'],
      ['@codeforamerica/blueprint-mock-server/browser', '/src/server.js', 'createMockServer'],
      ['@codeforamerica/blueprint-mock-server/client', '/src/client.js', 'createMockClient'],
    ]) {
      const resolved = await import.meta.resolve(specifier);
      assert.ok(resolved.endsWith(file), `${specifier} resolved to ${resolved}`);
      const entry = await import(specifier);
      assert.strictEqual(typeof entry[name], 'function', `${specifier} exports ${name}`);
    }
  });

  test('a page that imports /server by name bundles without the Node server', async () => {
    // The export conditions: Node gets server.node.js, with the HTTP server;
    // a bundler for the browser falls through to server.js.
    const { metafile } = await build({
      stdin: { contents: "export { createMockServer } from '@codeforamerica/blueprint-mock-server/server';", resolveDir: packageRoot },
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent',
    });
    const inputs = Object.keys(metafile.inputs);
    assert.ok(inputs.some((file) => file.endsWith('src/server.js')), inputs.join('\n'));
    assert.ok(!inputs.some((file) => file.endsWith('server.node.js') || file.endsWith('cli/server.js')), 'the Node server stayed out');
  });

  test('bundles for the browser platform with no Node builtins', async () => {
    // platform=browser makes `fs`, `path` and the rest unresolvable, so this
    // fails loudly rather than producing a bundle that breaks at runtime.
    const out = await bundle();
    assert.ok(statSync(out).size > 0, 'should produce a bundle');
  });

  test('the bundle actually runs, and serves a seeded request', async () => {
    // Building is not the same as working: a bundle can resolve cleanly and
    // still reference something only Node provides. This boots it.
    const out = await bundle();
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

  test('runs with no Node globals, on the failure path as well as the happy one', async () => {
    // Every other test here executes browser code inside Node, where `process`
    // and `Buffer` exist — so a Node-only global is invisible to all of them.
    // That is how `validator.js` shipped a bare `process.env.DEBUG_VALIDATION`
    // on the validation-failure path: a page returned
    // `500 INTERNAL_ERROR: process is not defined` for every rejected request,
    // and the bundle test passed because it only ever made a request that
    // succeeded.
    //
    // So: drop `process` the way a page does, and exercise a request that
    // fails validation, not just one that works. This has to be a child
    // process because `node:test` needs the global being removed.
    //
    // Only `process`. `Buffer` cannot be removed too, much as a page lacks
    // that as well: Node's bundled undici reaches for it to provide `Request`
    // and `fetch`, which a browser has natively, so deleting it fails inside
    // Node rather than inside anything being tested.
    const out = await bundle();
    const driver = join(dirname(out), 'no-globals.mjs');

    writeFileSync(driver, `
      import { createMockServer } from ${JSON.stringify(pathToFileURL(out).href)};

      delete globalThis.process;

      const mock = await createMockServer({ contracts: ${JSON.stringify(postableContracts)}, seed: false });
      const statuses = [];
      for (const body of [{ label: 'ok' }, {}]) {
        const response = await mock.fetch(new Request('http://localhost/demo/widgets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }));
        statuses.push(response.status);
      }
      console.log(JSON.stringify(statuses));
    `);

    const stdout = execFileSync(process.execPath, [driver], { encoding: 'utf8' });
    const [created, rejected] = JSON.parse(stdout.trim().split('\n').pop());

    assert.strictEqual(created, 201, 'a valid request should still be created');
    assert.strictEqual(rejected, 422,
      'a rejected request must answer 422, not a 500 from touching a Node global');
  });

  test('is published under its own filename, built on install and before publishing', () => {
    // A consumer copies one file rather than running a bundler of their own,
    // so the one name it has is its path. Only that file is exported, not all
    // of dist/. It isn't committed, so npm builds it, as it does the rules
    // engine's.
    const file = './dist/blueprint-mock-server.esm-browser.js';
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    assert.strictEqual(manifest.exports[file], file);
    assert.ok(manifest.files.includes('dist/'));
    assert.match(manifest.scripts.prepare, /scripts\/build-browser\.js/);
  });

  test('carries the notice of every third-party package inside it', async () => {
    // Their licenses require the notice to travel with the code, and a
    // consumer who copies the file shouldn't have to work out what's inside.
    await bundle();
    const { outfile, packages } = await built;
    const text = readFileSync(outfile, 'utf8');
    const notices = text.slice(text.lastIndexOf('/*!'));
    assert.ok(packages.length > 0, 'the mock bundles third-party code');
    for (const { name, version } of packages) {
      assert.ok(notices.includes(`${name}@${version} (`), `${name} should be named in the notices`);
    }
    assert.deepEqual(noticeProblems(packages), [], 'every package has notices, for the version bundled');
    assert.ok(notices.includes('Copyright 2008 Google Inc.'),
      'and a notice a package keeps only in a source comment, which minifying drops, is supplied');
  });

  test('mock.fetch has fetch\'s signature, so it can replace the global', async () => {
    // The property the whole design rests on: substituting the mock for the
    // real network is the identity function, not an adapter (#283).
    const out = await bundle();
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
  const contracts = postableContracts;

  // GitHub Pages serves a project site from /<repo>/, so this is the shape a
  // hosted page actually sees.
  const basePath = '/safety-net-blueprint/mock';
  const at = (path) => new URL(basePath + path, 'https://org.github.io');

  const serverAt = async () => {
    const { createMockServer } = await import('../../src/server.js');
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
