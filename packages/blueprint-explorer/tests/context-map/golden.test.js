/**
 * Golden file tests for context-map HTML (SVG fragment) generation.
 *
 * Renders the overview and per-domain detail pages from a fixture config and
 * compares against committed golden files. A failure here means the rendering
 * changed — either update the golden files if the change was intentional, or
 * investigate the regression.
 *
 * Golden outputs: tests/context-map/goldens/
 *
 * To regenerate golden outputs, run the inline pkgConfig and mapConfig through
 * renderContextMap with outDir pointing at the goldens dir.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { renderContextMap } from '../../src/context-map/render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldensDir = join(__dirname, 'goldens');

// Minimal but representative config covering:
//   - design-complete domain (gets overview + detail page)
//   - partial domain (gets detail page)
//   - not-started domain (overview only, no detail page)
//   - implemented and planned events
//   - API call
//   - cross-cutting concerns
//   - actors
//   - flows in domain header (hasFlows branch)
//   - layout positions so the overview hex grid actually renders hexagons
const pkgConfig = {
  domains: [
    { id: 'intake',   label: 'Intake',   status: 'design-complete', description: 'Application intake and eligibility screening', entities: ['Application'] },
    { id: 'workflow', label: 'Workflow', status: 'partial',         description: 'Task assignment and caseworker workflow' },
    { id: 'identity', label: 'Identity', status: 'not-started' },
  ],
  events: [
    { name: 'application.submitted', publisher: 'intake',   status: 'implemented', subscribers: ['workflow'] },
    { name: 'task.assigned',         publisher: 'workflow', status: 'planned',      subscribers: ['intake']  },
  ],
  apis: [
    { call: 'Get applicant profile', domain: 'identity', status: 'planned', callers: ['intake'] },
  ],
  actors: [{ id: 'applicant', label: 'Applicant' }],
  flows:  [{ id: 'submit-application', domain: 'intake', label: 'Submit Application', participants: ['applicant', 'intake'], steps: [] }],
  cross_cutting: ['Security', 'Observability'],
};

const mapConfig = {
  title: 'Test Context Map',
  subtitle: 'Test system integration map',
  // layout positions give each domain x/y grid coords so the overview
  // actually renders hexagons (domains without x are filtered out)
  layout: {
    intake:   { x: 0, y: 0 },
    workflow: { x: 1, y: 0 },
    identity: { x: 2, y: 0 },
  },
};

const tmpDir = mkdtempSync(join(tmpdir(), 'context-map-golden-'));

describe('context-map golden', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('overview page matches golden', () => {
    renderContextMap(pkgConfig, mapConfig, tmpDir);
    const html   = readFileSync(join(tmpDir, 'domains.html'), 'utf8');
    const golden = readFileSync(join(goldensDir, 'domains.html'), 'utf8');
    assert.strictEqual(html, golden,
      'context-map overview HTML differs from golden — regenerate if the change was intentional');
  });

  it('domain detail page (design-complete) matches golden', () => {
    renderContextMap(pkgConfig, mapConfig, tmpDir);
    const html   = readFileSync(join(tmpDir, 'domain_intake.html'), 'utf8');
    const golden = readFileSync(join(goldensDir, 'domain_intake.html'), 'utf8');
    assert.strictEqual(html, golden,
      'context-map domain detail HTML differs from golden — regenerate if the change was intentional');
  });

  it('domain detail page (partial) matches golden', () => {
    renderContextMap(pkgConfig, mapConfig, tmpDir);
    const html   = readFileSync(join(tmpDir, 'domain_workflow.html'), 'utf8');
    const golden = readFileSync(join(goldensDir, 'domain_workflow.html'), 'utf8');
    assert.strictEqual(html, golden,
      'context-map domain detail HTML differs from golden — regenerate if the change was intentional');
  });
});
