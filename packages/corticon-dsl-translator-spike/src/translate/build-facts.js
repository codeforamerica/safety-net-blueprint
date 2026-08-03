import { canonicalAttributePath } from '../graph/attribute-path.js';
import { toCel, toCelStatement, factPathFromCanonicalPath } from './to-cel.js';
import { resolveRuleflowContext } from '../classify/ruleflow-context.js';
import { entriesOf } from '../map-utils.js';

// Every real Vocabulary attribute (see vocabulary.js), not just ones some rule
// happens to write -- confirmed real gap: all-patterns' own Applicant.dob,
// Applicant.income, Applicant.fullName, Applicant.householdKey,
// Applicant.hasDisability, and Applicant.programTrack are all real declared
// attributes no rule in that project ever assigns, so none of them appeared in
// graph.writes at all -- buildFacts's only loop walked graph.writes, never the
// Vocabulary itself, so a pure input was silently missing from the compiled
// Fact set entirely rather than becoming a plain Writable fact. `kind !==
// 'attribute'` (an association/relationship to another entity) is excluded --
// canonicalAttributePath's own ATTRIBUTE-only resolution means an association
// was never a scalar Fact candidate in the first place.
function enumerateVocabularyAttributes(project) {
  const paths = [];
  for (const [, vocab] of entriesOf(project.vocabularies)) {
    for (const [entityName, entity] of entriesOf(vocab.entities)) {
      for (const [attrName, attr] of entriesOf(entity.attributes)) {
        if (attr.kind !== 'attribute') continue;
        if (attr.isCollection) {
          throw new Error(`"${entityName}.${attrName}" is a repeating scalar attribute (isCollection) -- no confirmed real example exists in any fixture yet, and this DSL's Fact path scheme (see factPathFromCanonicalPath) has no established wildcard convention for one. Flagging rather than guessing at a path shape.`);
        }
        paths.push(`${entityName}.${attrName}`);
      }
    }
  }
  return paths;
}

// Real, confirmed bug, not a modeling gap to merely document: a rulesheet-local
// alias can differ from its entity's own canonical name (confirmed real:
// AdultCount.ers's own filter defines "adult" as a filtered-collection alias for
// Applicant -- `parentTerm text="adult" datatype="Applicant"` in the real term
// tree). `canonicalAttributePath` already resolves this correctly for graph
// edges (using `datatype`, not the alias `text`) -- but `parseExpression`/`toCel`
// operate on the raw CONDITION/ACTION TEXT STRING, which has no access to
// datatype at all, so a compiled Fact's CEL body would reference the raw alias
// ("adult.age") while every OTHER Fact for that same real entity is keyed by its
// canonical name ("applicant.age") -- two different Fact paths for the same real
// attribute, a genuinely broken cross-reference in the generated CEL. Fixed by
// building an alias -> canonical-entity-name map from the SAME cell's own
// referencedTerms/modifiedTerms (which already carry the real datatype per
// occurrence) and rewriting the parsed AST's identifiers through it before
// generating CEL -- not a raw text substitution, which would risk mangling a
// string literal that happens to contain the same word.
function buildAliasMap(cell) {
  const map = new Map();
  function walkChain(term) {
    let current = term;
    while (current) {
      if (current.termtype === 'ENTITY' && current.text && current.datatype) map.set(current.text, current.datatype);
      current = current.parent;
    }
  }
  for (const term of [...(cell?.referencedTerms ?? []), ...(cell?.modifiedTerms ?? [])]) walkChain(term);
  return map;
}

// Walks any AST node shape generically (Identifier/Member/Call/BinaryOp/etc.)
// rather than special-casing each one -- rewriting only Identifier.name through
// the alias map, leaving every other node (including Literal string VALUES)
// untouched, which is exactly the precision a raw-text substitution couldn't
// guarantee.
function resolveAliases(node, aliasMap) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'Identifier') {
    const canonical = aliasMap.get(node.name);
    return canonical ? { ...node, name: canonical } : node;
  }
  const resolved = { ...node };
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) resolved[key] = value.map((v) => resolveAliases(v, aliasMap));
    else if (value && typeof value === 'object') resolved[key] = resolveAliases(value, aliasMap);
  }
  return resolved;
}

