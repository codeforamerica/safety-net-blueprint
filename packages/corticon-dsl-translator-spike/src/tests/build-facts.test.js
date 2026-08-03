import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../corticon/project.js';
import { buildDependencyGraph } from '../graph/build-graph.js';
import { classifyProject } from '../classify/classify-all.js';
import { buildFacts, chainEntries } from '../translate/build-facts.js';
import { parseExpression } from '../corticon/expression-parser.js';

function compile(fixtureDir) {
  const project = loadProject(fixtureDir);
  const graph = buildDependencyGraph(project);
  const classification = classifyProject(project, graph);
  return buildFacts(project, graph, classification, { parseExpression });
}

test('Mortgage: null-check-masking compiles to a Writable Placeholder Fact, not a Derived expression, for all four real late-day-sum attributes', () => {
  // Fact path uses the canonical entity name ("loanApplication"), not the raw
  // rulesheet-local alias ("loanapp") the Corticon text itself uses -- confirmed
  // necessary, not cosmetic: see buildAliasMap/resolveAliases in build-facts.js
  // for the real cross-reference bug this fixes.
  const { facts } = compile('fixtures/mortgage');
  for (const attr of ['late30DaysSum', 'late60DaysSum', 'late90DaysSum', 'late120DaysSum']) {
    const fact = facts.find((f) => f.path === `/loanApplication/${attr}`);
    assert.deepEqual(fact, { path: `/loanApplication/${attr}`, writable: true, placeholder: '0' });
  }
});


test('Mortgage: a path whose only real writer is an unreachable rulesheet gets no Fact, but a path-specific crosswalk entry explains why', () => {
  // Confirmed real, not theoretical: LoanApplication.creditReqtMet is written only
  // by Select_Credit.ers, which is unreachable within this vendored fixture
  // (AllPrograms.erf invokes a "Rules/Select.erf" ruleflow that was never
  // vendored). An earlier version of this file silently `continue`d here with no
  // reporting at all when every real writer of a path got excluded -- unlike the
  // genuine-cycle/unclassified-cycle cases in the same loop, which each report
  // their own path-level crosswalk entry before skipping.
  const { facts, crosswalk } = compile('fixtures/mortgage');
  assert.equal(facts.find((f) => f.path === '/loanApplication/creditReqtMet'), undefined);
  const entry = crosswalk.find((c) => c.path === 'LoanApplication.creditReqtMet' && c.kind === 'no-ordinary-writer');
  assert.ok(entry, 'expected a no-ordinary-writer crosswalk entry explaining the missing Fact');
  assert.match(entry.note, /Select_Credit\.ers/);
});

test('all-patterns: a genuine cycle is skipped entirely, flagged as a crosswalk annotation for manual redesign', () => {
  const { facts, crosswalk } = compile('fixtures/all-patterns');
  assert.equal(facts.some((f) => f.path === '/household/estimatedBenefit'), false);
  const entry = crosswalk.find((c) => c.path === 'Household.estimatedBenefit');
  assert.equal(entry.kind, 'genuine-cycle');
});

test('all-patterns: entity-creation writes are excluded from Fact compilation, flagged as an orchestration-layer crosswalk annotation reported directly from classification (not derived from graph.writes)', () => {
  const { facts, crosswalk } = compile('fixtures/all-patterns');
  assert.equal(facts.some((f) => f.path === '/household/primaryHouseholdKey'), false);
  const entry = crosswalk.find((c) => c.kind === 'entity-creation' && c.rulesheet === 'CreateHouseholds.ers' && c.entityType === 'Household');
  assert.ok(entry, 'expected an entity-creation crosswalk entry for CreateHouseholds.ers, reported directly from classification.entityCreation');
});

test('all-patterns: an unconditional row that is NOT last in document order still folds in every later conditioned row, not silently discarding them', () => {
  // Real, confirmed bug found via a user question about what "Case 0 with no
  // condition" even means: ProgramAEligibility.ers has its unconditional row
  // FIRST (Rule 0: sets isProgramAEligible = false) and a conditioned row SECOND
  // (Rule 1: isEligible = true -> isProgramAEligible = true). An earlier version
  // of chainEntries iterated backward and treated whichever row it hit with
  // guard === null as an immediate override, discarding every entry already
  // built for later document-order rows -- the compiled Fact was a bare "false",
  // with no reference to isEligible anywhere, and nothing said so.
  const { facts, crosswalk } = compile('fixtures/all-patterns');
  const fact = facts.find((f) => f.path === '/applicant/isProgramAEligible');
  assert.equal(fact.derived, '(applicant.isEligible == true) ? true : false');
  const entry = crosswalk.find((c) => c.kind === 'unconditional-row-out-of-order' && c.rulesheet === 'ProgramAEligibility.ers');
  assert.ok(entry, 'expected an unconditional-row-out-of-order crosswalk entry flagging this shape for manual review');
});

