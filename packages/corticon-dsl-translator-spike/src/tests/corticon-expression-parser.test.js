import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../sources/corticon/corticon/expression-parser.js';

const Identifier = (name) => ({ type: 'Identifier', name });
const Member = (object, property, navigation = 'dot') => ({ type: 'Member', object, property, navigation });
const Call = (object, property, args, navigation = 'dot') => ({ type: 'Call', object, property, navigation, args });
const Literal = (kind, value) => ({ type: 'Literal', kind, value });
const BinaryOp = (operator, left, right) => ({ type: 'BinaryOp', operator, left, right });
const UnaryOp = (operator, operand) => ({ type: 'UnaryOp', operator, operand });

test('parses a real comparison against a collection size -- Mortgage\'s "liability->size >= 3"', () => {
  assert.deepEqual(
    parseExpression('liability->size >= 3'),
    BinaryOp('>=', Member(Identifier('liability'), 'size', 'arrow'), Literal('number', 3))
  );
});

test('parses a real boolean-literal comparison over a parenthesized ->exists call -- Mortgage\'s real condition text', () => {
  assert.deepEqual(
    parseExpression('( liability->exists ( liability.highCreditAmount >= 2500.0 ) ) = true'),
    BinaryOp(
      '=',
      Call(Identifier('liability'), 'exists', [BinaryOp('>=', Member(Identifier('liability'), 'highCreditAmount'), Literal('number', 2500))], 'arrow'),
      Literal('boolean', true)
    )
  );
});

test('parses a real Corticon boolean-shorthand assignment -- Mortgage\'s "loanapp.creditReqtMet = T"', () => {
  assert.deepEqual(
    parseExpression('loanapp.creditReqtMet = T'),
    BinaryOp('=', Member(Identifier('loanapp'), 'creditReqtMet'), Literal('boolean', true))
  );
});

test('parses a real null-check -- Mortgage\'s "loanapp.late30DaysSum = null", the exact real null-check-masking pattern', () => {
  assert.deepEqual(
    parseExpression('loanapp.late30DaysSum = null'),
    BinaryOp('=', Member(Identifier('loanapp'), 'late30DaysSum'), Literal('null', null))
  );
});

test('parses real parenthesized arithmetic -- DC Medicaid\'s "Household.fpl110 = ( Household.fpl * 1.1 )"', () => {
  assert.deepEqual(
    parseExpression('Household.fpl110 = ( Household.fpl * 1.1 )'),
    BinaryOp('=', Member(Identifier('Household'), 'fpl110'), BinaryOp('*', Member(Identifier('Household'), 'fpl'), Literal('number', 1.1)))
  );
});

test('parses a real date-arithmetic method call -- DC Medicaid\'s "Person.age = Person.dob.yearsBetween ( today )"', () => {
  assert.deepEqual(
    parseExpression('Person.age = Person.dob.yearsBetween ( today )'),
    BinaryOp('=', Member(Identifier('Person'), 'age'), Call(Member(Identifier('Person'), 'dob'), 'yearsBetween', [Identifier('today')]))
  );
});

test('parses a real negative-literal method argument -- Mortgage\'s "liability.lastActivityDate > today.addYears ( -2 )"', () => {
  assert.deepEqual(
    parseExpression('liability.lastActivityDate > today.addYears ( -2 )'),
    BinaryOp('>', Member(Identifier('liability'), 'lastActivityDate'), Call(Identifier('today'), 'addYears', [UnaryOp('-', Literal('number', 2))]))
  );
});

test('parses real currency rounding on a compound expression -- DC Medicaid\'s own confirmed real .round(2) gap case', () => {
  assert.deepEqual(
    parseExpression('Household.ActualPercentFPL = ( ( Household.magi / Household.fpl ) * 100 ).round ( 2 )'),
    BinaryOp(
      '=',
      Member(Identifier('Household'), 'ActualPercentFPL'),
      Call(BinaryOp('*', BinaryOp('/', Member(Identifier('Household'), 'magi'), Member(Identifier('Household'), 'fpl')), Literal('number', 100)), 'round', [
        Literal('number', 2),
      ])
    )
  );
});

