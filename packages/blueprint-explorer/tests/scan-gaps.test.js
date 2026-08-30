import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { scanGaps } from '../src/context-map/scan-gaps.js';

// Capture console.log output for assertions
function captureLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { fn(); } finally { console.log = orig; }
  return lines;
}

const configWithGap = {
  flows: [{
    label: 'Submission',
    steps: [
      { label: 'Step A', gap: true, gap_description: 'submitApplication not yet implemented' },
      { label: 'Step B', gap: false },
    ],
  }],
};

const configNoGap = {
  flows: [{
    label: 'Submission',
    steps: [{ label: 'Step A' }],
  }],
};

const emptyContracts = '/tmp/nonexistent-contracts-dir-for-test';

describe('scanGaps', () => {
  it('reports gaps when present', () => {
    const lines = captureLog(() => scanGaps(configWithGap, emptyContracts));
    assert.ok(lines.some(l => l.includes('gap')), 'should log a gap warning');
    assert.ok(lines.some(l => l.includes('Step A')), 'should mention the gap step label');
  });

  it('reports no gaps when config has none', () => {
    const lines = captureLog(() => scanGaps(configNoGap, emptyContracts));
    assert.ok(lines.some(l => l.includes('No gaps') || l.includes('✅')));
  });

  it('handles empty flows gracefully', () => {
    assert.doesNotThrow(() => scanGaps({ flows: [] }, emptyContracts));
  });

  it('reports gap description', () => {
    const lines = captureLog(() => scanGaps(configWithGap, emptyContracts));
    assert.ok(lines.some(l => l.includes('submitApplication not yet implemented')));
  });

  it('recurses into fragment steps', () => {
    const config = {
      flows: [{
        label: 'Flow',
        steps: [{
          fragment: 'inner',
          steps: [{ label: 'Nested', gap: true, gap_description: 'nested gap' }],
        }],
      }],
    };
    const lines = captureLog(() => scanGaps(config, emptyContracts));
    assert.ok(lines.some(l => l.includes('nested gap')));
  });
});
