/**
 * The browser bundle carries the notice of every third-party package inside
 * it. Their licenses require the notice to travel with the code, and the
 * build doesn't stop over a missing or outdated one, since it runs on every
 * install; this is where that fails.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBrowser } from '../scripts/build-browser.js';
import { noticeProblems } from '../../../scripts/third-party-notices.js';

test('the browser bundle carries the notice of every third-party package inside it', async () => {
  const { outfile, packages } = await buildBrowser(join(mkdtempSync(join(tmpdir(), 'rules-bundle-')), 'browser.js'));
  const text = readFileSync(outfile, 'utf8');
  const notices = text.slice(text.lastIndexOf('/*!'));

  assert.ok(packages.length > 0, 'the rules engine bundles third-party code');
  for (const { name, version } of packages) {
    assert.ok(notices.includes(`${name}@${version} (`), `${name} should be named in the notices`);
  }
  assert.deepEqual(noticeProblems(packages), [], 'every package has notices, for the version bundled');
  assert.ok(notices.includes('Copyright 2008 Google Inc.'),
    'including the one @bufbuild/protobuf keeps only in a source comment, which minifying drops');
});
