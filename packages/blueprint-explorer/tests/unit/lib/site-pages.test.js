import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSitePages } from '../../../src/lib/site-pages.js';
import { build as buildAuthored } from '../../../src/authored.js';

/** A built explorer with config.yaml as given. */
function site(config) {
  const dir = mkdtempSync(join(tmpdir(), 'explorer-site-pages-'));
  writeFileSync(join(dir, 'config.yaml'), config);
  return dir;
}

describe('buildSitePages', () => {
  it('renders each Markdown page as an HTML page beside it, titled by its first heading', () => {
    const dir = site('name: AI Services\npages: pages\n');
    try {
      mkdirSync(join(dir, 'pages', 'guides'), { recursive: true });
      writeFileSync(join(dir, 'pages', 'getting-started.md'), '# Getting started\n\nCall [the API](../api-reference/x.html).\n\n```bash\ncurl x\n```\n');
      writeFileSync(join(dir, 'pages', 'guides', 'audio.md'), 'No heading here.\n');
      buildSitePages(dir);
      const page = readFileSync(join(dir, 'pages', 'getting-started.html'), 'utf8');
      assert.match(page, /<title>AI Services — Getting started<\/title>/);
      assert.match(page, /<a href="\.\.\/api-reference\/x\.html">the API<\/a>/);
      assert.match(page, /<pre><code class="language-bash">curl x/);
      assert.match(page, /href="\.\.\/index\.html"/, 'its breadcrumb leads home');
      const nested = readFileSync(join(dir, 'pages', 'guides', 'audio.html'), 'utf8');
      assert.match(nested, /<title>AI Services — Audio<\/title>/, 'titled by its file name without a heading');
      assert.match(nested, /href="\.\.\/\.\.\/index\.html"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does nothing when config.yaml names no pages', () => {
    const dir = site('name: AI Services\n');
    try {
      buildSitePages(dir);
      assert.ok(!existsSync(join(dir, 'pages')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails, naming the folder, when it is not there', () => {
    const dir = site('name: AI Services\npages: pages\n');
    try {
      assert.throws(() => buildSitePages(dir), /names pages: pages, but .*pages doesn't exist/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the Blueprint\'s own pages', () => {
  it('come along only when config.yaml asks for them', () => {
    const without = site('name: AI Services\n');
    const asked = site('name: Safety Net Blueprint\nblueprint_pages: true\n');
    try {
      const log = console.log; console.log = () => {};
      try { buildAuthored({ contentDir: without }); buildAuthored({ contentDir: asked }); } finally { console.log = log; }
      assert.ok(!existsSync(join(without, 'authored')));
      assert.match(readFileSync(join(asked, 'authored', 'executive-summary.html'), 'utf8'), /Safety Net Blueprint/);
    } finally {
      rmSync(without, { recursive: true, force: true });
      rmSync(asked, { recursive: true, force: true });
    }
  });
});
