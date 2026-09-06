import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../sources/corticon/expression-parser.js';
import { toCel, toCelStatement, factPathOf } from '../graph/to-cel.js';

test('translates a real collection-size comparison to CEL\'s native size() function -- Mortgage\'s "liability->size >= 3"', () => {
  assert.equal(toCel(parseExpression('liability->size >= 3')), 'size(liability) >= 3');
});

test('translates a real parenthesized ->exists call to CEL\'s native .exists() macro, reusing Corticon\'s own alias as the bound variable', () => {
  const cel = toCel(parseExpression('( liability->exists ( liability.highCreditAmount >= 2500.0 ) ) = true'));
  assert.equal(cel, 'liability.exists(liability, liability.highCreditAmount >= 2500) == true');
});

test('translates a real Corticon boolean-shorthand assignment, lowercasing the entity alias', () => {
  assert.deepEqual(toCelStatement(parseExpression('loanapp.creditReqtMet = T'), { isAssignment: true }), { targetPath: 'loanapp.creditReqtMet', cel: 'true' });
});

test('translates a real null-check condition (not an assignment) to CEL equality against null', () => {
  assert.deepEqual(toCelStatement(parseExpression('loanapp.late30DaysSum = null'), { isAssignment: false }), { cel: 'loanapp.late30DaysSum == null' });
});

test('translates Mortgage\'s real null-check-masking fallback assignment -- "loanapp.late30DaysSum = 0"', () => {
  assert.deepEqual(toCelStatement(parseExpression('loanapp.late30DaysSum = 0'), { isAssignment: true }), { targetPath: 'loanapp.late30DaysSum', cel: '0' });
});

test('translates real arithmetic, stripping the entity qualifier and keeping the real attribute casing as-is', () => {
  assert.deepEqual(toCelStatement(parseExpression('Household.fpl110 = ( Household.fpl * 1.1 )'), { isAssignment: true }), {
    targetPath: 'household.fpl110',
    cel: 'fpl * 1.1',
  });
});

test('translates DC Medicaid\'s real date-arithmetic method call to a proposed yearsBetween() custom CEL function', () => {
  assert.deepEqual(toCelStatement(parseExpression('Person.age = Person.dob.yearsBetween ( today )'), { isAssignment: true }), {
    targetPath: 'person.age',
    cel: 'yearsBetween(dob, today)',
  });
});

test('translates Mortgage\'s real filter-level addYears(-2) call to a proposed addYears() custom CEL function', () => {
  assert.equal(toCel(parseExpression('liability.lastActivityDate > today.addYears ( -2 )')), 'liability.lastActivityDate > addYears(today, -2)');
});

test('translates DC Medicaid\'s real compound-expression .round(2) -- the confirmed real no-term gap -- without needing parens CEL would already imply', () => {
  assert.deepEqual(toCelStatement(parseExpression('Household.ActualPercentFPL = ( ( Household.magi / Household.fpl ) * 100 ).round ( 2 )'), { isAssignment: true }), {
    targetPath: 'household.ActualPercentFPL',
    cel: 'round(magi / fpl * 100, 2)',
  });
});

test('translates this fixture\'s own real bare-attribute .round(2) call', () => {
  assert.deepEqual(toCelStatement(parseExpression('Household.incomeRounded = Household.totalIncome.round ( 2 )'), { isAssignment: true }), {
    targetPath: 'household.incomeRounded',
    cel: 'round(totalIncome, 2)',
  });
});

test('translates DC Medicaid\'s real sortedBy->first pattern (rank 1) to a proposed nthByKey() custom CEL function', () => {
  assert.deepEqual(toCelStatement(parseExpression('Person.MedicaidEligibilityGroup1 = cohorts->sortedBy ( cohorts.type )->first.type'), { isAssignment: true }), {
    targetPath: 'person.MedicaidEligibilityGroup1',
    cel: "nthByKey(cohorts, 'type', 1).type",
  });
});

test('translates DC Medicaid\'s real sortedBy->at(n) pattern (rank n) via the same nthByKey() function, not a separate mechanism', () => {
  assert.deepEqual(toCelStatement(parseExpression('Person.MedicaidEligibilityGroup2 = cohorts->sortedBy ( cohorts.type )->at ( 2 ).type'), { isAssignment: true }), {
    targetPath: 'person.MedicaidEligibilityGroup2',
    cel: "nthByKey(cohorts, 'type', 2).type",
  });
});

