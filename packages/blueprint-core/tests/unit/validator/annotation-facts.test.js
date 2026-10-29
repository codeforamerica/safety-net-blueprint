/**
 * Annotation keys in `facts:` are checked against the facts each ruleset
 * declares, read from its rules document.
 *
 * They used to be checked only against compiled graphs in the set, and
 * resolve validates before any graph is compiled, so a key naming no fact
 * passed resolve and failed later, in `validate --resolved`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';

import { discover, load, validate } from '../../../src/index.js';

function withSet(files, check) {
  const dir = mkdtempSync(join(tmpdir(), 'core-annotation-facts-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const full = join(dir, relativePath);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, yaml.dump(content));
    }
    check(discover(dir).map(load));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rules = {
  $schema: 'rules-schema.yaml',
  domain: 'eligibility',
  rulesets: {
    hours: {
      endpoint: { path: '/hours' },
      inputs: { person: { type: 'object', properties: { hoursWorked: { type: 'number' } } } },
      outputs: { meetsHours: {} },
      facts: [{ path: 'meetsHours', expression: 'person.hoursWorked >= 80.0' }],
    },
  },
};
const annotations = (facts) => ({ $schema: 'annotations-schema.yaml', version: '1.0', domain: 'eligibility', facts });
const factKeyErrors = (docs) => validate(docs).results
  .flatMap((result) => result.errors.filter((e) => e.rule === 'unknown-annotation-facts-key'));

describe('annotation fact keys, in a set with rules but no compiled graphs', () => {
  test('a key naming a fact the ruleset declares passes', () => {
    withSet({
      'domains/eligibility/eligibility-rules.yaml': rules,
      'domains/eligibility/eligibility-annotations.yaml': annotations({ 'hours.meetsHours': { reason: 'Why.' } }),
    }, (docs) => assert.deepEqual(factKeyErrors(docs), []));
  });

  test('a key naming no fact is reported', () => {
    withSet({
      'domains/eligibility/eligibility-rules.yaml': rules,
      'domains/eligibility/eligibility-annotations.yaml': annotations({ 'hours.meetsHourz': { reason: 'Why.' } }),
    }, (docs) => {
      const [error] = factKeyErrors(docs);
      assert.match(error?.message ?? '', /meetsHourz/);
    });
  });

  test('a key naming no ruleset is reported', () => {
    withSet({
      'domains/eligibility/eligibility-rules.yaml': rules,
      'domains/eligibility/eligibility-annotations.yaml': annotations({ 'nope.meetsHours': { reason: 'Why.' } }),
    }, (docs) => assert.equal(factKeyErrors(docs).length, 1));
  });
});
