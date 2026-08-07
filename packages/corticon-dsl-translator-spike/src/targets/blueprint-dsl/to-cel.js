/**
 * Generic AST -> CEL string generator. Unlike corticon/expression-parser.js, this
 * file is engine-agnostic: it only ever touches the generic AST shape
 * (Identifier/Member/Call/BinaryOp/UnaryOp/Literal/Construction/Assignment), never
 * Corticon's own text syntax. A future engine's own expression parser could target
 * this same AST and reuse this file unmodified.
 *
 * Entity/alias identifiers are lowercased to match the decision-rules DSL's own
 * Fact-path convention (`household.wages`, not `Household.wages` -- see
 * decision-rules-dsl.md's Expression layer example). Confirmed real: Corticon
 * consistently capitalizes entity TYPE names (Household, Person, Cohort) and uses
 * lowercase ALIASES (loanapp, liability) interchangeably depending on which
 * rulesheet's own logicalVariable naming is in play -- lowercasing only the first
 * letter handles both forms correctly without needing a vocabulary lookup: an
 * already-lowercase alias is untouched, a capitalized type name is lowercased.
 */

function lowerFirst(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function rootIdentifierName(node) {
  if (node.type === 'Identifier') return lowerFirst(node.name);
  if (node.type === 'Member' || node.type === 'Call') return rootIdentifierName(node.object);
  throw new Error(`Cannot determine a bound variable name for this expression shape: ${JSON.stringify(node)}`);
}

// `**` (exponentiation) is deliberately absent here -- CEL has no native `**`
// operator at all, so it can't be a simple infix substitution the way every other
// entry is; see translateBinaryOp's own special case for it, mapped to a PROPOSED
// `pow(base, exponent)` custom function, same status as round/yearsBetween/etc.
const BINARY_OPERATOR_CEL = {
  '=': '==',
  '!=': '!=',
  '>=': '>=',
  '<=': '<=',
  '>': '>',
  '<': '<',
  '+': '+',
  '-': '-',
  '*': '*',
  '/': '/',
  // CEL's real native logical operators -- confirmed, not proposed.
  and: '&&',
  or: '||',
};

// Table-driven translators for `->` (arrow/collection) no-arg property access.
// Keyed by property name -- adding a newly-confirmed real collection operation is a
// one-line addition here, not a change to translateMember's own logic.
const ARROW_MEMBER_TRANSLATORS = {
  // CEL's `size()` is a function, not a method -- confirmed real: Mortgage's
  // `liability->size >= 3`.
  size: (objectNode) => `size(${toCel(objectNode)})`,
  // CEL has no `.isEmpty` -- confirmed real: DC Medicaid's `Person.cohort->isEmpty`.
  isEmpty: (objectNode) => `size(${toCel(objectNode)}) == 0`,
  // CEL has no `.notEmpty` either -- confirmed real: DC Medicaid's real rulesheet
  // filter in Parse Cohorts.ers, `cohorts->notEmpty`.
  notEmpty: (objectNode) => `size(${toCel(objectNode)}) != 0`,
};

// Table-driven translators for `.` (dot) no-arg property access that are actually
// conversion methods, not attributes -- confirmed real Corticon usage renders these
// WITHOUT trailing parens (`Person.householdFPL.toString`, not `.toString()`), so
// they parse as a Member node, never a Call. Registering them under
// DOT_CALL_TRANSLATORS (which only fires when the parser sees a `(`) would leave this
// real shape to fall through to the generic dot-passthrough below and silently
// mistranslate `.toString` as a bogus literal field reference instead of a real
// string() conversion -- exactly the kind of silent wrong-output this whole design
// is meant to avoid. Any OTHER dot-navigated name not in this table is treated as an
// ordinary attribute (correct: Corticon entities can have arbitrarily-named
// attributes, so that generic case can't be a fixed vocabulary to validate against).
const DOT_MEMBER_TRANSLATORS = {
  toString: (objectNode) => `string(${toCel(objectNode)})`,
  toInteger: (objectNode) => `int(${toCel(objectNode)})`,
  // Date navigation to start/end of the month containing a DateTime value.
  // Confirmed real in CBMS Disaster FS: `runDate.addMonths(-3).getFirstOfCurrentMonth`,
  // `individualDeathDate.getEndOfCurrentMonth`. PROPOSED custom CEL function names.
  getFirstOfCurrentMonth: (objectNode) => `firstOfMonth(${toCel(objectNode)})`,
  getEndOfCurrentMonth: (objectNode) => `endOfMonth(${toCel(objectNode)})`,
};

// Table-driven translators for `.` (dot) method calls WITH arguments (i.e. real
// confirmed usage always renders these with parens). Corticon's rounding/date-
// arithmetic methods have no CEL native equivalent (confirmed real gap --
// decision-rules-dsl.md's Decision 4 leaves the exact function names open, pending
// exactly this kind of real-usage discovery). The names below are PROPOSED custom
// CEL functions feeding back into that still-open decision, not settled fact.
const DOT_CALL_TRANSLATORS = {
  round: (objectNode, argNodes) => `round(${toCel(objectNode)}, ${toCel(argNodes[0])})`,
  yearsBetween: (objectNode, argNodes) => `yearsBetween(${toCel(objectNode)}, ${toCel(argNodes[0])})`,
  monthsBetween: (objectNode, argNodes) => `monthsBetween(${toCel(objectNode)}, ${toCel(argNodes[0])})`,
  addYears: (objectNode, argNodes) => `addYears(${toCel(objectNode)}, ${toCel(argNodes[0])})`,
  addMonths: (objectNode, argNodes) => `addMonths(${toCel(objectNode)}, ${toCel(argNodes[0])})`,
  addDays: (objectNode, argNodes) => `addDays(${toCel(objectNode)}, ${toCel(argNodes[0])})`,
  // Compares a DateTime against an integer YYYYMM month value, returning true if
  // the date falls in that month. Confirmed real in CBMS Disaster FS:
  // `program.runDate.compareYYYYMMMonth(ppIndvEligRslt.payMnth.toInteger)`.
  // PROPOSED custom CEL function name -- feeds back into DSL decision 4.
  compareYYYYMMMonth: (objectNode, argNodes) => `compareYYYYMMMonth(${toCel(objectNode)}, ${toCel(argNodes[0])})`,
  // CEL natively supports `.contains(...)` on strings -- confirmed real: DC
  // Medicaid's `Person.outputCoverage1.contains('ineligible')`.
  contains: (objectNode, argNodes) => `${toCel(objectNode)}.contains(${toCel(argNodes[0])})`,
};

// Table-driven translators for `->` (arrow) method calls with arguments.
const ARROW_CALL_TRANSLATORS = {
  // CEL's native `.exists(x, predicate)` macro needs an explicit bound variable name
  // that Corticon's own text doesn't have -- confirmed real, Corticon's predicate
  // always reuses the same alias as the outer collection reference (Mortgage's
  // `liability->exists(liability.highCreditAmount >= 2500.0)`), so reusing that same
  // name as CEL's bound variable produces a faithful, if a little unusually-shadowed,
  // translation rather than inventing an unrelated name.
  exists: (objectNode, argNodes) => `${toCel(objectNode)}.exists(${rootIdentifierName(objectNode)}, ${toCel(argNodes[0])})`,
};

// `X->sortedBy(key)->first` / `X->sortedBy(key)->at(n)` -- confirmed real in DC
// Medicaid's Parse Cohorts.ers and this fixture's own ProgramRanking.ers, always
// picking the best- or nth-best-ranked element by a single bare attribute key, never
// a compound key expression. CEL has no native equivalent (confirmed real gap, and
// per decision-rules-dsl.md's Decision 4, unlike currency/date arithmetic there's no
// Fact Graph precedent to lean on for general sorting -- but every real usage found
// is specifically "pick the nth-best by one key," matching Decision 4's own
// suggestion of a narrower Maximum/Minimum-style operator over a fully generic sort).
// `nthByKey` below is a PROPOSED custom CEL function feeding back into that decision,
// not settled fact. `->first` is expressed as rank 1, `->at(n)` as rank n, both via
// the same function, since real usage treats them as the same operation.
//
// `->at(n)` is 1-based, not 0-based -- checked, not assumed. No fixture in this spike
// exercises rank > 1 with a populated captured trace (confirmed by direct inspection:
// DC Medicaid/CHIP's own Test.ert never has a person matching more than one cohort),
// and a live search for a better example (two passes: targeted for `->at(` usage,
// then broadened specifically hunting for a populated trace near `sortedBy`/ranking
// content) found no real Corticon project on GitHub with an executed trace covering
// this either. What WAS found, real and structural even without executed output:
// (1) `corticon/corticon-classic-samples`, "Ranking and Ordering" project,
// `Ranking children - looping.ers` -- a loop initializes `Family.counter = 1` and
// uses it directly as `Children->sortedBy(dateOfBirth)->at(Family.counter).ranking`
// with no offset, so the first pass (counter=1) ranks the element at `at(1)`;
// (2) `Seth-Meldon/criticality`, "Health Risk" project, `Complex Test T2-1 Turns
// Ratio Test.ers` -- `this_assessment.date = ...->sortedByDesc(date)->first.date` and
// `last_assessment.date = ...->sortedByDesc(date)->at(2).date`, where "last_assessment"
// (semantically: the one immediately before this one) only makes sense as `at(2)`
// under 1-based indexing -- 0-based would put "last_assessment" at whatever `->at(1)`
// is instead, one earlier than `->first`, contradicting `->first` itself meaning the
// same element as `at(1)` would under 0-based numbering being "the second element."
// Two independent real examples, from two unrelated projects/authors, no
// counter-evidence found -- treated as confirmed on that basis, not a guess.
function isSortedByCall(node) {
  return node?.type === 'Call' && node.navigation === 'arrow' && node.property === 'sortedBy';
}

function matchSortedByRanked(node) {
  if (node.type === 'Member' && node.navigation === 'arrow' && node.property === 'first' && isSortedByCall(node.object)) {
    return { sortedByCall: node.object, rank: { type: 'Literal', kind: 'number', value: 1 } };
  }
  if (node.type === 'Call' && node.navigation === 'arrow' && node.property === 'at' && isSortedByCall(node.object)) {
    return { sortedByCall: node.object, rank: node.args[0] };
  }
  return null;
}

function translateSortedByRanked({ sortedByCall, rank }) {
  const [keyExpr] = sortedByCall.args;
  if (keyExpr.type !== 'Member' || keyExpr.navigation !== 'dot') {
    throw new Error(`Unsupported sortedBy key expression -- only a bare attribute reference is currently supported, got: ${JSON.stringify(keyExpr)}`);
  }
  return `nthByKey(${toCel(sortedByCall.object)}, '${keyExpr.property}', ${toCel(rank)})`;
}

// `X.field->sum` -- confirmed real in this fixture's own ComputeIncome.ers
// (`applicant.income->sum`, summing `income` across the whole `applicant`
// collection). CEL has no native aggregate; a bare `->sum` with no preceding field
// access has no confirmed real example, so only this two-node shape is matched --
// anything else falls through to the generic dispatch below and throws, rather than
// guessing at a translation for an unconfirmed shape. `sum` below is a PROPOSED
// custom CEL function, same status as `nthByKey`/`round`/`yearsBetween` above.
function matchFieldSum(node) {
  if (node.type === 'Member' && node.navigation === 'arrow' && node.property === 'sum' && node.object.type === 'Member' && node.object.navigation === 'dot') {
    return { collectionNode: node.object.object, fieldName: node.object.property };
  }
  return null;
}

function translateFieldSum({ collectionNode, fieldName }) {
  return `sum(${toCel(collectionNode)}, '${fieldName}')`;
}

function translateLiteral(node) {
  if (node.kind === 'string') return `'${node.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (node.kind === 'null') return 'null';
  return String(node.value);
}

// Corticon's real `X in (lower..upper]`-style range membership has no CEL native
// equivalent, but unlike round/yearsBetween/nthByKey/sum above, it needs no proposed
// custom function at all -- it translates fully and faithfully into CEL's own native
// comparison operators, just expanded into their compound boolean form.
function translateRangeMembership(node) {
  const value = toCel(node.value);
  const lowerOp = node.lowerInclusive ? '>=' : '>';
  const upperOp = node.upperInclusive ? '<=' : '<';
  return `${value} ${lowerOp} ${toCel(node.lower)} && ${value} ${upperOp} ${toCel(node.upper)}`;
}

function translateBinaryOp(node) {
  // `**` can't be a simple infix substitution -- CEL has no native exponentiation
  // operator at all, unlike every other entry in BINARY_OPERATOR_CEL.
  if (node.operator === '**') return `pow(${toCel(node.left)}, ${toCel(node.right)})`;
  const operator = BINARY_OPERATOR_CEL[node.operator];
  if (!operator) throw new Error(`Unsupported operator "${node.operator}"`);
  return `${toCel(node.left)} ${operator} ${toCel(node.right)}`;
}

function translateMember(node) {
  if (node.navigation === 'arrow') {
    const translator = ARROW_MEMBER_TRANSLATORS[node.property];
    if (!translator) throw new Error(`Unsupported collection operation "->${node.property}" -- not yet confirmed real or supported`);
    return translator(node.object);
  }
  const conversionTranslator = DOT_MEMBER_TRANSLATORS[node.property];
  if (conversionTranslator) return conversionTranslator(node.object);
  return `${toCel(node.object)}.${node.property}`;
}

function translateCall(node) {
  const table = node.navigation === 'arrow' ? ARROW_CALL_TRANSLATORS : DOT_CALL_TRANSLATORS;
  const translator = table[node.property];
  if (!translator) {
    // Java extension calls: `ClassName.methodName(...)` where the object is a bare
    // uppercase Identifier (e.g. EligUtility.getLastMonth, Allotment.getMaximumAllotmentAmount).
    // These are caller-contract or DSL-function concerns, not translatable to native CEL.
    // Emit a clearly-labeled placeholder so the pipeline can complete and the translation log
    // can flag them, rather than hard-crashing the whole translate stage.
    if (node.navigation === 'dot' && node.object?.type === 'Identifier' && /^[A-Z]/.test(node.object.name)) {
      const argsCel = (node.args ?? []).map(toCel).join(', ');
      return `__ext_${node.object.name}_${node.property}(${argsCel})`;
    }
    const arrow = node.navigation === 'arrow';
    throw new Error(`Unsupported ${arrow ? 'collection operation "->' : 'method ".'}${node.property}(...)" -- not yet confirmed real or supported`);
  }
  return translator(node.object, node.args);
}

