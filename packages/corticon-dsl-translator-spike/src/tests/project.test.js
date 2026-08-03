import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sep } from 'node:path';
import { loadProject } from '../corticon/project.js';

test('loads a whole real project directory by recursively discovering files by extension', () => {
  const project = loadProject('fixtures/dc-medicaid-chip');
  assert.equal(project.vocabularies.size, 1);
  assert.equal(project.rulesheets.size, 12);
  assert.equal(project.ruleflows.size, 3);
  assert.equal(project.ruletests.size, 3);
});

test('does not hardcode any fixture-specific path -- works against any project directory given as an argument', () => {
  const irrProject = loadProject('fixtures/irr');
  assert.equal(irrProject.rulesheets.size, 3);
  assert.equal(irrProject.ruleflows.size, 2);

  const mortgageProject = loadProject('fixtures/mortgage');
  assert.equal(mortgageProject.rulesheets.size, 2);
});

test('loads the all-patterns fixture: a hand-authored project combining every classification pattern', () => {
  const project = loadProject('fixtures/all-patterns');
  assert.equal(project.vocabularies.size, 1);
  assert.equal(project.rulesheets.size, 15);
  assert.equal(project.ruleflows.size, 3, 'top-level-flow.erf, benefit-loop.erf, program-eligibility-loop.erf');
});

test('confirms both.ert is an empty, never-run testsheet, distinct from the real per-rulesheet Test.ert files', () => {
  const project = loadProject('fixtures/dc-medicaid-chip');
  const both = project.ruletests.get('both.ert');
  assert.ok(both.every((sheet) => sheet.trace.length === 0), 'both.ert has no captured trace data');

  const chipTest = project.ruletests.get(['CHIP rules', 'Test.ert'].join(sep));
  assert.ok(chipTest.some((sheet) => sheet.trace.length > 0), 'the real per-rulesheet Test.ert has captured trace data');
});
