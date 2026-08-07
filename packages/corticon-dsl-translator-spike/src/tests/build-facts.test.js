import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../sources/corticon/corticon/project.js';
import { buildDependencyGraph } from '../graph/build-graph.js';
import { classifyProject } from '../sources/corticon/classify/classify-all.js';
import { buildFacts, chainEntries } from '../sources/corticon/translate/build-facts.js';
import { parseExpression } from '../sources/corticon/corticon/expression-parser.js';

function compile(fixtureDir) {
  const project = loadProject(fixtureDir);
  const graph = buildDependencyGraph(project);
  const classification = classifyProject(project);
  const { facts, translationLog } = buildFacts(project, graph, classification, { parseExpression });
  return { facts, translationLog };
}

test('Mortgage: null-check-masking compiles to an expression fact for all four real late-day-sum attributes', () => {
  // Fact path uses the canonical entity name ("loanApplication"), not the raw
  // rulesheet-local alias ("loanapp") the Corticon text itself uses -- confirmed
  // necessary, not cosmetic: see buildAliasMap/resolveAliases in build-facts.js
  // for the real cross-reference bug this fixes.
  const { facts } = compile('fixtures/corticon/vendor-samples/mortgage');
  for (const attr of ['late30DaysSum', 'late60DaysSum', 'late90DaysSum', 'late120DaysSum']) {
    const fact = facts.find((f) => f.path === `/loanApplication/${attr}`);
    assert.deepEqual(fact, { path: `/loanApplication/${attr}`, expression: '0' });
  }
});


test('Mortgage: a path whose only real writer is an unreachable rulesheet gets no Fact, but a path-specific translationLog entry explains why', () => {
  // Confirmed real, not theoretical: LoanApplication.creditReqtMet is written only
  // by Select_Credit.ers, which is unreachable within this vendored fixture
  // (AllPrograms.erf invokes a "Rules/Select.erf" ruleflow that was never
  // vendored). An earlier version of this file silently `continue`d here with no
  // reporting at all when every real writer of a path got excluded -- unlike the
  // genuine-cycle/unclassified-cycle cases in the same loop, which each report
  // their own path-level translationLog entry before skipping.
  const { facts, translationLog } = compile('fixtures/corticon/vendor-samples/mortgage');
  assert.equal(facts.find((f) => f.path === '/loanApplication/creditReqtMet'), undefined);
  const entry = translationLog.find((c) => c.sourcePath === 'LoanApplication.creditReqtMet' && c.pattern === 'no-writer');
  assert.ok(entry, 'expected a no-writer translation log entry explaining the missing Fact');
  assert.ok(entry.excludedRuleIds.some((id) => /Select_Credit\.ers/.test(id)));
});

test('all-patterns: a genuine cycle is skipped entirely, flagged as a translationLog annotation for manual redesign', () => {
  const { facts, translationLog } = compile('fixtures/corticon/synthetic/all-patterns');
  assert.equal(facts.some((f) => f.path === '/application/estimatedBenefit'), false);
  const entry = translationLog.find((c) => c.sourcePath === 'Application.estimatedBenefit');
  assert.equal(entry.pattern, 'cycle');
});

test('all-patterns: entity-creation writes are flagged in the translationLog reported directly from classification (not derived from graph.writes)', () => {
  // entity-creation.ers writes Application.members (an association/collection).
  // ApplicationMember entities are read downstream in all-patterns (input variant), so
  // this is a caller-contract entry, not a collection output -- no fact is generated for
  // the association path.
  // The real test is that the translationLog entry is reported from classification.entityCreation
  // directly -- not derived from graph.writes enumeration, which would silently miss it.
  const { facts, translationLog } = compile('fixtures/corticon/synthetic/all-patterns');
  assert.equal(facts.some((f) => f.path === '/application/members'), false, 'input-variant entity-creation should not produce a Fact for the association path');
  const entry = translationLog.find((c) => c.pattern === 'constructor-input' && c.ruleId?.includes('entity-creation.ers') && c.entityType === 'ApplicationMember');
  assert.ok(entry, 'expected a constructor-input translation log entry for entity-creation.ers, reported directly from classification.entityCreation');
});