/** Translates a generic expression AST node (anything except a top-level Assignment -- see toCelStatement) into a CEL expression string. */
export function toCel(node) {
  const rankedMatch = matchSortedByRanked(node);
  if (rankedMatch) return translateSortedByRanked(rankedMatch);
  const sumMatch = matchFieldSum(node);
  if (sumMatch) return translateFieldSum(sumMatch);

  switch (node.type) {
    case 'Identifier':
      return lowerFirst(node.name);
    case 'Literal':
      return translateLiteral(node);
    case 'UnaryOp':
      // Corticon's real documented unary `not` is CEL's `!` -- a word operator
      // mapped to a symbol, unlike '-' which is already the same spelling in both.
      return `${node.operator === 'not' ? '!' : node.operator}${toCel(node.operand)}`;
    case 'BinaryOp':
      return translateBinaryOp(node);
    case 'RangeMembership':
      return translateRangeMembership(node);
    case 'Member':
      return translateMember(node);
    case 'Call':
      return translateCall(node);
    case 'Construction':
      throw new Error('Entity-creation/construction actions cannot be translated to a CEL expression -- these are orchestration-layer concerns, not Facts (see entity-creation-classifier.js)');
    case 'Assignment':
      throw new Error('Assignment nodes must be translated via toCelStatement, not toCel directly');
    default:
      throw new Error(`Unsupported AST node type: ${node.type}`);
  }
}

