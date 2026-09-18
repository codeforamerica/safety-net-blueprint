/**
 * Golden file tests for sequence-diagram HTML generation.
 *
 * Renders flow pages from a fixture config and compares against committed
 * golden files. A failure here means the rendering changed — either update
 * the golden with `npm run test:goldens-regenerate` if the change was
 * intentional, or investigate the regression.
 *
 * Golden outputs: tests/sequence-diagrams/goldens/
 *
 * To regenerate golden outputs, run the inline config through renderSequenceDiagrams
 * with the same pkgConfig defined below and outDir pointing at the goldens dir.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { renderSequenceDiagrams } from '../../src/sequence-diagrams/render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldensDir = join(__dirname, 'goldens');

// Enriched config covering all step and fragment rendering paths:
//   - domain + actor participants
//   - plain arrow step
//   - actor-sourced arrow (dark-blue dashed)
//   - arrow with condition label
//   - arrow with note below
//   - arrow with policies tooltip
//   - arrow with gap + gap_description
//   - arrow with overlay tooltip
//   - par fragment (simple steps path)
//   - par fragment with operands + separators (explicit branch labels)
//   - opt fragment with label
//   - self-loop
//   - self-loop with overlay
//   - ref step (cross-flow reference box)
//   - event arrow (green implemented, blue planned)
const pkgConfig = {
  title: 'Test',
  domains: [
    { id: 'intake',   label: 'Intake',   status: 'design-complete' },
    { id: 'workflow', label: 'Workflow', status: 'partial'         },
    { id: 'identity', label: 'Identity', status: 'not-started'    },
  ],
  actors: [
    { id: 'applicant', label: 'Applicant' },
  ],
  events: [
    { name: 'application.submitted', status: 'implemented' },
    { name: 'task.assigned',         status: 'planned'     },
  ],
  flows: [
    {
      id: 'submit-application',
      domain: 'intake',
      label: 'Submit Application',
      participants: ['applicant', 'intake', 'workflow'],
      steps: [
        // Actor-sourced plain arrow
        { from: 'applicant', to: 'intake', label: 'POST /applications' },
        // Arrow with condition label
        { from: 'intake', to: 'workflow', label: 'Route to caseworker', condition: 'if complete' },
        // Arrow with note below
        { from: 'workflow', to: 'intake', label: 'Acknowledge', note: '[if expedited] Prioritized processing' },
        // Arrow with policies tooltip
        { from: 'intake', to: 'workflow', event: 'application.submitted', policies: [{ citation: '7 CFR § 273.2', description: 'Application processing requirements' }] },
        // Arrow with gap + gap_description
        { from: 'intake', to: 'workflow', label: 'Notify third-party system', gap: true, gap_description: 'External integration not yet implemented' },
        // Arrow with overlay
        { from: 'workflow', to: 'intake', label: 'Return result', overlay: [{ note: 'States may inject custom routing here', mechanism: 'config overlay' }] },
        // par fragment using simple steps (not operands)
        {
          fragment: 'par',
          type: 'par',
          steps: [
            { from: 'intake', to: 'intake', self: 'intake', label: 'Validate form' },
            { from: 'intake', to: 'workflow', event: 'application.submitted' },
          ],
        },
        // par fragment using explicit operands with branch labels and separator
        {
          fragment: 'par',
          type: 'par',
          operands: [
            { label: 'SNAP branch',     steps: [{ from: 'intake', to: 'workflow', label: 'Create SNAP task' }] },
            { label: 'Medicaid branch', steps: [{ from: 'intake', to: 'intake',   self: 'intake', label: 'Log Medicaid application' }] },
          ],
        },
        // opt fragment with label
        {
          fragment: 'opt',
          type: 'opt',
          label: 'if expedited',
          steps: [
            { from: 'workflow', to: 'intake', label: 'Flag expedited' },
          ],
        },
        // self-loop with overlay tooltip
        { from: 'intake', to: 'intake', self: 'intake', label: 'Record decision', overlay: [{ note: 'States may extend record-keeping here', mechanism: 'step overlay' }] },
        // ref step (cross-flow reference box)
        { ref: 'verify-identity' },
      ],
    },
    // Second flow that the ref step above links to
    {
      id: 'verify-identity',
      domain: 'workflow',
      label: 'Verify Identity',
      participants: ['workflow', 'identity'],
      steps: [
        { from: 'workflow', to: 'identity', event: 'task.assigned' },
      ],
    },
  ],
};

const tmpDir = mkdtempSync(join(tmpdir(), 'seq-diag-golden-'));

describe('sequence-diagrams golden', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('submit-application flow matches golden', () => {
    renderSequenceDiagrams(pkgConfig, tmpDir);
    const html   = readFileSync(join(tmpDir, 'flow_intake_submit-application.html'), 'utf8');
    const golden = readFileSync(join(goldensDir, 'flow_intake_submit-application.html'), 'utf8');
    assert.strictEqual(html, golden,
      'sequence diagram HTML differs from golden — run `npm run test:goldens-regenerate` if the change was intentional');
  });

  it('verify-identity flow matches golden', () => {
    renderSequenceDiagrams(pkgConfig, tmpDir);
    const html   = readFileSync(join(tmpDir, 'flow_workflow_verify-identity.html'), 'utf8');
    const golden = readFileSync(join(goldensDir, 'flow_workflow_verify-identity.html'), 'utf8');
    assert.strictEqual(html, golden,
      'sequence diagram HTML differs from golden — run `npm run test:goldens-regenerate` if the change was intentional');
  });
});
