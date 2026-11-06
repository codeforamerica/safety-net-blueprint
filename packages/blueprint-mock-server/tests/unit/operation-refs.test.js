/**
 * The mock finds an operation by what names it, as core does.
 *
 * An operationId is unique only within its document, so two APIs may declare
 * the same one. A step's call or a suggestion's proposed call by a bare id
 * finds an operation when one API has it; `$apis.<api>.<id>` finds it when
 * several do. An Arazzo step qualified by its source finds the operation in
 * that source's document, not wherever the id first appears.
 *
 * Against the harness contracts, with eligibility given an operation whose id
 * intake already has.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extract } from '@codeforamerica/blueprint-core';
import { apiSpecsFromDocs } from '../../src/spec-loader.js';
import { operationsOf } from '../../src/operation-calls.js';
import { operationIndex } from '../../src/arazzo.js';

const artifact = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));
const eligibility = artifact.docs.find((d) => d.relativePath === 'domains/eligibility/eligibility-openapi.yaml');
// intake declares getApplicationSummary at /applications/{applicationId}/summary.
eligibility.content.paths['/summary'] = { get: { operationId: 'getApplicationSummary', responses: { 200: { description: 'OK' } } } };
const docs = extract(artifact, 'docs');

describe('a call to an operation', () => {
  const operations = operationsOf(apiSpecsFromDocs(docs));

  test('by an id one API has finds it', () => {
    assert.equal(operations.get('submitApplication').path, '/intake/applications/{applicationId}/submit');
  });

  test('by an id two APIs have finds nothing, and says how to qualify it', () => {
    assert.equal(operations.get('getApplicationSummary'), undefined);
    assert.equal(operations.whyNot('getApplicationSummary'),
      'More than one API has the operationId "getApplicationSummary"; write $apis.eligibility.getApplicationSummary or $apis.intake.getApplicationSummary.');
  });

  test('qualified by its API finds that API\'s', () => {
    assert.equal(operations.get('$apis.intake.getApplicationSummary').path, '/intake/applications/{applicationId}/summary');
    assert.equal(operations.get('$apis.eligibility.getApplicationSummary').path, '/eligibility/summary');
  });

  test('by an id nothing has says so', () => {
    assert.equal(operations.whyNot('nope'), 'No operation in the contract set has the operationId "nope".');
  });
});

describe('an Arazzo step\'s operation', () => {
  const index = operationIndex(docs);

  test('qualified by its source is looked for in that source\'s document', () => {
    assert.equal(index.get('intake-openapi.yaml#getApplicationSummary').path, '/intake/applications/{applicationId}/summary');
    assert.equal(index.get('eligibility-openapi.yaml#getApplicationSummary').path, '/eligibility/summary');
  });

  test('by a bare id is found only when one API has it', () => {
    assert.equal(index.get('submitApplication').path, '/intake/applications/{applicationId}/submit');
    assert.equal(index.get('getApplicationSummary'), undefined);
  });
});