test('all-patterns: an unconditional row that is NOT last in document order still folds in every later conditioned row, not silently discarding them', () => {
  // Real, confirmed bug found via a user question about what "Case 0 with no
  // condition" even means: override-example.ers has its unconditional row
  // FIRST and a conditioned row SECOND. An earlier version of chainEntries
  // iterated backward and treated whichever row it hit with guard === null as
  // an immediate override, discarding every entry already built for later
  // document-order rows -- the compiled Fact was a bare "false", with no
  // reference to the condition anywhere, and nothing said so.
  const { facts, translationLog } = compile('fixtures/corticon/synthetic/all-patterns');
  const fact = facts.find((f) => f.path === '/applicationMember/isExpeditedSnap');
  assert.equal(fact.expression, '(application.incomeRounded < 150 && applicationMember.reportedAssets <= 100) ? true : false');
  const entry = translationLog.find((c) => c.pattern === 'unconditional-row-out-of-order' && c.ruleId === 'override-example.ers');
  assert.ok(entry, 'expected an unconditional-row-out-of-order translationLog entry flagging this shape for manual review');
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

test('all-patterns: null-check-masking (ApplicationMember.reportedAssets) compiles to an expression fact', () => {
  const { facts } = compile('fixtures/corticon/synthetic/all-patterns');
  const fact = facts.find((f) => f.path === '/applicationMember/reportedAssets');
  assert.deepEqual(fact, { path: '/applicationMember/reportedAssets', expression: '0' });
});

test('all-patterns: an ordinary unconditional single-rule Fact compiles to a bare value, no ternary', () => {
  const { facts } = compile('fixtures/corticon/synthetic/all-patterns');
  assert.equal(facts.find((f) => f.path === '/applicationMember/reviewTrack').expression, "'Expedited'");
  assert.equal(facts.find((f) => f.path === '/applicationMember/needsAccommodationReview').expression, 'true');
});

test('all-patterns: date arithmetic, currency rounding, and the field-sum aggregate all compile against real proposed custom CEL functions', () => {
  const { facts } = compile('fixtures/corticon/synthetic/all-patterns');
  assert.equal(facts.find((f) => f.path === '/applicationMember/age').expression, 'yearsBetween(applicationMember.dob, today)');
  assert.equal(facts.find((f) => f.path === '/application/totalIncome').expression, "sum(applicationMember, 'income')");
  assert.equal(facts.find((f) => f.path === '/application/incomeRounded').expression, 'round(application.totalIncome, 2)');
});

test('all-patterns: a rulesheet-level filter is folded into every Fact that rulesheet compiles, not just reported informationally', () => {
  const { facts, translationLog } = compile('fixtures/corticon/synthetic/all-patterns');
  // collection-filter.ers's real filter (adult.age >= 18) gates its own otherwise-unconditional row.
  // Compiled CEL uses the canonical entity alias ("applicationMember"), not the rulesheet-local
  // filtered-collection alias ("adult") -- confirmed necessary: see buildAliasMap/resolveAliases
  // in build-facts.js for the real cross-reference bug this fixes.
  assert.equal(facts.find((f) => f.path === '/application/adultCount').expression, '(applicationMember.age >= 18) ? size(applicationMember) : unresolved()');
  const filterEntry = translationLog.find((c) => c.pattern === 'guard' && c.ruleId === 'collection-filter.ers');
  assert.equal(filterEntry.expression, 'adult.age >= 18');
});

test('all-patterns: decision-table combinatorics within one rulesheet compile to a first-match-wins chain, flagged with the real hit-policy caveat', () => {
  const { facts, translationLog } = compile('fixtures/corticon/synthetic/all-patterns');
  const incomeTier = facts.find((f) => f.path === '/application/incomeTier');
  assert.equal(
    incomeTier.expression,
    "(application.incomeRounded < 1580) && (application.adultCount == 1) ? 'Tier1' : (application.incomeRounded < 2137) && (application.adultCount == 2) ? 'Tier1' : (application.incomeRounded < 2694) && (application.adultCount >= 3) ? 'Tier1' : (application.incomeRounded >= 1580) && (application.adultCount == 1) ? 'Tier2' : unresolved()"
  );
  const hitPolicyEntry = translationLog.find((c) => c.pattern === 'hit-policy-unverified' && c.ruleId === 'decision-table.ers');
  assert.deepEqual(hitPolicyEntry.ruleIndices, [1, 2, 3, 4], 'shifted by 1 vs. Corticon\'s own rule count: index 0 is the reserved blank/template row, now kept rather than filtered');
});

test('all-patterns: no unconditional row anywhere in the chain surfaces a no-fallback-row translationLog entry and calls the proposed unresolved() sentinel', () => {
  const { translationLog } = compile('fixtures/corticon/synthetic/all-patterns');
  for (const path of ['Application.incomeTier', 'ApplicationMember.isEligible', 'ApplicationMember.meetsAllCriteria', 'Application.adultCount']) {
    assert.ok(translationLog.some((c) => c.sourcePath === path && c.pattern === 'no-default'), `expected a no-default entry for ${path}`);
  }
});

test('all-patterns: cross-rulesheet assembly (ApplicationMember.isEligible, across fact-assembly-a.ers and fact-assembly-b.ers) compiles as one chained expression', () => {
  const { facts } = compile('fixtures/corticon/synthetic/all-patterns');
  const isEligible = facts.find((f) => f.path === '/applicationMember/isEligible');
  // Both rulesheets' rows are present in the compiled chain -- not just one of them.
  assert.match(isEligible.expression, /incomeTier == 'Tier1'/);
  assert.match(isEligible.expression, /incomeTier == 'Tier2'/);
  assert.match(isEligible.expression, /incomeTier == 'Tier3'/);
  assert.match(isEligible.expression, /unresolved\(\)$/);
});

test('all-patterns: a real service call-out is flagged as an orchestration-layer translationLog annotation, not a Fact', () => {
  const { translationLog } = compile('fixtures/corticon/synthetic/all-patterns');
  const entry = translationLog.find((c) => c.pattern === 'call-procedure');
  assert.equal(entry.node, 'VerifyIncome');
  assert.deepEqual(entry.connector, { className: 'VerifyIncomeServiceCallout.js', serviceName: 'verifyIncome' });
});

test('DC Medicaid/CHIP: Person.MedicaidEligible assembles all three real rulesheets (Flatten, Parse Cohorts, Citizenship requirements) in real ruleflow invocation order, with Parse Cohorts\' real filter folded in', () => {
  const { facts } = compile('fixtures/corticon/government/dc-medicaid-chip');
  const medicaidEligible = facts.find((f) => f.path === '/person/MedicaidEligible');
  assert.ok(medicaidEligible, 'expected a compiled Person.MedicaidEligible Fact');
  // Flatten.ers is invoked last (highest priority) -- its own 2 rows appear first.
  assert.match(medicaidEligible.expression, /^\(person\.outputCoverage1 == null\)/);
  // Parse Cohorts.ers's real filter (cohorts->notEmpty) is folded into its own
  // otherwise-unconditional row, not silently dropped. Uses the canonical entity
  // alias ("cohort"), not Parse Cohorts.ers's own rulesheet-local collection alias
  // ("cohorts") -- see buildAliasMap/resolveAliases in build-facts.js.
  assert.match(medicaidEligible.expression, /\(size\(cohort\) != 0\) \? true/);
  // Citizenship requirements.ers (invoked first, lowest priority) still appears as
  // the final fallback -- not silently discarded once a higher-priority rulesheet's
  // own chain was compiled, which was the real bug this design fixed.
  assert.match(medicaidEligible.expression, /citizenship/);
  assert.match(medicaidEligible.expression, /unresolved\(\)$/);
});

test('DC Medicaid/CHIP: a rule guarded by a real range-membership condition (Person.age in ( 18 .. 26 )) is correctly entity-creation-excluded, not silently mistranslated into a Fact', () => {
  // MAGI Eligibility Groups.ers's real "Former Foster Care Youth" cohort rule uses
  // this exact condition -- but its action is `Person.cohort += Cohort.newUnique[...]`,
  // real entity creation. This test exists to confirm that exclusion still happens
  // correctly even when the excluded rule's OWN guard uses a construct (range
  // membership) this translator only added support for recently -- see
  // corticon-expression-parser.test.js/to-cel.test.js for the actual range-membership
  // parsing/codegen unit tests.
  const { translationLog } = compile('fixtures/corticon/government/dc-medicaid-chip');
  assert.ok(translationLog.some((c) => c.pattern === 'constructor-input' && c.ruleId?.includes('MAGI Eligibility Groups')));
});

test('snap-work-requirements: null-default.ers is NOT classified as fact-assembly for WorkActivity.hoursApplied -- only enum-branch-b.ers is the real writer', () => {
  // null-default.ers provides a placeholder fallback for WorkActivity.hoursApplied
  // (hoursVerified = null -> hoursApplied = hoursReported). enum-branch-b.ers
  // writes the actual computed value. These are not joint fact-assembly participants;
  // the null-default writer must be excluded from the assembly count so the path
  // does not appear as cross-rulesheet assembly and null-default.ers is not tagged
  // as fact-assembly in the visualizer.
  const project = loadProject('fixtures/corticon/synthetic/snap-work-requirements');
  const classification = classifyProject(project);
  const hoursAppliedAssembly = classification.patterns.crossRulesheetAssembly.find((a) => a.path === 'WorkActivity.hoursApplied');
  assert.equal(hoursAppliedAssembly, undefined, 'WorkActivity.hoursApplied should not appear in crossRulesheetAssembly after excluding null-default writers');
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
  const { facts } = compile('fixtures/corticon/government/dc-medicaid-chip');
  const isChipEligible = facts.find((f) => f.path === '/person/isCHIPEligible');
  assert.match(isChipEligible.expression, /\(person\.isInmate == false \|\| person\.isInmate == null\) && \(person\.age < 19\)/);
});

test('DC Medicaid/CHIP: the confirmed-dead Non-MAGI Eligibility Groups.ers is excluded from Fact compilation entirely and reported directly, even though it writes the same path a real reachable rulesheet does', () => {
  const { translationLog } = compile('fixtures/corticon/government/dc-medicaid-chip');
  // Confirmed real: Non-MAGI Eligibility Groups.ers (never invoked by any real
  // Ruleflow) also writes Person.outputCoverage1, the same path Flatten.ers (real,
  // reachable) writes -- an earlier version of this file didn't exclude unreachable
  // rulesheets from cross-rulesheet assembly/decision-table compilation at all, so
  // this dead rulesheet's logic was silently eligible to be compiled in as if live.
  const entry = translationLog.find((c) => c.pattern === 'unreachable');
  assert.ok(entry, 'expected a direct unreachable translation log entry');
  assert.match(entry.ruleId, /Non-MAGI Eligibility Groups\.ers$/);
});

test('DC Medicaid/CHIP: every real expression pattern found in Phase 3 classification is reported in the translationLog, not just implicit in the compiled CEL', () => {
  const { translationLog } = compile('fixtures/corticon/government/dc-medicaid-chip');
  const entries = translationLog.filter((c) => c.pattern === 'expression-pattern');
  assert.ok(entries.length > 0, 'expected at least one expression-pattern translationLog entry');
  assert.ok(entries.some((e) => e.patternKind === 'date-arithmetic'));
  assert.ok(entries.some((e) => e.patternKind === 'currency-rounding'));
  assert.ok(entries.some((e) => e.patternKind === 'sorting'));
});

test('a rulesheet invoked from multiple disagreeing contexts (synthetic -- not observed in any real fixture) is reported directly as a translationLog entry, not silently resolved', () => {
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
    ruleflowContext: { roots: ['main.erf'], unreachableRulesheets: [], multiInvokedRulesheets: [{ ruleId: 'Shared.ers', contexts: [] }] },
    patterns: {
      selfLoops: [],
      multiHopCycles: [],
      crossRulesheetAssembly: [],
      decisionTableCombinatorics: [],
      entityCreation: [],
      serviceCallouts: [],
      filters: [],
      expressionPatterns: [],
      noOps: [],
    },
  };
  const { translationLog } = buildFacts(project, graph, classification, { parseExpression });
  const entry = translationLog.find((c) => c.pattern === 'context-conflict');
  assert.equal(entry.ruleId, 'Shared.ers');
});