/** Parses one cell's own text and resolves its identifiers to canonical entity names via that SAME cell's own term tree -- see buildAliasMap/resolveAliases above for the real bug this fixes. */
function parseAndCanonicalize(cell, parseExpression) {
  return resolveAliases(parseExpression(cell.text), buildAliasMap(cell));
}

function findActionForPath(rule, path) {
  // A self-closing <action/> column (that action doesn't apply to this rule row)
  // is now kept as `null`, not dropped, to preserve column position -- see
  // rulesheet.js's own comment. Filtered out here, not upstream.
  return rule.actions.filter(Boolean).find((action) => (action.modifiedTerms ?? []).some((t) => canonicalAttributePath(t) === path));
}

// Confirmed real, not assumed: Progress's own documentation states a rulesheet's
// filters are a rulesheet-WIDE precondition, not a per-rule one -- "other business
// rules will fire if and only if data ... survives the Filter, and shares the same
// scope as the rules." Confirmed against a real example that specifically tests this:
// DC Medicaid/CHIP's Parse Cohorts.ers has a real filter (`cohorts->notEmpty`) and a
// real rule (`Person.MedicaidEligible = T`) that does NOT reference `cohorts` at all
// -- yet the filter still gates it, because both share the rulesheet's own Person
// scope. An earlier version of this file ignored filters entirely when compiling
// guards, surfacing them only as an informational crosswalk note -- which produced a
// real, silently wrong compilation: that rule looked unconditional (`hasFallback:
// true`) when it's actually gated by the filter. Multiple filters on one rulesheet
// are AND-ed together, matching Select_Credit.ers's real two-filter case (both
// narrowing the same `liability` collection).
// Every individual condition/filter is wrapped in parens before being AND-ed with
// the next one -- confirmed real, not a cosmetic-only concern: DC Medicaid's own
// MAGI Eligibility Groups.ers has a real rule with condition text
// "Person.age = 19 or Person.age = 20" AND-ed against a second, separate condition
// ("Person.HouseholdActualPercentFPL < 216"). An earlier version of this file
// joined each condition's own CEL with a bare " && ", producing
// "age == 19 || age == 20 && fpl < 216" -- which CEL parses as
// "age == 19 || (age == 20 && fpl < 216)" (&& binds tighter than ||), not the
// "(age == 19 || age == 20) && fpl < 216" Corticon's own AND-across-columns
// semantics actually require. Wrapping each condition/filter in its own parens
// before joining makes the compiled guard correct regardless of what operator is
// at that condition's own top level.
function compileFilterGuard(rulesheet, parseExpression) {
  const filterCels = (rulesheet.filters ?? []).map((f) => `(${toCel(parseAndCanonicalize(f, parseExpression))})`);
  return filterCels.length ? filterCels.join(' && ') : null;
}

function compileGuard(rule, filterGuard, parseExpression) {
  // A self-closing <condition/> column (blank for this rule row) is now kept as
  // `null`, not dropped, to preserve column position -- see rulesheet.js's own
  // comment. Filtered out here, not upstream.
  const conditionCels = rule.conditions.filter(Boolean).map((c) => `(${toCel(parseAndCanonicalize(c, parseExpression))})`);
  const guards = filterGuard ? [filterGuard, ...conditionCels] : conditionCels;
  return guards.length ? guards.join(' && ') : null;
}

/** Parses and translates one action exactly once, returning both its target Fact path (if it's an assignment) and its CEL value. */
function compileAction(action, parseExpression) {
  const ast = parseAndCanonicalize(action, parseExpression);
  return toCelStatement(ast, { isAssignment: action.expressionType === 'ASSIGNMENT' });
}

function compileActionCel(action, parseExpression) {
  return compileAction(action, parseExpression).cel;
}

