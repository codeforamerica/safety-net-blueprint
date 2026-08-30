/**
 * Unit tests for AsyncAPI event validation.
 *
 * Tests buildAsyncApiChannelIndex and validateStateMachineEvents.
 * Smoke tests run against resolved contracts.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { buildAsyncApiChannelIndex, validateStateMachineEvents } from '../scripts/validate/annotations.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpecDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'specs-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === 'string' ? content : yaml.dump(content));
  }
  return dir;
}

function makeAsyncApiDoc(channels) {
  return {
    asyncapi: '3.0.0',
    info: { title: 'Test', version: '1.0.0' },
    channels: Object.fromEntries(
      channels.map(ch => [ch, { address: ch }])
    ),
  };
}

function makeStateMachineDoc({ eventsSpec, emitTypes = [], subscriptionTypes = [] }) {
  return {
    eventsSpec,
    machines: [
      {
        object: 'Application',
        actions: [
          {
            id: 'submit',
            steps: emitTypes.map(type => ({ emit: { type } })),
          },
        ],
        events: subscriptionTypes.map(type => ({ type })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// buildAsyncApiChannelIndex
// ---------------------------------------------------------------------------

describe('buildAsyncApiChannelIndex', () => {
  test('returns empty index when directory has no AsyncAPI specs', () => {
    const dir = makeSpecDir({});
    const { byFile, all } = buildAsyncApiChannelIndex(dir);
    assert.equal(byFile.size, 0);
    assert.equal(all.size, 0);
  });

  test('indexes channels from a single AsyncAPI spec', () => {
    const dir = makeSpecDir({
      'intake-asyncapi.yaml': yaml.dump(makeAsyncApiDoc([
        'intake.application.submitted',
        'intake.application.closed',
      ])),
    });
    const { byFile, all } = buildAsyncApiChannelIndex(dir);
    assert.ok(byFile.has('intake-asyncapi.yaml'));
    assert.ok(byFile.get('intake-asyncapi.yaml').has('intake.application.submitted'));
    assert.ok(byFile.get('intake-asyncapi.yaml').has('intake.application.closed'));
    assert.ok(all.has('intake.application.submitted'));
    assert.ok(all.has('intake.application.closed'));
  });

  test('indexes channels from multiple AsyncAPI specs', () => {
    const dir = makeSpecDir({
      'intake-asyncapi.yaml': yaml.dump(makeAsyncApiDoc(['intake.application.submitted'])),
      'workflow-asyncapi.yaml': yaml.dump(makeAsyncApiDoc(['workflow.task.created'])),
    });
    const { byFile, all } = buildAsyncApiChannelIndex(dir);
    assert.ok(byFile.get('intake-asyncapi.yaml').has('intake.application.submitted'));
    assert.ok(byFile.get('workflow-asyncapi.yaml').has('workflow.task.created'));
    assert.ok(all.has('intake.application.submitted'));
    assert.ok(all.has('workflow.task.created'));
  });

  test('skips non-asyncapi files', () => {
    const dir = makeSpecDir({
      'intake-openapi.yaml': yaml.dump({ openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: {} }),
      'intake-asyncapi.yaml': yaml.dump(makeAsyncApiDoc(['intake.application.submitted'])),
    });
    const { byFile } = buildAsyncApiChannelIndex(dir);
    assert.ok(!byFile.has('intake-openapi.yaml'));
    assert.ok(byFile.has('intake-asyncapi.yaml'));
  });

  test('byFile and all stay in sync across multiple specs', () => {
    const dir = makeSpecDir({
      'intake-asyncapi.yaml': yaml.dump(makeAsyncApiDoc(['intake.application.submitted'])),
      'workflow-asyncapi.yaml': yaml.dump(makeAsyncApiDoc(['workflow.task.created', 'workflow.task.completed'])),
    });
    const { byFile, all } = buildAsyncApiChannelIndex(dir);
    let total = 0;
    for (const channels of byFile.values()) total += channels.size;
    assert.equal(all.size, total);
  });
});

// ---------------------------------------------------------------------------
// validateStateMachineEvents
// ---------------------------------------------------------------------------

describe('validateStateMachineEvents', () => {
  test('returns empty array when channel index is empty (no AsyncAPI specs loaded)', () => {
    const doc = makeStateMachineDoc({
      eventsSpec: 'intake-asyncapi.yaml',
      emitTypes: ['intake.application.submitted'],
      subscriptionTypes: ['workflow.task.claimed'],
    });
    assert.deepEqual(validateStateMachineEvents(doc, { byFile: new Map(), all: new Set() }), []);
  });

  test('passes when emit type exists in the declared eventsSpec', () => {
    const channelIndex = {
      byFile: new Map([['intake-asyncapi.yaml', new Set(['intake.application.submitted'])]]),
      all: new Set(['intake.application.submitted']),
    };
    const doc = makeStateMachineDoc({
      eventsSpec: 'intake-asyncapi.yaml',
      emitTypes: ['intake.application.submitted'],
    });
    assert.deepEqual(validateStateMachineEvents(doc, channelIndex), []);
  });

  test('errors when emit type is missing from the declared eventsSpec', () => {
    const channelIndex = {
      byFile: new Map([['intake-asyncapi.yaml', new Set(['intake.application.closed'])]]),
      all: new Set(['intake.application.closed']),
    };
    const doc = makeStateMachineDoc({
      eventsSpec: 'intake-asyncapi.yaml',
      emitTypes: ['intake.application.submitted'],
    });
    const errors = validateStateMachineEvents(doc, channelIndex);
    assert.ok(errors.some(e => e.includes('"intake.application.submitted"')));
    assert.ok(errors.some(e => e.includes('intake-asyncapi.yaml')));
  });

  test('validates emit against all channels when no eventsSpec is declared', () => {
    const channelIndex = {
      byFile: new Map([['intake-asyncapi.yaml', new Set(['intake.application.submitted'])]]),
      all: new Set(['intake.application.submitted']),
    };
    const doc = makeStateMachineDoc({
      emitTypes: ['intake.application.submitted'],
    });
    assert.deepEqual(validateStateMachineEvents(doc, channelIndex), []);
  });

  test('errors when emit type not found in any spec (no eventsSpec declared)', () => {
    const channelIndex = {
      byFile: new Map([['intake-asyncapi.yaml', new Set(['intake.application.closed'])]]),
      all: new Set(['intake.application.closed']),
    };
    const doc = makeStateMachineDoc({
      emitTypes: ['intake.application.submitted'],
    });
    const errors = validateStateMachineEvents(doc, channelIndex);
    assert.ok(errors.some(e => e.includes('"intake.application.submitted"')));
  });

  test('passes when subscription type exists in any domain AsyncAPI spec', () => {
    const channelIndex = {
      byFile: new Map([
        ['intake-asyncapi.yaml', new Set(['intake.application.submitted'])],
        ['workflow-asyncapi.yaml', new Set(['workflow.task.claimed'])],
      ]),
      all: new Set(['intake.application.submitted', 'workflow.task.claimed']),
    };
    const doc = makeStateMachineDoc({
      eventsSpec: 'intake-asyncapi.yaml',
      subscriptionTypes: ['workflow.task.claimed'],
    });
    assert.deepEqual(validateStateMachineEvents(doc, channelIndex), []);
  });

  test('errors when subscription type not found in any AsyncAPI spec', () => {
    const channelIndex = {
      byFile: new Map([['intake-asyncapi.yaml', new Set(['intake.application.submitted'])]]),
      all: new Set(['intake.application.submitted']),
    };
    const doc = makeStateMachineDoc({
      eventsSpec: 'intake-asyncapi.yaml',
      subscriptionTypes: ['nonexistent.event.type'],
    });
    const errors = validateStateMachineEvents(doc, channelIndex);
    assert.ok(errors.some(e => e.includes('"nonexistent.event.type"')));
  });

  test('reports both emit and subscription errors independently', () => {
    const channelIndex = {
      byFile: new Map([['intake-asyncapi.yaml', new Set(['intake.application.closed'])]]),
      all: new Set(['intake.application.closed']),
    };
    const doc = makeStateMachineDoc({
      eventsSpec: 'intake-asyncapi.yaml',
      emitTypes: ['intake.application.submitted'],
      subscriptionTypes: ['workflow.task.claimed'],
    });
    const errors = validateStateMachineEvents(doc, channelIndex);
    assert.ok(errors.some(e => e.includes('"intake.application.submitted"')));
    assert.ok(errors.some(e => e.includes('"workflow.task.claimed"')));
  });

  test('emit errors reference the correct eventsSpec filename', () => {
    const channelIndex = {
      // The declared eventsSpec has no channels — emit type won't be found there.
      // all is non-empty so the early-return guard doesn't fire.
      byFile: new Map([['intake-asyncapi.yaml', new Set([])]]),
      all: new Set(['some.other.event']),
    };
    const doc = makeStateMachineDoc({
      eventsSpec: 'intake-asyncapi.yaml',
      emitTypes: ['intake.application.submitted'],
    });
    const errors = validateStateMachineEvents(doc, channelIndex);
    assert.ok(errors.some(e => e.includes('intake-asyncapi.yaml')));
  });

  test('handles deeply nested emit steps', () => {
    const channelIndex = {
      byFile: new Map([['intake-asyncapi.yaml', new Set(['intake.application.submitted'])]]),
      all: new Set(['intake.application.submitted']),
    };
    // Emit nested inside conditional branches
    const doc = {
      eventsSpec: 'intake-asyncapi.yaml',
      machines: [{
        object: 'Application',
        actions: [{
          id: 'submit',
          steps: [{
            condition: 'some.condition',
            branches: [
              { steps: [{ emit: { type: 'intake.application.submitted' } }] },
            ],
          }],
        }],
        events: [],
      }],
    };
    assert.deepEqual(validateStateMachineEvents(doc, channelIndex), []);
  });
});

// ---------------------------------------------------------------------------
// Scenario: emit type renamed in AsyncAPI spec
// ---------------------------------------------------------------------------

describe('scenario: emit type renamed in AsyncAPI spec', () => {
  // intake renamed application.submitted → application.filed
  const channelIndex = {
    byFile: new Map([['intake-asyncapi.yaml', new Set(['intake.application.filed'])]]),
    all: new Set(['intake.application.filed']),
  };

  test('catches stale emit type after channel rename', () => {
    const doc = makeStateMachineDoc({
      eventsSpec: 'intake-asyncapi.yaml',
      emitTypes: ['intake.application.submitted'],
    });
    const errors = validateStateMachineEvents(doc, channelIndex);
    assert.ok(errors.some(e => e.includes('"intake.application.submitted"')));
  });

  test('passes with updated emit type after channel rename', () => {
    const doc = makeStateMachineDoc({
      eventsSpec: 'intake-asyncapi.yaml',
      emitTypes: ['intake.application.filed'],
    });
    assert.deepEqual(validateStateMachineEvents(doc, channelIndex), []);
  });
});

// ---------------------------------------------------------------------------
// Scenario: cross-domain subscription to a channel that is later removed
// ---------------------------------------------------------------------------

describe('scenario: subscribed channel removed from another domain', () => {
  // workflow removed the workflow.task.claimed channel
  const channelIndex = {
    byFile: new Map([
      ['intake-asyncapi.yaml', new Set(['intake.application.submitted'])],
      ['workflow-asyncapi.yaml', new Set(['workflow.task.completed'])],
    ]),
    all: new Set(['intake.application.submitted', 'workflow.task.completed']),
  };

  test('catches stale subscription after cross-domain channel removal', () => {
    const doc = makeStateMachineDoc({
      eventsSpec: 'intake-asyncapi.yaml',
      subscriptionTypes: ['workflow.task.claimed'],
    });
    const errors = validateStateMachineEvents(doc, channelIndex);
    assert.ok(errors.some(e => e.includes('"workflow.task.claimed"')));
  });

  test('passes for subscription to a channel that still exists', () => {
    const doc = makeStateMachineDoc({
      eventsSpec: 'intake-asyncapi.yaml',
      subscriptionTypes: ['workflow.task.completed'],
    });
    assert.deepEqual(validateStateMachineEvents(doc, channelIndex), []);
  });
});

// ---------------------------------------------------------------------------
// Smoke tests — resolved contracts