test('parses real currency rounding on a bare attribute -- this fixture\'s own "Household.incomeRounded = Household.totalIncome.round ( 2 )"', () => {
  assert.deepEqual(
    parseExpression('Household.incomeRounded = Household.totalIncome.round ( 2 )'),
    BinaryOp('=', Member(Identifier('Household'), 'incomeRounded'), Call(Member(Identifier('Household'), 'totalIncome'), 'round', [Literal('number', 2)]))
  );
});

test('parses a real sortedBy->first chain -- DC Medicaid\'s "Person.MedicaidEligibilityGroup1 = cohorts->sortedBy ( cohorts.type )->first.type"', () => {
  assert.deepEqual(
    parseExpression('Person.MedicaidEligibilityGroup1 = cohorts->sortedBy ( cohorts.type )->first.type'),
    BinaryOp(
      '=',
      Member(Identifier('Person'), 'MedicaidEligibilityGroup1'),
      Member(Member(Call(Identifier('cohorts'), 'sortedBy', [Member(Identifier('cohorts'), 'type')], 'arrow'), 'first', 'arrow'), 'type')
    )
  );
});

test('parses this fixture\'s own real sortedBy->first chain -- "Applicant.bestProgram = program->sortedBy ( program.priority )->first.name"', () => {
  assert.deepEqual(
    parseExpression('Applicant.bestProgram = program->sortedBy ( program.priority )->first.name'),
    BinaryOp(
      '=',
      Member(Identifier('Applicant'), 'bestProgram'),
      Member(Member(Call(Identifier('program'), 'sortedBy', [Member(Identifier('program'), 'priority')], 'arrow'), 'first', 'arrow'), 'name')
    )
  );
});

test('parses a real compound-assignment association mutation with no NEW term at all -- "members += Person"', () => {
  assert.deepEqual(parseExpression('members += Person'), { type: 'Assignment', operator: '+=', target: Identifier('members'), value: Identifier('Person') });
});

test('parses a real bracket-construction entity-creation call -- DC Medicaid\'s "Household.newUnique [ Household.PrimaryInsuredId = Person.primaryInsuredId ]"', () => {
  assert.deepEqual(parseExpression('Household.newUnique [ Household.PrimaryInsuredId = Person.primaryInsuredId ]'), {
    type: 'Construction',
    entity: Member(Identifier('Household'), 'newUnique'),
    fields: [{ name: 'PrimaryInsuredId', value: Member(Identifier('Person'), 'primaryInsuredId') }],
  });
});

test('parses a real multi-field construction combined with a compound assignment and string concatenation -- DC Medicaid\'s Cohort.newUnique[...] cohort-matching pattern', () => {
  const text =
    "Person.cohort += Cohort.newUnique [ Cohort.type = 'Medicaid for Breast and Cervical Cancer Patients' , Cohort.output = Person.fullName + ' is eligible for coverage through the eligibility cohort ' + 'Medicaid for Breast and Cervical Cancer Patients' + '.' ]";
  assert.deepEqual(parseExpression(text), {
    type: 'Assignment',
    operator: '+=',
    target: Member(Identifier('Person'), 'cohort'),
    value: {
      type: 'Construction',
      entity: Member(Identifier('Cohort'), 'newUnique'),
      fields: [
        { name: 'type', value: Literal('string', 'Medicaid for Breast and Cervical Cancer Patients') },
        {
          name: 'output',
          value: BinaryOp(
            '+',
            BinaryOp('+', BinaryOp('+', Member(Identifier('Person'), 'fullName'), Literal('string', ' is eligible for coverage through the eligibility cohort ')), Literal(
              'string',
              'Medicaid for Breast and Cervical Cancer Patients'
            )),
            Literal('string', '.')
          ),
        },
      ],
    },
  });
});

test('parses a real escaped single-quote inside a string literal -- confirmed real in MAGI Eligibility Groups.ers ruleStatement/output text', () => {
  assert.deepEqual(parseExpression("Person.fullName + '\\'s household income is '"), BinaryOp('+', Member(Identifier('Person'), 'fullName'), Literal('string', "'s household income is ")));
});

test('throws a clear error on an unsupported character rather than silently mistranslating', () => {
  assert.throws(() => parseExpression('Household.fpl @ 3'), /Unsupported character/);
});

