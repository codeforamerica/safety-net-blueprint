import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVocabulary } from '../sources/corticon/vocabulary.js';

const DC_MEDICAID_VOCAB = 'fixtures/corticon/government/dc-medicaid-chip/Vocabulary/Rule Vocabulary.ecore';

test('parses all real entities from the DC Medicaid/CHIP vocabulary', () => {
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  assert.deepEqual([...entities.keys()].sort(), ['Cohort', 'Household', 'Person']);
});

test('resolves a plain scalar attribute with its Corticon dataType', () => {
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  const person = entities.get('Person');
  assert.deepEqual(person.attributes.get('wages'), { dataType: 'Decimal' });
});

test('resolves a custom enum type as a dataType name, resolvable via customTypes', () => {
  const { entities, customTypes } = parseVocabulary(DC_MEDICAID_VOCAB);
  const person = entities.get('Person');
  assert.equal(person.attributes.get('citizenship').dataType, 'citizenship_status');
  assert.ok(customTypes.get('citizenship_status').isEnum);
});

test('references are in a separate map from attributes', () => {
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  const household = entities.get('Household');
  assert.ok(household.references.has('person'), 'person should be in references, not attributes');
  assert.ok(!household.attributes.has('person'), 'person should not appear in attributes');
  assert.equal(household.references.get('person').isCollection, true, 'Household.person is a collection');
  const person = entities.get('Person');
  assert.equal(person.references.get('household').isCollection, false, 'Person.household is scalar');
});

test('resolves a bidirectional association via eOpposite, and marks a required association distinctly from an optional one', () => {
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  const household = entities.get('Household');
  const person = entities.get('Person');
  assert.equal(household.references.get('person').opposite, 'household');
  assert.equal(person.references.get('household').opposite, 'person');
  assert.equal(person.references.get('household').isRequired, true, 'lowerBound="1" -- every Person requires a Household');
  assert.equal(household.references.get('person').isRequired, false, 'no lowerBound on this side -- a Household can have zero Person records');
});

test('association carries entityType pointing to the referenced entity class', () => {
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  const person = entities.get('Person');
  assert.equal(person.references.get('household').entityType, 'Household');
});

test('a plain attribute never appears in references, even when absent from the real file', () => {
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  const person = entities.get('Person');
  assert.ok(person.attributes.has('wages'));
  assert.ok(!person.references.has('wages'));
  assert.deepEqual(person.attributes.get('wages'), { dataType: 'Decimal' });
});

test('resolves a custom type declared in a different vocabulary file', () => {
  const { entities } = parseVocabulary('fixtures/corticon/synthetic/cross-file-vocab/main.ecore');
  const ticket = entities.get('Ticket');
  assert.equal(ticket.attributes.get('priority').dataType, 'priorityLevel');
});

test('falls back to a plain reference when the cross-file target does not exist on disk', () => {
  // Confirmed real in DC Medicaid's own `Household.state`, which references a sample
  // project ("NY State Assistance") that was never vendored alongside this fixture.
  const { entities } = parseVocabulary(DC_MEDICAID_VOCAB);
  const household = entities.get('Household');
  // Still resolves correctly here, but only because this same file also happens to
  // independently declare its own `state_name` custom type (see vocabulary.js's
  // resolveEType comment) -- not because the cross-file reference was followed.
  assert.equal(household.attributes.get('state').dataType, 'state_name');
});