test('chainEntries: an unconditional entry folds in as the fallback regardless of its position, not just when last', () => {
  const outOfOrder = chainEntries([
    { guard: null, value: 'false' },
    { guard: 'a == 1', value: 'true' },
  ]);
  assert.equal(outOfOrder.cel, 'a == 1 ? true : false');
  assert.equal(outOfOrder.hasFallback, true);
});

test('chainEntries: more than one unconditional entry for the same path throws rather than silently picking one', () => {
  assert.throws(() => {
    chainEntries([
      { guard: null, value: 'a' },
      { guard: null, value: 'b' },
    ]);
  }, /2 unconditional entries/);
});

test('all-patterns: null-check-masking (Applicant.reportedAssets) compiles to a Writable Placeholder Fact', () => {
  const { facts } = compile('fixtures/all-patterns');
  const fact = facts.find((f) => f.path === '/applicant/reportedAssets');
  assert.deepEqual(fact, { path: '/applicant/reportedAssets', writable: true, placeholder: '0' });
});

test('all-patterns: an ordinary unconditional single-rule Fact compiles to a bare value, no ternary', () => {
  const { facts } = compile('fixtures/all-patterns');
  assert.equal(facts.find((f) => f.path === '/applicant/reviewTrack').derived, "'Expedited'");
  assert.equal(facts.find((f) => f.path === '/applicant/needsAccommodationReview').derived, 'true');
});

test('all-patterns: date arithmetic, currency rounding, and the field-sum aggregate all compile against real proposed custom CEL functions', () => {
  const { facts } = compile('fixtures/all-patterns');
  assert.equal(facts.find((f) => f.path === '/applicant/age').derived, 'yearsBetween(applicant.dob, today)');
  assert.equal(facts.find((f) => f.path === '/household/totalIncome').derived, "sum(applicant, 'income')");
  assert.equal(facts.find((f) => f.path === '/household/incomeRounded').derived, 'round(household.totalIncome, 2)');
  assert.equal(facts.find((f) => f.path === '/applicant/bestProgram').derived, "nthByKey(program, 'priority', 1).name");
});

test('all-patterns: a rulesheet-level filter is folded into every Fact that rulesheet compiles, not just reported informationally', () => {
  const { facts, crosswalk } = compile('fixtures/all-patterns');
  // AdultCount.ers's real filter (adult.age >= 18) gates its own otherwise-unconditional row.
  // Compiled CEL uses the canonical entity alias ("applicant"), not AdultCount.ers's
  // own rulesheet-local filtered-collection alias ("adult") -- confirmed necessary:
  // see buildAliasMap/resolveAliases in build-facts.js for the real cross-reference
  // bug this fixes (a bare "adult.age" wouldn't match any real Fact path at all).
  assert.equal(facts.find((f) => f.path === '/household/adultCount').derived, '(applicant.age >= 18) ? size(applicant) : unresolved()');
  const filterEntry = crosswalk.find((c) => c.kind === 'filter' && c.rulesheet === 'AdultCount.ers');
  assert.equal(filterEntry.expression, 'adult.age >= 18');
});

test('all-patterns: decision-table combinatorics within one rulesheet compile to a first-match-wins chain, flagged with the real hit-policy caveat', () => {
  const { facts, crosswalk } = compile('fixtures/all-patterns');
  const incomeTier = facts.find((f) => f.path === '/household/incomeTier');
  assert.equal(
    incomeTier.derived,
    "(household.totalIncome < 20000) && (household.adultCount >= 2) ? 'Tier1' : (household.totalIncome < 20000) && (household.adultCount < 2) ? 'Tier2' : (household.totalIncome >= 20000) ? 'Tier3' : unresolved()"
  );
  const hitPolicyEntry = crosswalk.find((c) => c.kind === 'hit-policy-unverified' && c.rulesheet === 'IncomeTier.ers');
  assert.deepEqual(hitPolicyEntry.ruleIndices, [1, 2, 3], 'shifted by 1 vs. Corticon\'s own rule count: index 0 is the reserved blank/template row, now kept rather than filtered');
});

