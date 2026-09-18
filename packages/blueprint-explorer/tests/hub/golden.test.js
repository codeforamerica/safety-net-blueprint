/**
 * Golden file tests for the hub index page and authored pages.
 *
 * Runs hub.js as a subprocess against the shared fixture content directory and
 * compares the output against committed golden files. Hub calls authored.js
 * internally, so both the hub index and authored pages are exercised in one test.
 *
 * Shared fixture content dir: tests/fixtures/
 * Golden outputs:
 *   tests/hub/goldens/index.html
 *   tests/hub/goldens/authored/*.html
 *
 * The fixture exercises:
 *   - projectName, repoUrl, repo.branch (header, footer, authored token substitution)
 *   - authored pages rendered as leadership links in the hero strip
 *   - featuredLinks (hero callout strip)
 *   - outputTags for api-reference, data-dictionaries, state-machine-docs,
 *     rules-docs, context-map (domain_ prefix filtering), sequence-diagrams
 *
 * To regenerate the goldens:
 *   node src/hub.js --content=tests/fixtures
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../fixtures');
const goldenDir   = join(__dirname, 'goldens');
const scriptPath  = join(__dirname, '../../src/hub.js');

// Sub-directories with placeholder HTML files that hub scans for outputTags.
const TOOL_SUBDIRS = [
  'api-reference',
  'client-reference',
  'data-dictionaries',
  'state-machine-docs',
  'rules-docs',
  'context-map',
  'sequence-diagrams',
];

const tmpDir = mkdtempSync(join(tmpdir(), 'hub-golden-'));

describe('hub golden', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('index page matches golden', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), readFileSync(join(fixturesDir, 'config.yaml')));
    for (const sub of TOOL_SUBDIRS) {
      const srcSub = join(fixturesDir, sub);
      const dstSub = join(tmpDir, sub);
      mkdirSync(dstSub, { recursive: true });
      for (const f of readdirSync(srcSub).filter(f => f.endsWith('.html'))) {
        writeFileSync(join(dstSub, f), readFileSync(join(srcSub, f)));
      }
    }

    execFileSync(process.execPath, [scriptPath, `--content=${tmpDir}`]);

    const html   = readFileSync(join(tmpDir, 'index.html'), 'utf8');
    const golden = readFileSync(join(goldenDir, 'index.html'), 'utf8');
    assert.strictEqual(html, golden,
      'hub index HTML differs from golden — regenerate if the change was intentional');
  });

  it('authored pages match goldens', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), readFileSync(join(fixturesDir, 'config.yaml')));

    // Copy authored source pages so hub/authored.js can process them.
    const srcAuthored = join(fixturesDir, 'authored');
    const dstAuthored = join(tmpDir, 'authored');
    mkdirSync(dstAuthored, { recursive: true });
    for (const f of readdirSync(srcAuthored).filter(f => f.endsWith('.html'))) {
      writeFileSync(join(dstAuthored, f), readFileSync(join(srcAuthored, f)));
    }

    execFileSync(process.execPath, [scriptPath, `--content=${tmpDir}`]);

    const goldenAuthoredDir = join(goldenDir, 'authored');
    for (const file of readdirSync(goldenAuthoredDir).filter(f => f.endsWith('.html'))) {
      const html   = readFileSync(join(tmpDir, 'authored', file), 'utf8');
      const golden = readFileSync(join(goldenAuthoredDir, file), 'utf8');
      assert.strictEqual(html, golden,
        `authored/${file} differs from golden — regenerate if the change was intentional`);
    }
  });
});
