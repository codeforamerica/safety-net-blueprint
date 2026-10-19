/**
 * Annotation keys in `facts:` and `constants:` are checked against the facts
 * and constants each ruleset declares, read from its rules document.
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
      constants: { hoursRequired: { value: 80 } },
      outputs: { meetsHours: {} },
      facts: [{ path: 'meetsHours', expression: 'person.hoursWorked >= constants.hoursRequired' }],
    },
  },
};
const annotations = (sections) => ({ $schema: 'annotations-schema.yaml', version: '1.0', domain: 'eligibility', ...sections });
const errorsOf = (docs, rule) => validate(docs).results.flatMap((result) => result.errors.filter((e) => e.rule === rule));
const factKeyErrors = (docs) => errorsOf(docs, 'unknown-annotation-facts-key');

describe('annotation fact keys, in a set with rules but no compiled graphs', () => {
  test('a key naming a fact the ruleset declares passes', () => {
    withSet({
      'domains/eligibility/eligibility-rules.yaml': rules,
      'domains/eligibility/eligibility-annotations.yaml': annotations({ facts: { 'hours.meetsHours': { reason: 'Why.' } } }),
    }, (docs) => assert.deepEqual(factKeyErrors(docs), []));
  });

  test('a key naming no fact is reported', () => {
    withSet({
      'domains/eligibility/eligibility-rules.yaml': rules,
      'domains/eligibility/eligibility-annotations.yaml': annotations({ facts: { 'hours.meetsHourz': { reason: 'Why.' } } }),
    }, (docs) => {
      const [error] = factKeyErrors(docs);
      assert.match(error?.message ?? '', /meetsHourz/);
    });
  });

  test('a key naming no ruleset is reported', () => {
    withSet({
      'domains/eligibility/eligibility-rules.yaml': rules,
      'domains/eligibility/eligibility-annotations.yaml': annotations({ facts: { 'nope.meetsHours': { reason: 'Why.' } } }),
    }, (docs) => assert.equal(factKeyErrors(docs).length, 1));
  });
});

describe('annotation constant keys', () => {
  test('a key naming a constant the ruleset declares passes', () => {
    withSet({
      'domains/eligibility/eligibility-rules.yaml': rules,
      'domains/eligibility/eligibility-annotations.yaml': annotations({ constants: { 'hours.hoursRequired': { reason: 'Why.' } } }),
    }, (docs) => assert.deepEqual(errorsOf(docs, 'unknown-annotation-constants-key'), []));
  });

  test('a key naming no constant is reported, naming it', () => {
    withSet({
      'domains/eligibility/eligibility-rules.yaml': rules,
      'domains/eligibility/eligibility-annotations.yaml': annotations({ constants: { 'hours.hoursRequird': { reason: 'Why.' } } }),
    }, (docs) => {
      const [error] = errorsOf(docs, 'unknown-annotation-constants-key');
      assert.match(error?.message ?? '', /Constant "hoursRequird" is not declared by ruleset "hours"/);
    });
  });

  test('a fact is not a constant', () => {
    withSet({
      'domains/eligibility/eligibility-rules.yaml': rules,
      'domains/eligibility/eligibility-annotations.yaml': annotations({ constants: { 'hours.meetsHours': { reason: 'Why.' } } }),
    }, (docs) => assert.equal(errorsOf(docs, 'unknown-annotation-constants-key').length, 1));
  });
});