/**
 * Chains an ordered list of { guard, value } entries into one first-match-wins CEL
 * ternary expression: `guard1 ? value1 : guard2 ? value2 : ... : fallback`. An
 * unconditional entry (guard === null) is treated as the chain's OWN
 * fallback/default -- REGARDLESS of where it appears in `entries` -- not
 * "whichever one the backward iteration happens to reach first", which is what an
 * earlier version of this function did.
 *
 * That earlier version was a real, confirmed, SILENT wrong compilation, not a
 * hypothetical edge case: this fixture's own ProgramAEligibility.ers has an
 * unconditional row FIRST (Rule 0: sets isProgramAEligible = false) and a
 * conditioned row SECOND (Rule 1: isEligible = true -> isProgramAEligible = true).
 * The old code iterated backward from the last entry, built a real ternary for
 * Rule 1's condition, then hit Rule 0 (guard === null) and OVERWROTE the whole
 * expression with a bare "false" -- silently discarding Rule 1's logic entirely.
 * The compiled Fact was just `"false"`, with no reference to isEligible anywhere,
 * and nothing in the output said so.
 *
 * More than one unconditional entry for the same path is a genuine conflict --
 * Corticon's own design-time "Predicate Logic Matrix" should never allow two rows
 * to both be unconditional in the same decision table -- thrown rather than
 * silently picking one, since which one Corticon itself would use isn't knowable
 * from this data.
 *
 * If the chain has no unconditional entry at all, `fallback` is used as the final
 * else -- defaults to a PROPOSED `unresolved()` CEL sentinel standing in for a real
 * semantic gap this DSL's completeness model doesn't have an established answer
 * for: what a Derived fact evaluates to when no row's guard matches, given the DSL
 * has no "leave it as whatever it was before" mutate-in-place fallback the way
 * Corticon's own engine does. Not settled fact, feeding back into the same open
 * design space decision-rules-dsl.md's Decision 4 already established for other
 * real gaps found during this spike.
 *
 * Accepting an explicit `fallback` (rather than always hardcoding `unresolved()`) is
 * what lets compileAcrossRulesheets below correctly thread a LOWER-priority
 * rulesheet's own chain in as the fallback for a HIGHER-priority one, instead of
 * silently discarding it the moment the higher-priority rulesheet has no matching row
 * -- see that function's own comment for the real bug this fixes.
 */
export function chainEntries(entries, fallback = 'unresolved()') {
  const unconditional = entries.filter(({ guard }) => guard === null);
  if (unconditional.length > 1) {
    throw new Error(`${unconditional.length} unconditional entries found for the same path -- Corticon's own design-time conflict checker should never allow more than one unconditional row in the same decision table, and which one Corticon itself would use can't be determined from this data`);
  }
  const hasFallback = unconditional.length === 1;
  let expr = hasFallback ? unconditional[0].value : fallback;
  const conditioned = entries.filter(({ guard }) => guard !== null);
  for (let i = conditioned.length - 1; i >= 0; i--) {
    expr = `${conditioned[i].guard} ? ${conditioned[i].value} : ${expr}`;
  }
  return { cel: expr, hasFallback };
}

/** True if this rulesheet's own entries for one path have an unconditional row that ISN'T last in document order -- confirmed real (see chainEntries' own comment): the compiled result is still correct now, but this exact shape has no confirmed golden-master trace proving Corticon's real semantics match this compiled interpretation, unlike the far more common "unconditional row last" case. Flagged for manual review rather than assumed silently equivalent. */
function hasOutOfOrderUnconditional(entries) {
  const unconditionalIndex = entries.findIndex(({ guard }) => guard === null);
  return unconditionalIndex !== -1 && unconditionalIndex !== entries.length - 1;
}

/**
 * Builds the { guard, value } entries for every rule (in ascending, i.e. document,
 * order) within one rulesheet that writes `path`. Confirmed, not merely assumed, that
 * order is safe to pick arbitrarily FOR THE COMMON CASE: Corticon's own documented
 * default decision-table hit policy is UNIQUE -- rows are required to be mutually
 * exclusive, and Corticon Studio's own design-time "Predicate Logic Matrix" conflict
 * checker mathematically verifies this and alerts the rule author if two rows'
 * conditions can overlap. Under that default, no row's guard can ever be true at the
 * same time as another's, so the order checked doesn't change the result at all.
 *
 * Real, confirmed, UNRESOLVED gap: Corticon also supports a "Rule Order" hit policy,
 * where multiple rows ARE allowed to overlap and all matching ones fire -- under that
 * policy, order-dependence would be real, not moot, and first-match-wins compilation
 * could be outright wrong. Checked directly against every real fixture's raw XML for
 * a hit-policy attribute on `<rulesheetViewList>`/`<ruleset>` and found none -- this
 * translator has no way to detect which hit policy a given rulesheet was authored
 * with, because Corticon's own file format doesn't appear to expose it. Since this
 * can't be resolved from the data, it's surfaced as an explicit crosswalk annotation
 * on every multi-row Fact (see the caller in buildFacts), not left as a comment only
 * a source-reader would see.
 */