test('all-patterns: no unconditional row anywhere in the chain surfaces a no-fallback-row crosswalog entry and calls the proposed unresolved() sentinel', () => {
  const { crosswalk } = compile('fixtures/all-patterns');
  for (const path of ['Household.incomeTier', 'Applicant.isEligible', 'Applicant.isProgramBEligible', 'Household.adultCount']) {
    assert.ok(crosswalk.some((c) => c.path === path && c.kind === 'no-fallback-row'), `expected a no-fallback-row entry for ${path}`);
  }
});

test('all-patterns: cross-rulesheet assembly (Applicant.isEligible, across EligibilityPartA.ers and EligibilityPartB.ers) compiles as one chained expression', () => {
  const { facts } = compile('fixtures/all-patterns');
  const isEligible = facts.find((f) => f.path === '/applicant/isEligible');
  // Both rulesheets' rows are present in the compiled chain -- not just one of them.
  assert.match(isEligible.derived, /incomeTier == 'Tier1'/);
  assert.match(isEligible.derived, /incomeTier == 'Tier2'/);
  assert.match(isEligible.derived, /incomeTier == 'Tier3'/);
  assert.match(isEligible.derived, /unresolved\(\)$/);
});

test('all-patterns: a real service call-out is flagged as an orchestration-layer crosswalk annotation, not a Fact', () => {
  const { crosswalk } = compile('fixtures/all-patterns');
  const entry = crosswalk.find((c) => c.kind === 'service-callout');
  assert.equal(entry.node, 'VerifyIncome');
  assert.deepEqual(entry.connector, { className: 'VerifyIncomeServiceCallout.js', serviceName: 'verifyIncome' });
});

test('DC Medicaid/CHIP: Person.MedicaidEligible assembles all three real rulesheets (Flatten, Parse Cohorts, Citizenship requirements) in real ruleflow invocation order, with Parse Cohorts\' real filter folded in', () => {
  const { facts } = compile('fixtures/dc-medicaid-chip');
  const medicaidEligible = facts.find((f) => f.path === '/person/MedicaidEligible');
  assert.ok(medicaidEligible, 'expected a compiled Person.MedicaidEligible Fact');
  // Flatten.ers is invoked last (highest priority) -- its own 2 rows appear first.
  assert.match(medicaidEligible.derived, /^\(person\.outputCoverage1 == null\)/);
  // Parse Cohorts.ers's real filter (cohorts->notEmpty) is folded into its own
  // otherwise-unconditional row, not silently dropped. Uses the canonical entity
  // alias ("cohort"), not Parse Cohorts.ers's own rulesheet-local collection alias
  // ("cohorts") -- see buildAliasMap/resolveAliases in build-facts.js.
  assert.match(medicaidEligible.derived, /\(size\(cohort\) != 0\) \? true/);
  // Citizenship requirements.ers (invoked first, lowest priority) still appears as
  // the final fallback -- not silently discarded once a higher-priority rulesheet's
  // own chain was compiled, which was the real bug this design fixed.
  assert.match(medicaidEligible.derived, /citizenship/);
  assert.match(medicaidEligible.derived, /unresolved\(\)$/);
});

test('DC Medicaid/CHIP: a rule guarded by a real range-membership condition (Person.age in ( 18 .. 26 )) is correctly entity-creation-excluded, not silently mistranslated into a Fact', () => {
  // MAGI Eligibility Groups.ers's real "Former Foster Care Youth" cohort rule uses
  // this exact condition -- but its action is `Person.cohort += Cohort.newUnique[...]`,
  // real entity creation. This test exists to confirm that exclusion still happens
  // correctly even when the excluded rule's OWN guard uses a construct (range
  // membership) this translator only added support for recently -- see
  // corticon-expression-parser.test.js/to-cel.test.js for the actual range-membership
  // parsing/codegen unit tests.
  const { crosswalk } = compile('fixtures/dc-medicaid-chip');
  assert.ok(crosswalk.some((c) => c.kind === 'entity-creation' && c.rulesheet.includes('MAGI Eligibility Groups')));
});

