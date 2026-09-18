/**
 * Golden file tests for state-machine-docs HTML generation.
 *
 * Generates HTML from the fixture state machine and compares against committed
 * golden files. A failure here means the rendering changed — either update
 * the golden with `npm run test:goldens-regenerate` if the change was
 * intentional, or investigate the regression.
 *
 * Fixture input:  tests/state-machine-docs/fixtures/test-state-machine.yaml
 * Golden outputs: tests/state-machine-docs/goldens/
 *
 * To regenerate golden outputs:
 *   node -e "
 *     import { readFileSync, mkdirSync } from 'fs';
 *     import { join } from 'path';
 *     import { load } from 'js-yaml';
 *     import { buildEventIndex } from '@codeforamerica/blueprint-core';
 *     import { generateHtml, generateOverviewHtml, generateEventsHtml }
 *       from './src/state-machine-docs/generate-html.js';
 *     const inputsDir = 'tests/state-machine-docs/fixtures';
 *     const goldensDir = 'tests/state-machine-docs/goldens';
 *     const HUB_HREF = '../index.html';
 *     mkdirSync(goldensDir, { recursive: true });
 *     const smPath = join(inputsDir, 'test-state-machine.yaml');
 *     const sm = load(readFileSync(smPath, 'utf8'));
 *     const allStateMachines = [sm];
 *     const eventIndex = buildEventIndex(allStateMachines);
 *     generateOverviewHtml(allStateMachines, goldensDir, eventIndex, HUB_HREF);
 *     generateHtml(smPath, goldensDir, eventIndex, allStateMachines, HUB_HREF);
 *     generateEventsHtml(eventIndex, allStateMachines, goldensDir, HUB_HREF);
 *   " --input-type=module
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { buildEventIndex } from '@codeforamerica/blueprint-core';
import { generateHtml, generateOverviewHtml, generateEventsHtml } from '../../src/state-machine-docs/generate-html.js';
import { resolvedDir } from '../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldensDir = join(__dirname, 'goldens');
const HUB_HREF   = '../index.html';

const smPath          = join(resolvedDir, 'domains', 'intake', 'intake-state-machine.yaml');
const sm              = load(readFileSync(smPath, 'utf8'));
const allStateMachines = [sm];
const eventIndex      = buildEventIndex(allStateMachines);

const tmpDir = mkdtempSync(join(tmpdir(), 'sm-docs-golden-'));

describe('state-machine-docs golden', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('overview page matches golden', () => {
    generateOverviewHtml(allStateMachines, tmpDir, eventIndex, HUB_HREF);
    const html   = readFileSync(join(tmpDir, 'index.html'), 'utf8');
    const golden = readFileSync(join(goldensDir, 'index.html'), 'utf8');
    assert.strictEqual(html, golden,
      'overview HTML differs from golden — run `npm run test:goldens-regenerate` if the change was intentional');
  });

  it('domain page matches golden', () => {
    generateHtml(smPath, tmpDir, eventIndex, allStateMachines, HUB_HREF);
    const html   = readFileSync(join(tmpDir, 'intake.html'), 'utf8');
    const golden = readFileSync(join(goldensDir, 'intake.html'), 'utf8');
    assert.strictEqual(html, golden,
      'domain HTML differs from golden — run `npm run test:goldens-regenerate` if the change was intentional');
  });

  it('events page matches golden', () => {
    generateEventsHtml(eventIndex, allStateMachines, tmpDir, HUB_HREF);
    const html   = readFileSync(join(tmpDir, 'events.html'), 'utf8');
    const golden = readFileSync(join(goldensDir, 'events.html'), 'utf8');
    assert.strictEqual(html, golden,
      'events HTML differs from golden — run `npm run test:goldens-regenerate` if the change was intentional');
  });
});