function compileRulesheetEntries(rulesheetKey, rulesheet, ruleIndices, path, parseExpression) {
  const filterGuard = compileFilterGuard(rulesheet, parseExpression);
  const sorted = [...ruleIndices].sort((a, b) => a - b);
  return sorted.map((ruleIndex) => {
    const rule = rulesheet.rules[ruleIndex];
    const action = findActionForPath(rule, path);
    if (!action) throw new Error(`No action in ${rulesheetKey}'s rule ${ruleIndex} actually writes "${path}" -- graph/classification and the real rule data have gone out of sync`);
    return { guard: compileGuard(rule, filterGuard, parseExpression), value: compileActionCel(action, parseExpression) };
  });
}

/**
 * Chains multiple rulesheets' own rows for the same path into one combined
 * expression, threading each rulesheet's own unresolved-case fallback into the NEXT
 * (lower-priority) rulesheet's chain, rather than compiling each rulesheet to a
 * standalone string and stitching those strings together. An earlier version of this
 * function did exactly that -- pre-compiling each rulesheet's chain with
 * chainEntries()'s default `unresolved()` fallback, then wrapping the whole string in
 * an outer ternary -- which silently discarded every LOWER-priority rulesheet's logic
 * entirely: if the highest-priority rulesheet's own rows didn't cover a case, the
 * compiled expression called `unresolved()` right there and never even looked at the
 * other rulesheets, even though DC Medicaid's own real `Person.MedicaidEligible`
 * (assembled across Citizenship requirements.ers, Flatten.ers, and Parse Cohorts.ers)
 * needs exactly that fallthrough to work at all. Fixed by folding rulesheets from
 * lowest to highest priority, passing each one's own compiled result in as the next
 * rulesheet's fallback.
 *
 * `rulesheetKeys` must already be sorted by REAL ruleflow invocation order,
 * descending (most-recently-invoked first) -- see buildFacts's own use of
 * `resolveRuleflowContext`'s `firstInvocationOrder`, not discovery order. This
 * reproduces Corticon's own documented sequential-execution semantics: "if a
 * connector is drawn from Rulesheet sample1.ers to sample2.ers, then when a deployed
 * Ruleflow is invoked, it will execute the rules in sample1.ers first, followed by
 * the rules in sample2.ers" (Corticon Ruleflow window docs) -- a later-invoked
 * rulesheet's own conditions, if they match, overwrite an earlier rulesheet's value,
 * which is exactly what `rulesheetKeys[0]` (most recently invoked) being checked
 * FIRST and winning reproduces. An earlier version of this function used arbitrary
 * discovery order here instead of real invocation order -- fixed once
 * `ruleflow-context.js` was extended to actually resolve it, rather than continuing
 * to guess.
 */
function compileAcrossRulesheets(rulesheetKeys, entriesByRulesheet) {
  let fallback = 'unresolved()';
  let hasFallback = false;
  for (let i = rulesheetKeys.length - 1; i >= 0; i--) {
    const result = chainEntries(entriesByRulesheet.get(rulesheetKeys[i]), fallback);
    fallback = result.cel;
    hasFallback = hasFallback || result.hasFallback;
  }
  return { cel: fallback, hasFallback };
}

/**
 * Compiles a whole classified project into two things: a COMPLETE set of decision-rules
 * DSL Fact declarations (every real Vocabulary attribute becomes either a Derived Fact,
 * a Writable Fact with a Placeholder default, or a plain Writable Fact for a pure input
 * -- see enumerateVocabularyAttributes) and a COMPLETE Vocabulary<->Fact crosswalk (one
 * `ordinary-*` row per attribute, plus additional rows for anything flagged as an
 * orchestration-layer concern, a genuine cycle, or otherwise not translatable into a
 * Fact at all). Takes the engine's own `parseExpression` as a dependency (see
 * engines.js) rather than importing Corticon's parser directly -- this file only ever
 * touches the shared, engine-agnostic project model and the generic AST, never
 * Corticon's raw text syntax itself.
 */