test('throws a clear error on an incomplete expression rather than silently mistranslating', () => {
  assert.throws(() => parseExpression('Household.fpl >='), /Unexpected end of expression/);
});

test('throws on empty/non-string input rather than silently producing a nonsense AST', () => {
  assert.throws(() => parseExpression(''), /non-empty Corticon expression text/);
  assert.throws(() => parseExpression(undefined), /non-empty Corticon expression text/);
});

const RangeMembership = (value, lower, lowerInclusive, upper, upperInclusive) => ({ type: 'RangeMembership', value, lower, lowerInclusive, upper, upperInclusive });

test('parses a real fully-exclusive range-membership condition -- DC Medicaid\'s "Person.age in ( 18 .. 26 )"', () => {
  assert.deepEqual(
    parseExpression('Person.age in ( 18 .. 26 )'),
    RangeMembership(Member(Identifier('Person'), 'age'), Literal('number', 18), false, Literal('number', 26), false)
  );
});

test('parses a real half-open range-membership condition (lower exclusive, upper inclusive) -- DC Medicaid\'s "Person.HouseholdActualPercentFPL in ( 220 .. 250 ]"', () => {
  assert.deepEqual(
    parseExpression('Person.HouseholdActualPercentFPL in ( 220 .. 250 ]'),
    RangeMembership(Member(Identifier('Person'), 'HouseholdActualPercentFPL'), Literal('number', 220), false, Literal('number', 250), true)
  );
});

test('parses a real fully-inclusive range-membership condition with no bracket characters at all -- DC Medicaid\'s "Person.age in 21 .. 64"', () => {
  // Confirmed real: the raw `expression` attribute is "[21..64]" (both inclusive),
  // but Corticon's own parsed `text` field drops the bracket characters entirely for
  // this case -- an omitted bracket means inclusive, not "no bound applies here."
  assert.deepEqual(
    parseExpression('Person.age in 21 .. 64'),
    RangeMembership(Member(Identifier('Person'), 'age'), Literal('number', 21), true, Literal('number', 64), true)
  );
});

test('the number tokenizer does not mis-parse ".." as a decimal point, even with no surrounding whitespace', () => {
  // Confirmed real range text always has spaces around '..', but the tokenizer fix
  // for this is a defensive one -- test the no-whitespace case directly since no
  // real fixture happens to exercise it.
  assert.deepEqual(
    parseExpression('Person.age in 5..10'),
    RangeMembership(Member(Identifier('Person'), 'age'), Literal('number', 5), true, Literal('number', 10), true)
  );
});

test('parses "**" (exponentiation) at the same precedence tier as "*"/"/", left-associative, per Corticon\'s own documented precedence table -- not yet observed in a real fixture', () => {
  // "2 * 3 ** 2" parses as "(2 * 3) ** 2", NOT "2 * (3 ** 2)" -- Corticon's own
  // documentation puts ** at the SAME tier as */, evaluated left to right, unlike
  // most general-purpose languages' convention of giving ** higher precedence.
  assert.deepEqual(
    parseExpression('2 * 3 ** 2'),
    BinaryOp('**', BinaryOp('*', Literal('number', 2), Literal('number', 3)), Literal('number', 2))
  );
});

test('parses "<>" as Corticon\'s real documented not-equal spelling, normalizing it to the same AST operator as "!="', () => {
  assert.deepEqual(parseExpression('Person.age <> 21'), BinaryOp('!=', Member(Identifier('Person'), 'age'), Literal('number', 21)));
});

test('parses "and"/"or" as real documented logical operators, lowest precedence -- not yet observed in a real fixture', () => {
  assert.deepEqual(
    parseExpression('Person.age >= 18 and Person.age <= 64 or Person.isExempt = true'),
    BinaryOp(
      'or',
      BinaryOp('and', BinaryOp('>=', Member(Identifier('Person'), 'age'), Literal('number', 18)), BinaryOp('<=', Member(Identifier('Person'), 'age'), Literal('number', 64))),
      BinaryOp('=', Member(Identifier('Person'), 'isExempt'), Literal('boolean', true))
    )
  );
});

test('parses "not" as a real documented unary operator -- not yet observed in a real fixture', () => {
  assert.deepEqual(parseExpression('not Person.isExempt'), UnaryOp('not', Member(Identifier('Person'), 'isExempt')));
});