test('DC Medicaid/CHIP: a condition with its own internal "or" is parenthesized as one unit before being AND-ed with the next condition, not flattened into a bare && chain', () => {
  // Real, confirmed bug found via a user question about the rendered diagram, not
  // hypothetical: Income Requirements.ers's real Person.isCHIPEligible rule ANDs
  // "Person.isInmate = F or Person.isInmate = null" against three other separate
  // conditions. An earlier version of compileGuard joined each condition's own CEL
  // with a bare " && ", producing "isInmate == false || isInmate == null &&
  // age < 19 && ..." -- which CEL parses as "isInmate == false || (isInmate == null
  // && age < 19 && ...)" (&& binds tighter than ||), NOT the
  // "(isInmate == false || isInmate == null) && age < 19 && ..." Corticon's own
  // AND-across-columns semantics actually require. Every condition (and filter) is
  // now individually parenthesized before joining, regardless of what operator is
  // at that condition's own top level.
  const { facts } = compile('fixtures/dc-medicaid-chip');
  const isChipEligible = facts.find((f) => f.path === '/person/isCHIPEligible');
  assert.match(isChipEligible.derived, /\(person\.isInmate == false \|\| person\.isInmate == null\) && \(person\.age < 19\)/);
});

test('DC Medicaid/CHIP: the confirmed-dead Non-MAGI Eligibility Groups.ers is excluded from Fact compilation entirely and reported directly, even though it writes the same path a real reachable rulesheet does', () => {
  const { crosswalk } = compile('fixtures/dc-medicaid-chip');
  // Confirmed real: Non-MAGI Eligibility Groups.ers (never invoked by any real
  // Ruleflow) also writes Person.outputCoverage1, the same path Flatten.ers (real,
  // reachable) writes -- an earlier version of this file didn't exclude unreachable
  // rulesheets from cross-rulesheet assembly/decision-table compilation at all, so
  // this dead rulesheet's logic was silently eligible to be compiled in as if live.
  const entry = crosswalk.find((c) => c.kind === 'unreachable-rulesheet');
  assert.ok(entry, 'expected a direct unreachable-rulesheet crosswalk entry');
  assert.match(entry.rulesheet, /Non-MAGI Eligibility Groups\.ers$/);
});

test('DC Medicaid/CHIP: every real expression pattern found in Phase 3 classification is reported in the crosswalk, not just implicit in the compiled CEL', () => {
  const { crosswalk } = compile('fixtures/dc-medicaid-chip');
  const entries = crosswalk.filter((c) => c.kind === 'expression-pattern');
  assert.ok(entries.length > 0, 'expected at least one expression-pattern crosswalk entry');
  assert.ok(entries.some((e) => e.patternKind === 'date-arithmetic'));
  assert.ok(entries.some((e) => e.patternKind === 'currency-rounding'));
  assert.ok(entries.some((e) => e.patternKind === 'sorting'));
});

test('a rulesheet invoked from multiple disagreeing contexts (synthetic -- not observed in any real fixture) is reported directly as a crosswalk entry, not silently resolved', () => {
  // Mirrors the synthetic project in ruleflow-context.test.js's own "disagreeing
  // contexts" test -- exercising this defensive path since no real project does.
  const project = {
    ruleflows: new Map([
      [
        'main.erf',
        {
          nodes: [
            { kind: 'ActivityNode', name: 'Plain', iterative: false, invokes: 'Shared.ers#//@ruleset' },
            { kind: 'ActivityNode', name: 'Loop', iterative: true, invokes: 'Shared.ers#//@ruleset' },
          ],
        },
      ],
    ]),
    rulesheets: new Map([['Shared.ers', { rules: [], filters: [] }]]),
  };
  const graph = { nodes: new Set(), edges: [], writes: new Map() };
  const classification = {
    ruleflowContext: { roots: ['main.erf'], unreachableRulesheets: [], multiInvokedRulesheets: [{ rulesheet: 'Shared.ers', contexts: [] }] },
    selfLoops: [],
    multiHopCycles: [],
    crossRulesheetAssembly: [],
    decisionTableCombinatorics: [],
    entityCreation: [],
    serviceCallouts: [],
    filters: [],
    expressionPatterns: [],
  };
  const { crosswalk } = buildFacts(project, graph, classification, { parseExpression });
  const entry = crosswalk.find((c) => c.kind === 'multi-invoked-disagreeing-context');
  assert.equal(entry.rulesheet, 'Shared.ers');
});