export function buildFacts(project, graph, classification, { parseExpression }) {
  const rulesheets = new Map(entriesOf(project.rulesheets));
  const ruleflowContext = resolveRuleflowContext(project);

  const entityCreationRuleKeys = new Set(classification.entityCreation.map((e) => `${e.rulesheet}#${e.ruleIndex}`));
  const unreachableRulesheets = new Set(classification.ruleflowContext.unreachableRulesheets);
  const selfLoopClassificationByKey = new Map(classification.selfLoops.map((s) => [`${s.path}|${s.rulesheet}#${s.ruleIndex}`, s.classification]));
  const genuineCyclePaths = new Set([
    ...classification.selfLoops.filter((s) => s.classification === 'genuine-cycle').map((s) => s.path),
    ...classification.multiHopCycles.filter((c) => c.classification !== 'unclassified-multi-hop-cycle').flatMap((c) => c.path),
  ]);
  const unclassifiedCyclePaths = new Set(classification.multiHopCycles.filter((c) => c.classification === 'unclassified-multi-hop-cycle').flatMap((c) => c.path));
  const combinatoricsByPathRulesheet = new Map(classification.decisionTableCombinatorics.map((d) => [`${d.path}|${d.rulesheet}`, d.ruleIndices]));
  const assemblyRulesheetsByPath = new Map(classification.crossRulesheetAssembly.map((a) => [a.path, a.rulesheets]));

  const facts = [];
  const crosswalk = [];

  // classification.entityCreation is the complete, authoritative source for
  // entity-creation crosswalk entries -- reported directly and unconditionally here,
  // not derived from graph.writes. An earlier version of this function only pushed
  // an entity-creation crosswalk entry from inside the per-path loop below, keyed off
  // whatever graph.writes happened to enumerate -- but a real association-mutation
  // action (`Person.cohort += Cohort.newUnique[...]`, confirmed real in DC Medicaid's
  // MAGI Eligibility Groups.ers) has no resolvable scalar ATTRIBUTE term at all, so it
  // never becomes a graph.writes entry (the same real gap entity-creation-classifier.js's
  // own comment documents for why it scans rulesheets directly instead of the graph).
  // That meant this real, correctly-classified finding was silently missing from the
  // crosswalk output entirely -- not flagged, not thrown, just absent. Fixed by making
  // this list itself the source of truth, so completeness doesn't depend on whether
  // graph.writes happens to enumerate a matching path.
  for (const entry of classification.entityCreation) {
    crosswalk.push({ rulesheet: entry.rulesheet, ruleIndex: entry.ruleIndex, kind: 'entity-creation', entityType: entry.entityType, note: 'Orchestration-layer concern (data assembly) -- not a Fact derivation.' });
  }

  // Same "report directly from classification, don't rely on graph.writes
  // enumeration" reasoning as entityCreation above -- confirmed real, not
  // theoretical: DC Medicaid/CHIP's own dead `Non-MAGI Eligibility Groups.ers`
  // (confirmed never invoked by any real Ruleflow) ALSO writes `Person.outputCoverage1`,
  // the same path the real, reachable `Flatten.ers` writes -- meaning this dead
  // rulesheet's logic was silently eligible to be compiled into cross-rulesheet
  // assembly and decision-table combinatorics as if it were live, with nothing
  // excluding it and nothing reporting that it happened. Reported here directly and
  // unconditionally; excluded from ordinaryWriters below the same way entity-creation
  // writers are.
  for (const rulesheetKey of unreachableRulesheets) {
    crosswalk.push({ rulesheet: rulesheetKey, kind: 'unreachable-rulesheet', note: 'Never invoked by any real Ruleflow node -- dead content, excluded entirely from Fact compilation.' });
  }

  // Same reasoning again: classification.expressionPatterns (date arithmetic,
  // currency rounding, sorting) is computed in Phase 3 but was never reported
  // anywhere in Phase 4 -- a reviewer had no explicit list of which real constructs
  // depend on a PROPOSED, not-yet-settled custom CEL function (round/yearsBetween/
  // addYears/nthByKey/sum/pow -- see to-cel.js), only whatever's implicit in the
  // compiled CEL text itself. Reported directly here, independent of whether the
  // pattern's own rule ends up excluded from Fact compilation for an unrelated
  // reason (e.g. entity creation, unreachability) -- the pattern was still found and
  // still depends on an unsettled function, which is worth knowing either way.
  for (const pattern of classification.expressionPatterns) {
    crosswalk.push({
      rulesheet: pattern.rulesheet,
      ruleIndex: pattern.ruleIndex,
      kind: 'expression-pattern',
      patternKind: pattern.kind,
      expression: pattern.expression,
      note: 'Translated via a PROPOSED custom CEL function, not yet settled in decision-rules-dsl.md\'s Decision 4 -- see to-cel.js and TRANSLATION-PATTERNS.md for the real evidence behind this specific mapping.',
    });
  }

  // Defensive, not yet confirmed real (see ruleflow-context.js's own comment) --
  // surfaced anyway per the same "don't let a real finding go unreported just
  // because it hasn't happened yet" principle as everything above.
  for (const entry of classification.ruleflowContext.multiInvokedRulesheets) {
    crosswalk.push({
      rulesheet: entry.rulesheet,
      kind: 'multi-invoked-disagreeing-context',
      note: 'Reached from more than one place in the project with disagreeing iterative/branched context -- not yet observed in any real fixture. Self-loop/cycle classification for this rulesheet was resolved by combining contexts with OR (favoring a possible false positive over a missed genuine cycle); worth manual review if this ever fires for real.',
    });
  }

  for (const [path, writers] of entriesOf(graph.writes)) {
    if (genuineCyclePaths.has(path)) {
      crosswalk.push({ path, kind: 'genuine-cycle', note: 'Flagged for manual redesign -- reverse-chaining cannot express this as a single backward derivation.' });
      continue;
    }
    if (unclassifiedCyclePaths.has(path)) {
      crosswalk.push({ path, kind: 'unclassified-multi-hop-cycle', note: 'A multi-node cycle not confirmed genuine or safe -- needs manual review before translating.' });
      continue;
    }

    // Entity-creation-tainted and unreachable-rulesheet writers never become part of
    // an ordinary Fact expression -- both already got their OWN crosswalk entry
    // pushed above, from classification directly; this loop only needs to exclude
    // them here. But that per-rule/per-rulesheet entry only says "this rule/
    // rulesheet is entity-creation/unreachable" -- it says nothing about what
    // happens to a PATH whose every real writer gets excluded this way. Confirmed
    // real, not theoretical: Mortgage's own `LoanApplication.creditReqtMet` is
    // written only by Select_Credit.ers, which is unreachable within this vendored
    // fixture (AllPrograms.erf invokes a "Rules/Select.erf" ruleflow that was never
    // vendored) -- so this path silently got neither a Fact NOR a path-specific
    // explanation, just a bare `continue`, unlike the genuine-cycle/unclassified-
    // cycle cases just above which each report their own path-level entry before
    // skipping.
    const ordinaryWriters = writers.filter((writer) => !entityCreationRuleKeys.has(`${writer.rulesheet}#${writer.ruleIndex}`) && !unreachableRulesheets.has(writer.rulesheet));
    if (ordinaryWriters.length === 0) {
      const excludedRulesheets = [...new Set(writers.map((w) => w.rulesheet))];
      crosswalk.push({
        path,
        kind: 'no-ordinary-writer',
        note: `Every real writer of this path (${excludedRulesheets.join(', ')}) was excluded as entity-creation and/or an unreachable rulesheet -- no Fact could be compiled for it at all. Needs manual review.`,
      });
      continue;
    }

    // Null-check-masking: confirmed real as always exactly one writer for the whole
    // path (see build-facts.test.js) -- maps onto a Writable fact with a Placeholder
    // default, not a Derived expression at all. If more than one ever turns up,
    // there's no design yet for combining multiple placeholder rows into one Fact --
    // throwing here rather than silently keeping only the first and discarding the
    // rest.
    const maskingWriters = ordinaryWriters.filter((w) => selfLoopClassificationByKey.get(`${path}|${w.rulesheet}#${w.ruleIndex}`) === 'null-check-masking');
    if (maskingWriters.length > 1) {
      throw new Error(`"${path}" has ${maskingWriters.length} null-check-masking writers (${maskingWriters.map((w) => `${w.rulesheet}#${w.ruleIndex}`).join(', ')}) -- no design yet for combining more than one Placeholder row into one Fact`);
    }
    if (maskingWriters.length === 1) {
      const [maskingWriter] = maskingWriters;
      const rulesheet = rulesheets.get(maskingWriter.rulesheet);
      const action = findActionForPath(rulesheet.rules[maskingWriter.ruleIndex], path);
      if (!action) throw new Error(`No action in ${maskingWriter.rulesheet}'s rule ${maskingWriter.ruleIndex} actually writes "${path}" -- graph/classification and the real rule data have gone out of sync`);
      const { targetPath, cel } = compileAction(action, parseExpression);
      facts.push({ path: targetPath, writable: true, placeholder: cel });
      crosswalk.push({ corticonPath: path, factPath: targetPath, kind: 'ordinary-writable-placeholder', note: 'Null-check masking -- maps onto a Writable fact with a Placeholder default, not a Derived expression.' });
      continue;
    }

    // Group the remaining ordinary writers by rulesheet, building each rulesheet's
    // own { guard, value } entries (decision-table-combinatorics-aware if more than
    // one rule contributes), then chain across rulesheets if this path is
    // cross-rulesheet-assembled. Sorted by REAL ruleflow invocation order, most
    // recently invoked first -- see compileAcrossRulesheets's own comment for why.
    const rulesheetKeysInOrder = [...new Set(ordinaryWriters.map((w) => w.rulesheet))].sort((a, b) => {
      const orderA = ruleflowContext.perRulesheet.get(a)?.firstInvocationOrder;
      const orderB = ruleflowContext.perRulesheet.get(b)?.firstInvocationOrder;
      if (orderA === undefined || orderB === undefined) {
        throw new Error(`Cannot resolve a real ruleflow invocation order for "${a}" and/or "${b}", both writers of "${path}" -- expected every rulesheet with a real write to be reachable`);
      }
      return orderB - orderA;
    });
    const entriesByRulesheet = new Map();
    for (const rulesheetKey of rulesheetKeysInOrder) {
      const rulesheet = rulesheets.get(rulesheetKey);
      const ruleIndices = ordinaryWriters.filter((w) => w.rulesheet === rulesheetKey).map((w) => w.ruleIndex);
      const combinatoricRuleIndices = combinatoricsByPathRulesheet.get(`${path}|${rulesheetKey}`);
      if (combinatoricRuleIndices) {
        // Surfaced in the actual crosswalk output, not just a source comment -- see
        // compileRulesheetEntries's own doc comment for the real, cited reasoning
        // (Corticon's default UNIQUE hit policy) and the real, confirmed gap (Rule
        // Order hit policy isn't detectable from the file format at all).
        crosswalk.push({
          path,
          rulesheet: rulesheetKey,
          ruleIndices: combinatoricRuleIndices,
          kind: 'hit-policy-unverified',
          note: 'Compiled assuming Corticon\'s default UNIQUE hit policy (rows are mutually exclusive, so row order does not affect the result). Corticon\'s file format has no hit-policy attribute to check -- if this rulesheet was authored with "Rule Order" hit policy instead (multiple overlapping rows all fire), this compiled expression may be wrong. Needs manual confirmation against the original Corticon Studio project.',
        });
      }
      const rulesheetEntries = compileRulesheetEntries(rulesheetKey, rulesheet, combinatoricRuleIndices ?? ruleIndices, path, parseExpression);
      if (hasOutOfOrderUnconditional(rulesheetEntries)) {
        // Confirmed real, not hypothetical: this fixture's own ProgramAEligibility.ers
        // has its unconditional row FIRST, not last -- see chainEntries' own comment
        // for the real silent-wrong-compilation bug this shape used to cause. The
        // compiled result is now correct (unconditional treated as the fallback
        // regardless of position), but no confirmed golden-master trace proves
        // Corticon's real semantics match this compiled interpretation for this
        // specific out-of-order shape, unlike the far more common "unconditional row
        // last" case -- flagged for manual review, not assumed silently equivalent.
        crosswalk.push({
          path,
          rulesheet: rulesheetKey,
          kind: 'unconditional-row-out-of-order',
          note: 'This rulesheet\'s unconditional/default row is not last in document order. Compiled by treating it as the fallback regardless of position -- but this exact shape has no confirmed golden-master trace proving that matches Corticon\'s real semantics. Needs manual confirmation against the original Corticon Studio project.',
        });
      }
      entriesByRulesheet.set(rulesheetKey, rulesheetEntries);
    }

    const assemblyRulesheets = assemblyRulesheetsByPath.get(path);
    if (assemblyRulesheets && assemblyRulesheets.length !== rulesheetKeysInOrder.length) {
      // Confirmed possible, and confirmed real for the unreachable-rulesheet case
      // (DC Medicaid/CHIP's dead Non-MAGI Eligibility Groups.ers is one of
      // Person.outputCoverage1's assembling rulesheets): entity-creation or
      // unreachable-rulesheet exclusion above can drop a rulesheet's writers
      // entirely, leaving fewer rulesheets here than classification originally
      // found. Surfaced explicitly rather than silently compiling against a shrunk
      // set without saying so.
      crosswalk.push({
        path,
        kind: 'assembly-rulesheet-mismatch',
        note: `Classification found ${assemblyRulesheets.length} assembling rulesheets (${assemblyRulesheets.join(', ')}) but only ${rulesheetKeysInOrder.length} (${rulesheetKeysInOrder.join(', ')}) remain after excluding entity-creation-tainted and/or unreachable-rulesheet writers. Needs manual review.`,
      });
    }

    const { cel, hasFallback } = assemblyRulesheets && assemblyRulesheets.length > 1 ? compileAcrossRulesheets(rulesheetKeysInOrder, entriesByRulesheet) : chainEntries(entriesByRulesheet.get(rulesheetKeysInOrder[0]));

    if (!hasFallback) {
      crosswalk.push({ path, kind: 'no-fallback-row', note: 'No unconditional row covers every case -- the compiled expression calls a proposed unresolved() sentinel where Corticon would have simply left the value unchanged. Needs manual review.' });
    }
    const factPath = factPathFromCanonicalPath(path);
    facts.push({ path: factPath, derived: cel });
    crosswalk.push({ corticonPath: path, factPath, kind: 'ordinary-derived' });
  }

  // The main loop above only ever walks graph.writes -- every Vocabulary attribute
  // with no writer at all (a pure input) never appears there, so it needs its own
  // pass to become a plain Writable Fact rather than being silently absent. See
  // enumerateVocabularyAttributes's own comment for the confirmed real gap this
  // closes.
  const writtenPaths = new Set(entriesOf(graph.writes).map(([writtenPath]) => writtenPath));
  for (const path of enumerateVocabularyAttributes(project)) {
    if (writtenPaths.has(path)) continue;
    const factPath = factPathFromCanonicalPath(path);
    facts.push({ path: factPath, writable: true });
    crosswalk.push({ corticonPath: path, factPath, kind: 'ordinary-writable-input', note: 'Pure input -- no rule in this project ever writes it.' });
  }

  for (const filter of classification.filters) {
    // The filter's own condition IS folded into every affected Fact's compiled guard
    // (see compileFilterGuard) -- this note flags the narrower remaining gap: the
    // full-vs-limiting cascade behavior (does an empty-after-filter collection
    // exclude the whole parent entity, not just the filtered alias?) still isn't
    // resolvable from static file inspection (issue #388's own flagged open item).
    crosswalk.push({ rulesheet: filter.rulesheet, kind: 'filter', expression: filter.expression, note: 'Scope/Alias/Filter -- the filter condition is folded into every Fact this rulesheet compiles, but the full-vs-limiting cascade behavior (does an empty-after-filter collection exclude the whole parent entity, not just this alias?) is not resolvable from static file inspection (issue #388).' });
  }
  for (const callout of classification.serviceCallouts) {
    crosswalk.push({ ruleflow: callout.ruleflow, node: callout.node, kind: 'service-callout', connector: callout.connector, note: 'Orchestration/adapter-layer concern -- a side-effecting external call, not a Fact derivation.' });
  }

  return { facts, crosswalk };
}
