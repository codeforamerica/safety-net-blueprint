/**
 * Unit tests for the explorer's contract navigation helpers.
 *
 * Moved here with the code when blueprint-core collapsed to the pipeline
 * verbs — none of these is part of resolving or validating a contract set.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { buildEventIndex } from '../../src/contract-nav.js';
import { discover, load } from '@codeforamerica/blueprint-core';

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