function pathSegments(node) {
  if (node.type === 'Identifier') return [lowerFirst(node.name)];
  if (node.type === 'Member' && node.navigation === 'dot') return [...pathSegments(node.object), node.property];
  throw new Error(`Cannot derive a Fact path from this expression shape: ${JSON.stringify(node)}`);
}

/** Renders a "EntityType.attribute" canonical attribute path string (see graph/attribute-path.js) as a decision-rules DSL Fact path, e.g. "Household.fpl110" -> "/household/fpl110". */
export function factPathFromCanonicalPath(path) {
  const [entity, ...rest] = path.split('.');
  return `/${[lowerFirst(entity), ...rest].join('/')}`;
}

/** Renders a Member/Identifier chain as a decision-rules DSL Fact path, e.g. Household.fpl110 -> "/household/fpl110". */
export function factPathOf(node) {
  return `/${pathSegments(node).join('/')}`;
}

/**
 * Given a parsed statement AST and whether the source cell was an ASSIGNMENT or an
 * EXPRESSION (per Corticon's own cell-level `expressiontype` metadata -- see
 * expression-parser.js's own comment on why the text alone can't disambiguate this),
 * returns either `{ targetPath, cel }` for an assignment, or `{ cel }` for a bare
 * boolean/value expression with no assignment target.
 */
export function toCelStatement(node, { isAssignment }) {
  if (node.type === 'Assignment') {
    return { targetPath: factPathOf(node.target), cel: toCel(node.value) };
  }
  if (isAssignment && node.type === 'BinaryOp' && node.operator === '=') {
    return { targetPath: factPathOf(node.left), cel: toCel(node.right) };
  }
  return { cel: toCel(node) };
}
