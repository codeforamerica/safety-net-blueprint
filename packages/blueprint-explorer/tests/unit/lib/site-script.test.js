import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addSiteScript } from '../../../src/lib/site-script.js';

const PAGE = '<!DOCTYPE html><html><body><p>page</p></body></html>';

/** A built explorer with a page at the top and one in a folder, and config.yaml as given. */
function site(config) {
  const dir = mkdtempSync(join(tmpdir(), 'explorer-site-script-'));
  mkdirSync(join(dir, 'api-reference'));
  writeFileSync(join(dir, 'index.html'), PAGE);
  writeFileSync(join(dir, 'api-reference', 'intake.html'), PAGE);
  if (config !== null) writeFileSync(join(dir, 'config.yaml'), config);
  return dir;
}

describe('addSiteScript', () => {
  it('loads the script config.yaml names on every page, by its path from each', () => {
    const dir = site('script: portal.js\n');
    try {
      writeFileSync(join(dir, 'portal.js'), '');
      addSiteScript(dir);
      assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /<script src="portal\.js"><\/script>\n<\/body>/);
      assert.match(readFileSync(join(dir, 'api-reference', 'intake.html'), 'utf8'), /<script src="\.\.\/portal\.js"><\/script>/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds it once, however often the build runs', () => {
    const dir = site('script: portal.js\n');
    try {
      writeFileSync(join(dir, 'portal.js'), '');
      addSiteScript(dir);
      addSiteScript(dir);
      assert.equal(readFileSync(join(dir, 'index.html'), 'utf8').match(/portal\.js/g).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves the pages alone when config.yaml names no script', () => {
    const dir = site(null);
    try {
      addSiteScript(dir);
      assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), PAGE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails, naming the file, when the script is not there', () => {
    const dir = site('script: portal.js\n');
    try {
      assert.throws(() => addSiteScript(dir), /names script: portal\.js, but .*portal\.js doesn't exist/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