test('translates this fixture\'s own real sortedBy->first pattern -- "Applicant.bestProgram = program->sortedBy ( program.priority )->first.name"', () => {
  assert.deepEqual(toCelStatement(parseExpression('Applicant.bestProgram = program->sortedBy ( program.priority )->first.name'), { isAssignment: true }), {
    targetPath: 'applicant.bestProgram',
    cel: "nthByKey(program, 'priority', 1).name",
  });
});

test('translates a real string-concatenation chain, correctly re-escaping a real embedded apostrophe as CEL string syntax', () => {
  // Confirmed real (MAGI Eligibility Groups.ers): the source text has a
  // backslash-escaped apostrophe (Corticon's own escaping), which the parser
  // stores as a literal apostrophe character in the AST -- toCel must re-escape it
  // when rendering CEL's own string syntax, not pass it through raw.
  const cel = toCel(parseExpression("Person.fullName + '\\'s household income is '"));
  assert.equal(cel, "fullName + '\\'s household income is '");
});

test('translates a real fully-exclusive range-membership condition to native CEL comparisons -- DC Medicaid\'s "Person.age in ( 18 .. 26 )"', () => {
  assert.equal(toCel(parseExpression('Person.age in ( 18 .. 26 )')), 'age > 18 && age < 26');
});

test('translates a real half-open range-membership condition -- DC Medicaid\'s "Person.HouseholdActualPercentFPL in ( 220 .. 250 ]"', () => {
  assert.equal(toCel(parseExpression('Person.HouseholdActualPercentFPL in ( 220 .. 250 ]')), 'HouseholdActualPercentFPL > 220 && HouseholdActualPercentFPL <= 250');
});

test('translates a real fully-inclusive range-membership condition with no bracket characters -- DC Medicaid\'s "Person.age in 21 .. 64"', () => {
  assert.equal(toCel(parseExpression('Person.age in 21 .. 64')), 'age >= 21 && age <= 64');
});

test('translates "**" to a proposed pow() custom CEL function -- CEL has no native exponentiation operator at all', () => {
  assert.equal(toCel(parseExpression('2 ** 3')), 'pow(2, 3)');
});

test('translates "<>" the same as "!=" -- both normalize to the same AST operator', () => {
  assert.equal(toCel(parseExpression('Person.age <> 21')), 'age != 21');
});

test('translates "and"/"or" to CEL\'s native "&&"/"||"', () => {
  assert.equal(toCel(parseExpression('Person.age >= 18 and Person.age <= 64 or Person.isExempt = true')), 'age >= 18 && age <= 64 || isExempt == true');
});

test('translates "not" to CEL\'s native "!"', () => {
  assert.equal(toCel(parseExpression('not Person.isExempt')), '!isExempt');
});

test('factPathOf renders a real Member chain as a decision-rules DSL Fact path', () => {
  assert.equal(factPathOf({ type: 'Member', object: { type: 'Identifier', name: 'Household' }, property: 'fpl110', navigation: 'dot' }), 'household.fpl110');
});

test('toCel throws a clear error on a Construction node -- entity creation cannot become a Fact expression', () => {
  const constructionAst = parseExpression('Household.newUnique [ Household.PrimaryInsuredId = Person.primaryInsuredId ]');
  assert.throws(() => toCel(constructionAst), /cannot be translated to a CEL expression/);
});

test('toCelStatement surfaces the same Construction error rather than silently succeeding when the source cell is not an assignment', () => {
  const constructionAst = parseExpression('Household.newUnique [ Household.PrimaryInsuredId = Person.primaryInsuredId ]');
  assert.throws(() => toCelStatement(constructionAst, { isAssignment: false }), /cannot be translated to a CEL expression/);
});

test('toCel throws a clear error on an Assignment node passed directly -- callers must use toCelStatement', () => {
  const assignmentAst = parseExpression('members += Person');
  assert.throws(() => toCel(assignmentAst), /must be translated via toCelStatement/);
});

test('toCel throws a clear error on an unsupported method rather than silently mistranslating', () => {
  const bogus = { type: 'Call', object: { type: 'Identifier', name: 'x' }, property: 'bogusMethod', navigation: 'dot', args: [] };
  assert.throws(() => toCel(bogus), /Unsupported method ".bogusMethod\(\.\.\.\)"/);
});

test('toCel throws a clear error on an unsupported collection operation rather than silently mistranslating', () => {
  const bogus = { type: 'Member', object: { type: 'Identifier', name: 'x' }, property: 'bogusOp', navigation: 'arrow' };
  assert.throws(() => toCel(bogus), /Unsupported collection operation "->bogusOp"/);
});
