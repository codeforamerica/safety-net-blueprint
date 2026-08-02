import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVocabulary } from '../ingest/vocabulary.js';

const DC_MEDICAID_VOCAB = 'fixtures/dc-medicaid-chip/Vocabulary/Rule Vocabulary.ecore';

test('parses all real entities from the DC Medicaid/CHIP vocabulary', () => {
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  assert.deepEqual([...entities.keys()].sort(), ['Cohort', 'Household', 'Person']);
});

test('resolves a plain scalar attribute type', () => {
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  const person = entities.get('Person');
  assert.deepEqual(person.attributes.get('wages'), {
    kind: 'attribute',
    isCollection: false,
    type: { kind: 'primitive', name: 'Decimal' },
  });
});

test('resolves a custom enum type distinctly from a plain string', () => {
  const { entities, customTypes } = parseVocabulary(DC_MEDICAID_VOCAB);
  const person = entities.get('Person');
  assert.deepEqual(person.attributes.get('citizenship').type, { kind: 'customType', name: 'citizenship_status' });
  assert.ok(customTypes.get('citizenship_status').isEnum);
});

test('resolves a collection association distinctly from a scalar association', () => {
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  const household = entities.get('Household');
  assert.equal(household.attributes.get('person').kind, 'association');
  assert.equal(household.attributes.get('person').isCollection, true, 'Household.person is a collection');
  const person = entities.get('Person');
  assert.equal(person.attributes.get('household').isCollection, false, 'Person.household is scalar');
});
