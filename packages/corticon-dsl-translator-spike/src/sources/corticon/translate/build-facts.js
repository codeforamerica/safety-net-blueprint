import { canonicalAttributePath } from '../../../graph/attribute-path.js';
import { toCel, toCelStatement, factPathFromCanonicalPath } from '../../../graph/to-cel.js';
import { resolveRuleflowContext } from '../classify/ruleflow-context.js';
import { entriesOf } from '../../../map-utils.js';
import { basename } from 'node:path';

/** Parse a ruleId string (basename form "file.ers:N") back to { rulesheet, ruleIndex }.
 * rulesheet is a basename; callers must resolve it to a full path via basenameToRulesheet. */
function parseRuleId(ruleId) {
  const colonIdx = ruleId.lastIndexOf(':');
  if (colonIdx < 0) return { rulesheet: ruleId, ruleIndex: null };
  const ruleIndex = parseInt(ruleId.slice(colonIdx + 1), 10);
  return { rulesheet: ruleId.slice(0, colonIdx), ruleIndex: isNaN(ruleIndex) ? null : ruleIndex };
}

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
      for (const [attrName] of entriesOf(entity.attributes)) {
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
      if (current.termtype === 'ENTITY' && current.text && current.datatype) {
        const raw = current.datatype;
        const canonical = raw.includes('.') ? raw.split('.').pop() : raw;
        map.set(current.text, canonical);
      }
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
// guards, surfacing them only as an informational translation log note -- which produced a
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
function compileAction(action, parseExpression, domain, graphName) {
  const ast = parseAndCanonicalize(action, parseExpression);
  return toCelStatement(ast, { isAssignment: action.expressionType === 'ASSIGNMENT', domain, graphName });
}

function compileActionCel(action, parseExpression, domain, graphName) {
  return compileAction(action, parseExpression, domain, graphName).cel;
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
 * can't be resolved from the data, it's surfaced as an explicit translation log annotation
 * on every multi-row Fact (see the caller in buildFacts), not left as a comment only
 * a source-reader would see.
 */
function compileRulesheetEntries(rulesheetKey, rulesheet, ruleIndices, path, parseExpression, domain, graphName) {
  const filterGuard = compileFilterGuard(rulesheet, parseExpression);
  const sorted = [...ruleIndices].sort((a, b) => a - b);
  return sorted.map((ruleIndex) => {
    const rule = rulesheet.rules[ruleIndex];
    const action = findActionForPath(rule, path);
    if (!action) throw new Error(`No action in ${rulesheetKey}'s rule ${ruleIndex} actually writes "${path}" -- graph/classification and the real rule data have gone out of sync`);
    return { guard: compileGuard(rule, filterGuard, parseExpression), value: compileActionCel(action, parseExpression, domain, graphName), rawExpression: action.text ?? null };
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
function compileAcrossRulesheets(rulesheetKeys, entriesByRulesheet, initialFallback = 'unresolved()') {
  let fallback = initialFallback;
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
 * DSL Fact declarations (every real Vocabulary attribute becomes either a Fact with an
 * expression:, or a plain Writable Fact for a pure input that carries no expression
 * -- see enumerateVocabularyAttributes) and a COMPLETE Vocabulary<->Fact translation log (one
 * `ordinary-*` row per attribute, plus additional rows for anything flagged as an
 * orchestration-layer concern, a genuine cycle, or otherwise not translatable into a
 * Fact at all). Takes the engine's own `parseExpression` as a dependency (see
 * engines.js) rather than importing Corticon's parser directly -- this file only ever
 * touches the shared, engine-agnostic project model and the generic AST, never
 * Corticon's raw text syntax itself.
 */
const CONFIRMED_PATTERNS = new Set(['derived', 'input', 'null-guard-fallback', 'null-guard-default', 'null-guard-table', 'aggregation', 'no-op', 'unreachable', 'constructor-output', 'constructor-input', 'guard', 'decision-table', 'decision-table-alternative-row']);
const INFERRED_PATTERNS  = new Set(['date-arithmetic', 'rounding', 'scalar-accumulator', 'operator-precedence', 'logical-operators', 'membership-test', 'coercion', 'call-function', 'sort', 'sort-rank', 'hit-policy-unverified', 'unconditional-row-out-of-order', 'composition-mismatch', 'no-default', 'context-conflict']);
const UNSUPPORTED_PATTERNS = new Set(['cycle', 'cycle-unclassified', 'no-writer', 'call-opaque', 'call-procedure']);

function statusFor(pattern) {
  if (CONFIRMED_PATTERNS.has(pattern)) return 'confirmed';
  if (INFERRED_PATTERNS.has(pattern)) return 'inferred';
  if (UNSUPPORTED_PATTERNS.has(pattern)) return 'unsupported';
  return 'error';
}

export function buildFacts(project, graph, patterns, { parseExpression, ruleflowContext: sourceRuleflowContext, domain, graphName } = {}) {
  const rulesheets = new Map(entriesOf(project.rulesheets));
  // ruleIds in patterns.json are basename-only (e.g. "foo.ers:1"). Build a
  // basename → full-path map so parseRuleId results can be resolved to rulesheets.
  const basenameToRulesheet = new Map();
  for (const [fullPath] of rulesheets) basenameToRulesheet.set(basename(fullPath), fullPath);
  const resolveRulesheet = (name) => basenameToRulesheet.get(name) ?? name;
  const ruleflowContext = resolveRuleflowContext(project);

  // Local helper that captures domain/graphName in closure so every call site is unchanged.
  const fpFromCanonical = (path) => factPathFromCanonicalPath(path, domain, graphName);

  const effectiveRuleflowContext = sourceRuleflowContext ?? {};

  // Build lookup structures from the patterns array.
  const constructorFindings = patterns.filter((p) => p.pattern === 'constructor');
  const entityCreationRuleKeys = new Set(constructorFindings.map((e) => e.ruleId));
  const noOpRuleKeys = new Set(patterns.filter((p) => p.pattern === 'no-op').map((e) => e.ruleId));

  // Unreachable basenames (strip ':*' suffix to get bare basename for Set membership checks).
  const unreachableBasenames = new Set(
    patterns.filter((p) => p.pattern === 'unreachable').map((p) => p.ruleId.slice(0, p.ruleId.lastIndexOf(':'))),
  );

  // null-guard-default: keyed by "node|basename:N" for ordinaryWriters filtering.
  const nullGuardDefaultKeys = new Set(
    patterns.filter((p) => p.pattern === 'null-guard' && p.variant === 'default').map((p) => `${p.node}|${p.ruleId}`),
  );

  // Genuine cycles: self-loop (has node, no nodes array) and multi-hop (has nodes, no variant).
  const genuineCyclePaths = new Set([
    ...patterns.filter((p) => p.pattern === 'cycle' && p.node && !p.nodes).map((p) => p.node),
    ...patterns.filter((p) => p.pattern === 'cycle' && p.nodes && !p.variant).flatMap((p) => p.nodes),
  ]);

  // Collection-accumulation: Corticon iterative pattern (total = total + item.field)
  // translates directly to sum(collection, 'field') -- not a genuine cycle.
  const collectionAccumulationByPath = new Map();
  for (const p of patterns.filter((f) => f.pattern === 'scalar-accumulator')) {
    const writtenEntity = p.node.split('.')[0].toLowerCase();
    const { rulesheet: rsKey, ruleIndex: rsRuleIndex } = parseRuleId(p.ruleId);
    const rs = rulesheets.get(resolveRulesheet(rsKey));
    const rule = rs?.rules[rsRuleIndex];
    for (const action of (rule?.actions ?? []).filter(Boolean)) {
      const actionReads = (action.referencedTerms ?? []).map((t) => canonicalAttributePath(t)).filter(Boolean);
      const collRead = actionReads.find((r) => r.split('.')[0].toLowerCase() !== writtenEntity);
      if (!collRead) continue;
      const collField = collRead.split('.')[1];
      const collTerm = action.referencedTerms?.find((t) => canonicalAttributePath(t) === collRead);
      const rawEntityName = collTerm?.parent?.datatype ?? collRead.split('.')[0];
      const collectionEntity = rawEntityName.charAt(0).toLowerCase() + rawEntityName.slice(1);
      collectionAccumulationByPath.set(p.node, { collectionEntity, collectionField: collField });
      break;
    }
  }

  const unclassifiedCyclePaths = new Set(
    patterns.filter((p) => p.pattern === 'cycle' && p.variant === 'unclassified' && p.nodes).flatMap((p) => p.nodes),
  );

  // hit-policy-unverified: keyed by "node|basename" (strip ':*' from ruleId).
  const hitPolicyUnverifiedKeys = new Set(
    patterns.filter((p) => p.pattern === 'hit-policy-unverified').map((p) => `${p.node}|${p.ruleId.slice(0, p.ruleId.lastIndexOf(':'))}`),
  );

  // composition: keyed by node, value is the ruleIds array.
  const assemblyRulesheetsByPath = new Map(
    patterns.filter((p) => p.pattern === 'composition').map((a) => [a.node, a.ruleIds]),
  );

  // Build path → datatype map from vocabulary for writable fact annotations.
  const vocabDatatypeByPath = new Map();
  for (const [, vocab] of entriesOf(project.vocabularies)) {
    for (const [entityName, entity] of entriesOf(vocab.entities)) {
      for (const [attrName, attr] of entriesOf(entity.attributes)) {
        if (attr.dataType) vocabDatatypeByPath.set(`${entityName}.${attrName}`, attr.dataType);
      }
    }
  }

  // Corticon vocabulary type → JSON Schema fragment. Inline (not imported from
  // translate-project.js, which is a CLI script, not a library).
  const PRIMITIVE_TYPE_MAP = {
    Integer: 'integer',
    Decimal: 'number', Float: 'number', Real: 'number', Double: 'number',
    String: 'string', Text: 'string',
    Boolean: 'boolean', boolean: 'boolean',
  };
  const vocabCustomTypes = new Map();
  for (const [, vocab] of entriesOf(project.vocabularies)) {
    for (const [typeName, typeInfo] of entriesOf(vocab.customTypes ?? {})) {
      vocabCustomTypes.set(typeName, typeInfo);
    }
  }
  function corticonTypeToJsonSchema(cortType) {
    if (!cortType) return null;
    if (PRIMITIVE_TYPE_MAP[cortType]) return { type: PRIMITIVE_TYPE_MAP[cortType] };
    if (cortType === 'Date') return { type: 'string', format: 'date' };
    if (cortType === 'DateTime') return { type: 'string', format: 'date-time' };
    if (cortType === 'Time') return { type: 'string', format: 'time' };
    const ct = vocabCustomTypes.get(cortType);
    if (ct?.isEnum) {
      const result = { type: 'string', enum: ct.values };
      if (ct.entries?.some((e) => e.label)) result.enumDescriptions = ct.entries.map((e) => e.label ?? '');
      return result;
    }
    return null;
  }
  // Infer enum types from EnumType#Literal syntax in opaqueExpression text.
  // Mirrors the same logic in translate-project.js — see that file for the full comment.
  const ENUM_LIT_RE = /\b([A-Za-z_]\w*)#[A-Za-z_]\w*/g;
  for (const [, rulesheet] of entriesOf(project.rulesheets)) {
    for (const rule of rulesheet.rules ?? []) {
      for (const cell of [...(rule.conditions ?? []), ...(rule.actions ?? [])].filter(Boolean)) {
        if (!cell.expression) continue;
        const enumTypeNames = new Set();
        for (const m of cell.expression.matchAll(ENUM_LIT_RE)) {
          if (vocabCustomTypes.has(m[1])) enumTypeNames.add(m[1]);
        }
        if (!enumTypeNames.size) continue;
        const [enumTypeName] = enumTypeNames;
        for (const term of [...(cell.modifiedTerms ?? []), ...(cell.referencedTerms ?? [])]) {
          if (term.termtype !== 'ATTRIBUTE') continue;
          const path = canonicalAttributePath(term);
          if (!path) continue;
          const existing = vocabDatatypeByPath.get(path);
          if (!existing || existing === 'String' || existing === 'Text') {
            vocabDatatypeByPath.set(path, enumTypeName);
          }
        }
      }
    }
  }

  // Returns compiled JSON Schema properties for a path (spread onto compiled sub-object).
  const jt = (path) => {
    const cortType = vocabDatatypeByPath.get(path);
    if (!cortType) return {};
    const schema = corticonTypeToJsonSchema(cortType);
    return schema ?? {};
  };

  const facts = [];
  const translationLog = [];

  // classification.entityCreation is the complete, authoritative source for
  // entity-creation translation log entries -- reported directly and unconditionally here,
  // not derived from graph.writes. An earlier version of this function only pushed
  // an entity-creation translation log entry from inside the per-path loop below, keyed off
  // whatever graph.writes happened to enumerate -- but a real association-mutation
  // action (`Person.cohort += Cohort.newUnique[...]`, confirmed real in DC Medicaid's
  // MAGI Eligibility Groups.ers) has no resolvable scalar ATTRIBUTE term at all, so it
  // never becomes a graph.writes entry (the same real gap entity-creation-classifier.js's
  // own comment documents for why it scans rulesheets directly instead of the graph).
  // That meant this real, correctly-classified finding was silently missing from the
  // translation log output entirely -- not flagged, not thrown, just absent. Fixed by making
  // this list itself the source of truth, so completeness doesn't depend on whether
  // graph.writes happens to enumerate a matching path.
  //
  // Two variants now (see entity-creation-classifier.js and translation-patterns.yaml):
  // - input: association is also read downstream -- caller-contract, same note as before.
  // - output: association is only written -- a collection the response body should
  //   contain. A fact is generated for it (with entityCreationOutput: true) and the
  //   association path is recorded so the per-path loop below can cross-reference the
  //   scalar attribute paths back to this collection fact.
  const entityCreationOutputByAssocPath = new Map(); // assocPath -> entry
  const entityCreationOutputByScalarPath = new Map(); // scalar Corticon path -> entry

  for (const entry of constructorFindings) {
    if (entry.variant === 'output' && entry.node) {
      const assocFactPath = fpFromCanonical(entry.node);
      // Find the action to capture the Corticon expression and compile the guard.
      const { rulesheet: rsKey, ruleIndex: rsRuleIndex } = parseRuleId(entry.ruleId);
      const rulesheet = rulesheets.get(resolveRulesheet(rsKey));
      const rule = rulesheet?.rules[rsRuleIndex];
      const action = rule?.actions.filter(Boolean).find((a) =>
        (a.modifiedTerms ?? []).some((t) => t.termtype === 'ENTITY' && t.fulltext === entry.node)
      );
      const filterGuard = action ? compileFilterGuard(rulesheet, parseExpression) : null;
      const guard = action && rule ? compileGuard(rule, filterGuard, parseExpression) : null;
      // Capture the scalar attribute paths set on the new entity for cross-referencing.
      for (const term of (action?.modifiedTerms ?? []).filter((t) => t.termtype === 'ATTRIBUTE')) {
        entityCreationOutputByScalarPath.set(term.fulltext, entry);
      }
      entityCreationOutputByAssocPath.set(entry.node, entry);
      facts.push({
        path: assocFactPath,
        entityCreationOutput: true,
        entityType: entry.entityType,
        guard: guard ?? null,
        // Raw Corticon expression — not yet translated to CEL (collection output
        // expression form is not yet settled in the DSL spec).
        expression: action?.expression ?? null,
      });
      translationLog.push({
        edgeId: entry.ruleId,
        node: entry.node,
        pattern: 'constructor-output',
        status: statusFor('constructor-output'),
        translated: false,
        raw: { type: entry.entityType, expression: action?.text ?? null },
      });
    } else {
      translationLog.push({
        edgeId: entry.ruleId,
        pattern: 'constructor-input',
        status: statusFor('constructor-input'),
        translated: false,
        raw: { type: entry.entityType },
      });
    }
  }

  for (const p of patterns.filter((f) => f.pattern === 'no-op')) {
    translationLog.push({ edgeId: p.ruleId, pattern: 'no-op', status: statusFor('no-op'), translated: false });
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
  for (const p of patterns.filter((f) => f.pattern === 'unreachable')) {
    translationLog.push({ edgeId: p.ruleId, pattern: 'unreachable', status: statusFor('unreachable'), translated: false });
  }

  // Expression-level patterns (date arithmetic, rounding, sorting, etc.) — reported
  // directly so a reviewer has an explicit list of which constructs depend on proposed
  // CEL functions, independent of whether the rule ends up excluded for another reason.
  const expressionLevelPatterns = new Set(['date-arithmetic', 'rounding', 'sort', 'sort-rank', 'operator-precedence', 'logical-operators', 'membership-test', 'call-function', 'coercion']);
  for (const p of patterns.filter((f) => expressionLevelPatterns.has(f.pattern))) {
    translationLog.push({
      edgeId: p.ruleId,
      pattern: p.pattern,
      status: statusFor(p.pattern),
      translated: true,
      ...(p.variant ? { variant: p.variant } : {}),
      raw: { expression: p.expression },
    });
  }

  // Defensive, not yet confirmed real (see ruleflow-context.js's own comment) --
  // surfaced anyway per the same "don't let a real finding go unreported just
  // because it hasn't happened yet" principle as everything above.
  for (const entry of effectiveRuleflowContext.multiInvokedRulesheets ?? []) {
    translationLog.push({
      edgeId: basename(entry.rulesheet),
      pattern: 'context-conflict',
      status: statusFor('context-conflict'),
      translated: false,
      contexts: entry.contexts,
    });
  }

  for (const [path, writers] of entriesOf(graph.writes)) {
    if (collectionAccumulationByPath.has(path)) {
      const { collectionEntity, collectionField } = collectionAccumulationByPath.get(path);
      const factPath = fpFromCanonical(path);
      facts.push({ path: factPath, expression: `sum(${collectionEntity}, '${collectionField}')` });
      {
        const rawType = vocabDatatypeByPath.get(path);
        translationLog.push({
          node: path, pattern: 'aggregation', status: statusFor('aggregation'), translated: true,
          ...(rawType ? { raw: { type: rawType } } : {}),
          compiled: { ...jt(path), expression: `sum(${collectionEntity}, '${collectionField}')` },
        });
      }
      continue;
    }
    if (genuineCyclePaths.has(path)) {
      translationLog.push({ node: path, pattern: 'cycle', status: statusFor('cycle'), translated: false });
      continue;
    }
    if (unclassifiedCyclePaths.has(path)) {
      translationLog.push({ node: path, pattern: 'cycle-unclassified', status: statusFor('cycle-unclassified'), translated: false });
      continue;
    }


    // Entity-creation-tainted and unreachable-rulesheet writers never become part of
    // an ordinary Fact expression -- both already got their OWN translation log entry
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
    const ordinaryWriters = writers.filter((writer) => !entityCreationRuleKeys.has(`${basename(writer.rulesheet)}:${writer.ruleIndex}`) && !noOpRuleKeys.has(`${basename(writer.rulesheet)}:${writer.ruleIndex}`) && !unreachableBasenames.has(basename(writer.rulesheet)));
    if (ordinaryWriters.length === 0) {
      // If this scalar path is an attribute on an entity-creation output, cross-
      // reference it to the collection fact rather than flagging it as unresolvable.
      // The collection fact already captures the full output shape; this entry just
      // tells the visualizer which collection fact to point to for this scalar field.
      // Association path already handled in the entity-creation loop above -- skip silently.
      if (entityCreationOutputByAssocPath.has(path)) continue;
      const ecOutputEntry = entityCreationOutputByScalarPath.get(path);
      if (ecOutputEntry) {
        const assocFactPath = fpFromCanonical(ecOutputEntry.node);
        // Point factPath at the collection fact (not a per-field path) so the
        // visualizer's sourcePath→fact lookup finds the entity-creation output fact.
        const rawType = vocabDatatypeByPath.get(path);
        translationLog.push({
          node: path,
          pattern: 'constructor-output',
          status: statusFor('constructor-output'),
          translated: false,
          raw: { type: ecOutputEntry.entityType, ...(rawType ? { sourceType: rawType } : {}) },
        });
        continue;
      }
      const excludedEdgeIds = [...new Set(writers.map((w) => w.rulesheet))];
      {
        const rawType = vocabDatatypeByPath.get(path);
        translationLog.push({
          node: path,
          pattern: 'no-writer',
          status: statusFor('no-writer'),
          translated: false,
          ...(rawType ? { raw: { type: rawType } } : {}),
          excludedEdgeIds,
        });
      }
      continue;
    }

    // Null-check-masking: translates directly to an expression fact. The null-check
    // condition in Corticon ("if field = null, set field = value") is Corticon's
    // forward-chaining re-fire guard -- redundant in reverse-chaining where the
    // expression is simply evaluated. The action value IS the expression. If more
    // than one turns up from the SAME rulesheet,
    // it's a null-guard-decision-table: every row in a decision table guards on
    // `field = null` to prevent re-firing in Corticon's forward-chaining engine once
    // a value is set. The null-guard is redundant in reverse-chaining -- these compile
    // as a regular decision table with the null-guard condition included in each branch
    // (semantically correct: each branch fires only when no prior branch has matched,
    // which is what the null-guard achieves in forward-chaining). Confirmed real in
    // CBMS Disaster FS's COM_POSTPGM_IntakeXYZindicator.ers.
    const maskingWriters = ordinaryWriters.filter((w) => nullGuardDefaultKeys.has(`${path}|${basename(w.rulesheet)}:${w.ruleIndex}`));
    if (maskingWriters.length > 1) {
      {
        const rawType = vocabDatatypeByPath.get(path);
        translationLog.push({
          node: path,
          pattern: 'null-guard-table',
          status: statusFor('null-guard-table'),
          translated: true,
          ...(rawType ? { raw: { type: rawType } } : {}),
        });
      }
      // Fall through: maskingWriters are already included in ordinaryWriters and will
      // be compiled by the decision-table path below. No continue.
    }
    // Single masking writer: its CEL becomes the final fallback for any other writers
    // of this path (e.g. enum-branch-b.ers computes the real value; null-default.ers
    // covers the case where none of those conditions matched). If no other writers
    // exist, the masking CEL is the sole expression.
    let maskingFallbackCel = null;
    if (maskingWriters.length === 1) {
      const [maskingWriter] = maskingWriters;
      const rs = rulesheets.get(maskingWriter.rulesheet);
      const action = findActionForPath(rs.rules[maskingWriter.ruleIndex], path);
      if (!action) throw new Error(`No action in ${maskingWriter.rulesheet}'s rule ${maskingWriter.ruleIndex} actually writes "${path}" -- graph/classification and the real rule data have gone out of sync`);
      maskingFallbackCel = compileActionCel(action, parseExpression, domain, graphName);
      {
        const rawType = vocabDatatypeByPath.get(path);
        translationLog.push({
          node: path, pattern: 'null-guard-fallback', status: statusFor('null-guard-fallback'), translated: true,
          ...(rawType ? { raw: { type: rawType, expression: action?.text ?? null } } : { raw: { expression: action?.text ?? null } }),
        });
        translationLog.push({
          edgeId: `${basename(maskingWriter.rulesheet)}:${maskingWriter.ruleIndex}`,
          node: path, pattern: 'null-guard-default', status: statusFor('null-guard-default'), translated: true,
          ...(rawType ? { raw: { type: rawType, expression: action?.text ?? null } } : {}),
          compiled: { ...jt(path), expression: maskingFallbackCel },
        });
      }
    }

    // Exclude the single masking writer from main compilation -- its CEL is the fallback.
    const compilationWriters = maskingFallbackCel !== null
      ? ordinaryWriters.filter((w) => !(w.rulesheet === maskingWriters[0].rulesheet && w.ruleIndex === maskingWriters[0].ruleIndex))
      : ordinaryWriters;

    if (compilationWriters.length === 0) {
      // Pure null-default: no other writers -- the masking CEL is the sole expression.
      const factPath = fpFromCanonical(path);
      facts.push({ path: factPath, expression: maskingFallbackCel });
      continue;
    }

    const effectiveFallback = maskingFallbackCel ?? 'unresolved()';

    // Group the remaining ordinary writers by rulesheet, building each rulesheet's
    // own { guard, value } entries (decision-table-combinatorics-aware if more than
    // one rule contributes), then chain across rulesheets if this path is
    // cross-rulesheet-assembled. Sorted by REAL ruleflow invocation order, most
    // recently invoked first -- see compileAcrossRulesheets's own comment for why.
    const rulesheetKeysInOrder = [...new Set(compilationWriters.map((w) => w.rulesheet))].sort((a, b) => {
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
      const ruleIndices = compilationWriters.filter((w) => w.rulesheet === rulesheetKey).map((w) => w.ruleIndex);
      const isHitPolicyUnverified = hitPolicyUnverifiedKeys.has(`${path}|${basename(rulesheetKey)}`);
      if (isHitPolicyUnverified) {
        // Surfaced in the actual translation log output, not just a source comment -- see
        // compileRulesheetEntries's own doc comment for the real, cited reasoning
        // (Corticon's default UNIQUE hit policy) and the real, confirmed gap (Rule
        // Order hit policy isn't detectable from the file format at all).
        {
          const rawType = vocabDatatypeByPath.get(path);
          translationLog.push({
            edgeId: `${basename(rulesheetKey)}:*`,
            node: path,
            pattern: 'hit-policy-unverified',
            status: statusFor('hit-policy-unverified'),
            translated: true,
            ...(rawType ? { raw: { type: rawType } } : {}),
          });
        }
      }
      const rulesheetEntries = compileRulesheetEntries(rulesheetKey, rulesheet, ruleIndices, path, parseExpression, domain, graphName);
      if (hasOutOfOrderUnconditional(rulesheetEntries)) {
        // Confirmed real, not hypothetical: this fixture's own ProgramAEligibility.ers
        // has its unconditional row FIRST, not last -- see chainEntries' own comment
        // for the real silent-wrong-compilation bug this shape used to cause. The
        // compiled result is now correct (unconditional treated as the fallback
        // regardless of position), but no confirmed golden-master trace proves
        // Corticon's real semantics match this compiled interpretation for this
        // specific out-of-order shape, unlike the far more common "unconditional row
        // last" case -- flagged for manual review, not assumed silently equivalent.
        {
          const rawType = vocabDatatypeByPath.get(path);
          translationLog.push({
            edgeId: basename(rulesheetKey),
            node: path,
            pattern: 'unconditional-row-out-of-order',
            status: statusFor('unconditional-row-out-of-order'),
            translated: true,
            ...(rawType ? { raw: { type: rawType } } : {}),
          });
        }
      }
      entriesByRulesheet.set(rulesheetKey, rulesheetEntries);
    }

    const assemblyRuleIds = assemblyRulesheetsByPath.get(path);
    if (assemblyRuleIds && assemblyRuleIds.length !== rulesheetKeysInOrder.length) {
      // Confirmed possible, and confirmed real for the unreachable-rulesheet case
      // (DC Medicaid/CHIP's dead Non-MAGI Eligibility Groups.ers is one of
      // Person.outputCoverage1's assembling rulesheets): entity-creation or
      // unreachable-rulesheet exclusion above can drop a rulesheet's writers
      // entirely, leaving fewer rulesheets here than classification originally
      // found. Surfaced explicitly rather than silently compiling against a shrunk
      // set without saying so.
      translationLog.push({
        node: path,
        pattern: 'composition-mismatch',
        status: statusFor('composition-mismatch'),
        translated: true,
        note: `Expected ${assemblyRuleIds.length} rulesheets, got ${rulesheetKeysInOrder.length}`,
      });
    }

    const { cel, hasFallback } = assemblyRuleIds && assemblyRuleIds.length > 1
      ? compileAcrossRulesheets(rulesheetKeysInOrder, entriesByRulesheet, effectiveFallback)
      : chainEntries(entriesByRulesheet.get(rulesheetKeysInOrder[0]), effectiveFallback);

    // Only flag no-fallback-row when neither the compiled chain NOR the masking
    // fallback provides a catch-all -- if a masking fallback exists it always covers
    // the unmatched case.
    if (!hasFallback && maskingFallbackCel === null) {
      const rawType = vocabDatatypeByPath.get(path);
      translationLog.push({ node: path, pattern: 'no-default', status: statusFor('no-default'), translated: true, ...(rawType ? { raw: { type: rawType } } : {}) });
    }
    facts.push({ path: fpFromCanonical(path), expression: cel });
    {
      const rawExpressions = [...entriesByRulesheet.values()].flat().map(e => e.rawExpression).filter(Boolean);
      const rawType = vocabDatatypeByPath.get(path);
      translationLog.push({
        node: path, pattern: 'derived', status: statusFor('derived'), translated: true,
        raw: { ...(rawType ? { type: rawType } : {}), ...(rawExpressions.length ? { expression: rawExpressions.length === 1 ? rawExpressions[0] : rawExpressions } : {}) },
        compiled: { ...jt(path), expression: cel },
      });
    }
  }

  // The main loop above only ever walks graph.writes -- every Vocabulary attribute
  // with no writer at all (a pure input) never appears there, so it needs its own
  // pass to become a plain Writable Fact rather than being silently absent. See
  // enumerateVocabularyAttributes's own comment for the confirmed real gap this
  // closes.
  const writtenPaths = new Set(entriesOf(graph.writes).map(([writtenPath]) => writtenPath));
  for (const path of enumerateVocabularyAttributes(project)) {
    if (writtenPaths.has(path)) continue;
    const datatype = vocabDatatypeByPath.get(path);
    facts.push({ path: fpFromCanonical(path), writable: true, ...(datatype ? { datatype } : {}) });
    {
      const rawType = vocabDatatypeByPath.get(path);
      const compiledSchema = jt(path);
      translationLog.push({
        node: path, pattern: 'input', status: statusFor('input'), translated: true,
        ...(rawType ? { raw: { type: rawType } } : {}),
        ...(Object.keys(compiledSchema).length ? { compiled: { ...compiledSchema } } : {}),
      });
    }
  }

  for (const p of patterns.filter((f) => f.pattern === 'guard')) {
    // The filter's own condition IS folded into every affected Fact's compiled guard
    // (see compileFilterGuard) -- this note flags the narrower remaining gap: the
    // full-vs-limiting cascade behavior (does an empty-after-filter collection
    // exclude the whole parent entity, not just the filtered alias?) still isn't
    // resolvable from static file inspection (issue #388's own flagged open item).
    translationLog.push({ edgeId: p.ruleId, pattern: 'guard', status: statusFor('guard'), translated: true, raw: { expression: p.expression } });
  }
  for (const p of patterns.filter((f) => f.pattern === 'call')) {
    const pattern = `call-${p.variant ?? 'opaque'}`;
    translationLog.push({ edgeId: p.ruleId, node: p.node, pattern, status: statusFor(pattern), translated: false, connector: p.connector });
  }

  // Post-process: fill in node + compiled on expression-level entries.
  // These entries are pushed before the main loop so they don't have the compiled CEL yet.
  // Build edgeId → node from graph.writes, then node → compiled from derived entries.
  const nodeByEdgeId = new Map();
  for (const [path, writers] of entriesOf(graph.writes)) {
    for (const w of writers) nodeByEdgeId.set(`${basename(w.rulesheet)}:${w.ruleIndex}`, path);
  }
  const compiledByNode = new Map();
  for (const entry of translationLog) {
    if (entry.pattern === 'derived' && entry.node && entry.compiled) compiledByNode.set(entry.node, entry.compiled);
  }
  for (const entry of translationLog) {
    if (expressionLevelPatterns.has(entry.pattern) && entry.edgeId && !entry.compiled) {
      const node = nodeByEdgeId.get(entry.edgeId);
      if (node) {
        entry.node = node;
        const compiled = compiledByNode.get(node);
        if (compiled) entry.compiled = compiled;
      }
    }
  }

  return { facts, translationLog };
}
