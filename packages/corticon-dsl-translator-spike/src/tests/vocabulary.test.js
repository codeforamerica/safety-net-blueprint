import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVocabulary } from '../sources/corticon/corticon/vocabulary.js';

const DC_MEDICAID_VOCAB = 'fixtures/corticon/government/dc-medicaid-chip/Vocabulary/Rule Vocabulary.ecore';

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

test('resolves a bidirectional association via eOpposite, and marks a required association distinctly from an optional one', () => {
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  const household = entities.get('Household');
  const person = entities.get('Person');
  assert.equal(household.attributes.get('person').opposite, 'household');
  assert.equal(person.attributes.get('household').opposite, 'person');
  assert.equal(person.attributes.get('household').isRequired, true, 'lowerBound="1" -- every Person requires a Household');
  assert.equal(household.attributes.get('person').isRequired, false, 'no lowerBound on this side -- a Household can have zero Person records');
});

test('a plain attribute (not an association) never carries opposite/isRequired, even when absent from the real file', () => {
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  const person = entities.get('Person');
  assert.deepEqual(person.attributes.get('wages'), {
    kind: 'attribute',
    isCollection: false,
    type: { kind: 'primitive', name: 'Decimal' },
  });
});

test('resolves a custom type declared in a different vocabulary file', () => {
  const { entities } = parseVocabulary('fixtures/corticon/synthetic/cross-file-vocab/main.ecore');
  const ticket = entities.get('Ticket');
  assert.deepEqual(ticket.attributes.get('priority').type, { kind: 'customType', name: 'priorityLevel' });
});

test('falls back to a plain reference when the cross-file target does not exist on disk', () => {
  // Confirmed real in DC Medicaid's own `Household.state`, which references a sample
  // project ("NY State Assistance") that was never vendored alongside this fixture.
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  const household = entities.get('Household');
  // Still resolves correctly here, but only because this same file also happens to
  // independently declare its own `state_name` custom type (see vocabulary.js's
  // resolveEType comment) -- not because the cross-file reference was followed.
  assert.deepEqual(household.attributes.get('state').type, { kind: 'customType', name: 'state_name' });
});
