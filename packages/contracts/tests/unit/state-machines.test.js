import { test } from 'node:test';
import assert from 'node:assert';
import {
  getSteps,
  getMatchBranches,
  getForEachBody,
  collectEmitSteps,
  buildEventIndex,
} from '../../src/state-machines.js';

// ── getSteps ──────────────────────────────────────────────────────────────────

test('getSteps', async (t) => {
  await t.test('returns steps array when present', () => {
    assert.deepStrictEqual(getSteps({ steps: [1, 2] }), [1, 2]);
  });

  await t.test('falls back to then array', () => {
    assert.deepStrictEqual(getSteps({ then: [3, 4] }), [3, 4]);
  });

  await t.test('returns empty array for null/undefined', () => {
    assert.deepStrictEqual(getSteps(null), []);
    assert.deepStrictEqual(getSteps(undefined), []);
    assert.deepStrictEqual(getSteps({}), []);
  });
});

// ── getMatchBranches ──────────────────────────────────────────────────────────

test('getMatchBranches', async (t) => {
  await t.test('returns when map when present', () => {
    assert.deepStrictEqual(getMatchBranches({ when: { a: [1] } }), { a: [1] });
  });

  await t.test('falls back to on map', () => {
    assert.deepStrictEqual(getMatchBranches({ on: { b: [2] } }), { b: [2] });
  });

  await t.test('returns empty object for missing', () => {
    assert.deepStrictEqual(getMatchBranches({}), {});
    assert.deepStrictEqual(getMatchBranches(null), {});
  });
});

// ── getForEachBody ────────────────────────────────────────────────────────────

test('getForEachBody', async (t) => {
  await t.test('returns do array when present', () => {
    assert.deepStrictEqual(getForEachBody({ do: [1] }), [1]);
  });

  await t.test('falls back to then array', () => {
    assert.deepStrictEqual(getForEachBody({ then: [2] }), [2]);
  });

  await t.test('returns empty array for missing', () => {
    assert.deepStrictEqual(getForEachBody({}), []);
  });
});

// ── collectEmitSteps ──────────────────────────────────────────────────────────

test('collectEmitSteps', async (t) => {
  await t.test('collects direct emit steps', () => {
    const steps = [
      { emit: { type: 'intake.application.submitted' } },
      { emit: { type: 'intake.application.updated' } },
    ];
    assert.deepStrictEqual(collectEmitSteps(steps), [
      'intake.application.submitted',
      'intake.application.updated',
    ]);
  });

  await t.test('walks into if/else branches', () => {
    const steps = [{
      if: '$this.data.snap',
      steps: [{ emit: { type: 'intake.snap.flagged' } }],
      else:  [{ emit: { type: 'intake.snap.skipped' } }],
    }];
    assert.deepStrictEqual(collectEmitSteps(steps), [
      'intake.snap.flagged',
      'intake.snap.skipped',
    ]);
  });

  await t.test('walks into match branches', () => {
    const steps = [{
      match: '$this.data.status',
      when: {
        approved: [{ emit: { type: 'intake.application.approved' } }],
        denied:   [{ emit: { type: 'intake.application.denied' } }],
      },
    }];
    const result = collectEmitSteps(steps);
    assert.ok(result.includes('intake.application.approved'));
    assert.ok(result.includes('intake.application.denied'));
  });

  await t.test('walks into forEach body', () => {
    const steps = [{
      forEach: { in: '$this.data.members', do: [{ emit: { type: 'intake.member.added' } }] },
    }];
    assert.deepStrictEqual(collectEmitSteps(steps), ['intake.member.added']);
  });

  await t.test('returns empty for steps with no emits', () => {
    assert.deepStrictEqual(collectEmitSteps([{ set: { field: 'x', value: 1 } }]), []);
    assert.deepStrictEqual(collectEmitSteps([]), []);
    assert.deepStrictEqual(collectEmitSteps(null), []);
  });
});

// ── buildEventIndex ───────────────────────────────────────────────────────────

test('buildEventIndex', async (t) => {
  const intakeSM = {
    domain: 'intake',
    machines: [{
      object: 'Application',
      actions: [{
        id: 'submit',
        steps: [{ emit: { type: 'intake.application.submitted' } }],
      }],
      events: [],
    }],
  };

  const eligibilitySM = {
    domain: 'eligibility',
    machines: [{
      object: 'Determination',
      actions: [],
      events: [{ type: 'intake.application.submitted' }],
    }],
  };

  await t.test('indexes emitters from action emit steps', () => {
    const { emitters } = buildEventIndex([intakeSM]);
    assert.deepStrictEqual(emitters['intake.application.submitted'], {
      domain: 'intake',
      object: 'Application',
    });
  });

  await t.test('indexes subscribers from machine events', () => {
    const { subscribers } = buildEventIndex([eligibilitySM]);
    assert.deepStrictEqual(subscribers['intake.application.submitted'], [
      { domain: 'eligibility', object: 'Determination' },
    ]);
  });

  await t.test('cross-domain index links emitters and subscribers', () => {
    const { emitters, subscribers } = buildEventIndex([intakeSM, eligibilitySM]);
    assert.ok(emitters['intake.application.submitted']);
    assert.ok(subscribers['intake.application.submitted']?.length === 1);
  });

  await t.test('handles events subscribed but not emitted', () => {
    const { emitters, subscribers } = buildEventIndex([eligibilitySM]);
    assert.strictEqual(emitters['intake.application.submitted'], undefined);
    assert.ok(subscribers['intake.application.submitted']);
  });

  await t.test('handles empty state machines', () => {
    const { emitters, subscribers } = buildEventIndex([]);
    assert.deepStrictEqual(emitters, {});
    assert.deepStrictEqual(subscribers, {});
  });

  await t.test('multiple subscribers for same event', () => {
    const workflowSM = {
      domain: 'workflow',
      machines: [{
        object: 'Task',
        actions: [],
        events: [{ type: 'intake.application.submitted' }],
      }],
    };
    const { subscribers } = buildEventIndex([eligibilitySM, workflowSM]);
    assert.strictEqual(subscribers['intake.application.submitted'].length, 2);
  });
});
