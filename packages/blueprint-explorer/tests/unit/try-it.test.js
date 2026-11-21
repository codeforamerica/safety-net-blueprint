/**
 * The Scenarios page: three files, each loaded with a classic <script>, so
 * the page works served over http(s) and opened from disk (`file://`), where
 * it cannot fetch or import a file beside it.
 *
 * What a browser does with the page's own module script cannot be checked
 * here — Node does not run it. What can be is that everything it reads is
 * defined by a classic script beside it, and that the contract set it boots
 * from runs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createMockServer } from '@codeforamerica/blueprint-mock-server/server';
import { build } from '../../src/try-it/build.js';
import { buildBrowser } from '../../scripts/build-browser.js';
import { noticeProblems } from '../../../../scripts/third-party-notices.js';

const here = dirname(fileURLToPath(import.meta.url));
const resolvedDir = resolve(here, '../../../blueprint-harness/generated/resolved');

const configOf = (html) => JSON.parse(html.match(/<script type="application\/json" id="page-config">([^<]*)<\/script>/)[1]);

const built = await (async () => {
  await buildBrowser();
  const contentDir = mkdtempSync(join(tmpdir(), 'try-it-'));
  writeFileSync(join(contentDir, 'config.yaml'), [
    'first_tour: scenarios/framework-features.arazzo.yaml',
    'repo:',
    '  url: "https://github.com/example/contracts"',
    '  branch: main',
    '  spec_path: contracts',
  ].join('\n'));
  build({ contentDir, resolvedDir });
  const dir = join(contentDir, 'scenarios');
  return { dir, mockDir: join(contentDir, 'mock'), html: readFileSync(join(dir, 'index.html'), 'utf8') };
})();

test('the page loads the bundle and the contracts as classic scripts, before its own', () => {
  const mock = built.html.indexOf('<script src="../mock/mock.js"></script>');
  const contracts = built.html.indexOf('<script src="../mock/contracts.js"></script>');
  const page = built.html.indexOf('<script type="module">');
  assert.ok(mock > 0 && contracts > 0, 'both are loaded with a classic <script src>');
  assert.ok(mock < page && contracts < page, 'and before the page reads them');
});

test('the page fetches and imports nothing beside it', () => {
  assert.doesNotMatch(built.html, /fetch\(['"`]\.\//);
  assert.doesNotMatch(built.html, /import\(['"`]\.\//);
});

test('mock/contracts.js defines a contract set the mock server boots from', async () => {
  const context = {};
  vm.runInNewContext(readFileSync(join(built.mockDir, 'contracts.js'), 'utf8'), { globalThis: context });
  const artifact = context.BlueprintContracts;
  assert.equal(artifact.artifactVersion, 1);
  assert.match(context.BlueprintContractsVersion, /^[0-9a-f]{16}$/, 'and the version records are saved against');
  const mock = await createMockServer({ contracts: artifact });
  assert.ok(mock.routes.size > 0, 'the mock serves routes from it');
});

test('mock/mock.js defines the BlueprintMock global', () => {
  assert.match(readFileSync(join(built.mockDir, 'mock.js'), 'utf8'), /^var BlueprintMock=/);
});

test('the page links contract files from config.yaml and opens on its first tour', () => {
  assert.deepEqual(configOf(built.html), {
    sourceUrl: 'https://github.com/example/contracts/blob/main/contracts',
    firstTour: 'scenarios/framework-features.arazzo.yaml',
    apiPages: [],
  });
});

test('the page knows which API reference pages were built, for steps to link to', () => {
  const contentDir = mkdtempSync(join(tmpdir(), 'try-it-'));
  mkdirSync(join(contentDir, 'api-reference'));
  for (const name of ['index.html', 'intake.html', 'intake-rules.html']) writeFileSync(join(contentDir, 'api-reference', name), '');
  build({ contentDir, resolvedDir });
  const { apiPages } = configOf(readFileSync(join(contentDir, 'scenarios', 'index.html'), 'utf8'));
  assert.deepEqual(apiPages.sort(), ['intake', 'intake-rules'], 'every page but the index');
});

test('the bundle carries the notices of every third-party package inside it', async () => {
  const { packages } = await buildBrowser();
  assert.deepEqual(noticeProblems(packages), []);
});

test('the page leads back to the explorer, as every other page does', () => {
  assert.match(built.html, /<body>\n<div[^>]*><a href="\.\.\/index\.html"[^>]*>Explorer<\/a>/);
});
