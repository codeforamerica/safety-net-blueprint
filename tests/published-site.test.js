/**
 * The site GitHub Pages serves, checked as committed.
 *
 * `packages/safety-net-explorer/` is build output that lives in the
 * repository, so what is committed is what is published. It drifted badly
 * once: a tool ended the build early with a success status, and for five
 * weeks the published API reference read "0 contract domains" while every
 * preflight passed.
 *
 * These read the committed files directly rather than building, so they fail
 * on the commit that breaks the site instead of on the next person to run a
 * build.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(repoRoot, 'packages', 'safety-net-explorer');
const domainsDir = join(repoRoot, 'packages', 'safety-net-contracts', 'src', 'domains');

function pagesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pagesUnder(full);
    return full.endsWith('.html') ? [full] : [];
  });
}

describe('the published explorer', () => {
  it('is reachable from the repository root', () => {
    const redirect = readFileSync(join(repoRoot, 'index.html'), 'utf8');
    const [, target] = redirect.match(/url=([^"'>\s]+)/) ?? [];

    assert.ok(target, 'the root page redirects nowhere');
    assert.ok(
      existsSync(join(repoRoot, target)),
      `the root page redirects to ${target}, which is not in the repository`,
    );
  });

  it('has no link pointing at a page that was never written', () => {
    const dangling = new Set();
    for (const page of pagesUnder(site)) {
      const html = readFileSync(page, 'utf8');
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        if (/^(https?:|mailto:|#|data:|\/\/)/.test(href)) continue;
        const target = resolve(dirname(page), href.split('#')[0]);
        if (!existsSync(target)) dangling.add(`${relative(site, page)} → ${href}`);
      }
    }

    assert.deepEqual([...dangling], []);
  });

  it('documents every domain the contracts declare', () => {
    // The regression this catches: an API reference landing page that was
    // generated when the build last completed, naming none of them.
    const declared = readdirSync(domainsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    const index = readFileSync(join(site, 'api-reference', 'index.html'), 'utf8');
    const [, counted] = index.match(/for (\d+) contract domains/) ?? [];

    assert.equal(Number(counted), declared.length);
  });

  it('draws every domain on the context map', () => {
    const declared = readdirSync(domainsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
    const overview = readFileSync(join(site, 'context-map', 'domains.html'), 'utf8');

    const missing = declared.filter(label =>
      !label.split(' ').every(word => overview.includes(word)));

    assert.deepEqual(missing, []);
  });
});
