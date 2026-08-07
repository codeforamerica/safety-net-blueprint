import { parse } from './formula-parser.js';

/**
 * Set of entity/subject types that appear as the first signature element.
 * When the first sig element is one of these, the call arg at position 0 is
 * the entity variable (lowercased in CEL: person, case, month, day).
 */
const ENTITY_SIG_TYPES = new Set(['Person', 'Case', 'Month', 'Day']);

/**
 * Period types: these may appear anywhere in the signature as temporal
 * position markers. When they appear AFTER the entity (positions > 0),
 * the corresponding call arg is the period variable — consumed from the call
 * but not used in the fact path.
 */
const PERIOD_SIG_TYPES = new Set(['Month', 'Day', 'Eternity']);

/**
 * Primitive return types. When the last signature element is one of these,
 * it is the relation's return type and is NOT passed as a call argument.
 */
const PRIMITIVE_SIG_TYPES = new Set(['Integer', 'Money', 'Rate', 'Date', 'Boolean', 'String']);

/**
 * CEL binary operator precedences (higher = tighter binding).
 * Used to decide when to wrap sub-expressions in parentheses.
 */
const PREC = {
  or:  1,
  and: 2,
  '>=': 3, '<=': 3, '!=': 3, '=': 3, '>': 3, '<': 3,
  '+':  4, '-':  4,
  '*':  5,
};

function opPrec(op) { return PREC[op] ?? 0; }

/**
 * Returns the "binding precedence" of a node, used to decide whether to wrap
 * it in parentheses when it appears as a child of a binary operator.
 * Atoms (calls, identifiers, numbers) have infinite precedence — they never
 * need wrapping. Low-precedence constructs (implies, if-then-else) always do.
 */
function nodePrec(node) {
  if (node.type === 'Binary')    return opPrec(node.op);
  if (node.type === 'Implies')   return 0;
  if (node.type === 'IfThenElse') return 0;
  return Infinity; // atoms — no wrap needed
}

/**
 * Translates a rulespec formula string to a CEL expression string.
 *
 * @param {string} formulaStr - Raw formula text (may be multiline; comments stripped).
 * @param {{
 *   parameterNames: Set<string>,
 *   enumValues:     Set<string>,
 *   callables:      Map<string, { sigTypes: string[] }>,
 * }} ctx
 * @returns {string} CEL expression
 */
export function translateFormula(formulaStr, ctx) {
  const ast = parse(formulaStr.trim());
  return celOf(ast, ctx);
}

function celOf(ast, ctx) {
  switch (ast.type) {
    case 'Number':
      return String(ast.value);

    case 'String':
      return `'${ast.value}'`;

    case 'Identifier': {
      const { name } = ast;
      if (ctx.parameterNames.has(name)) return `parameter.${name}`;
      if (ctx.enumValues.has(name)) return `'${name}'`;
      // Entity/period variable (person, month, case, …) — pass through as-is.
      // These appear standalone only when used as a call argument; they should
      // not appear as top-level expressions. If they do, emit as-is.
      return name;
    }

    case 'List':
      throw new Error('List literal outside any_of() — unexpected in well-formed rulespec');

    case 'Unary': {
      if (ast.op !== 'not') throw new Error(`Unknown unary op: ${ast.op}`);
      const inner = celOf(ast.operand, ctx);
      // Wrap in parens if the operand is a binary/compound expression so that
      // '!' applies to the whole thing, not just the first token.
      const wrap = nodePrec(ast.operand) < Infinity;
      return wrap ? `!(${inner})` : `!${inner}`;
    }

    case 'Binary': {
      const { op, left, right } = ast;
      const cel_op = op === '='   ? '==' :
                     op === 'and' ? '&&'  :
                     op === 'or'  ? '||'  : op;
      const pPrec = opPrec(op);
      const lhs = celOf(left, ctx);
      const rhs = celOf(right, ctx);
      // Wrap left if it has strictly lower precedence than the parent op.
      const lWrap = nodePrec(left) < pPrec;
      // Wrap right if it has lower or equal precedence (left-associativity
      // means same-precedence on the right needs parens to preserve order).
      const rWrap = nodePrec(right) < pPrec || nodePrec(right) === pPrec;
      return `${lWrap ? `(${lhs})` : lhs} ${cel_op} ${rWrap ? `(${rhs})` : rhs}`;
    }

    case 'Implies': {
      // A implies B  →  (!A || B)
      const lhs = celOf(ast.left, ctx);
      const rhs = celOf(ast.right, ctx);
      const lWrap = nodePrec(ast.left) < Infinity;
      return `(${lWrap ? `!(${lhs})` : `!${lhs}`} || ${rhs})`;
    }

    case 'IfThenElse': {
      const cond = celOf(ast.cond, ctx);
      const then = celOf(ast.then, ctx);
      const els  = celOf(ast.else, ctx);
      return `(${cond} ? ${then} : ${els})`;
    }

    case 'Call':
      return translateCall(ast, ctx);

    default:
      throw new Error(`Unknown AST node type: ${ast.type}`);
  }
}

/**
 * Translates a function/relation call to CEL.
 *
 * Special built-in functions:
 *   any_of([A, B, C])  →  (A || B || C)
 *   min(a, b)          →  min(a, b)
 *   today()            →  today()
 *
 * Data-relation and derived-rule calls resolve to a CEL fact-path expression:
 *   entityVar.relationName[_discValue]*
 *
 * The fact path is determined by:
 *   1. First sig element → entity type; lowercased = entity var name.
 *   2. Non-last non-primitive enum sig elements after position 0 → discriminators.
 *      The call arg at that position is the enum value; appended with '_'.
 *   3. Period types (Month, Day, Eternity) after position 0 → time variable; skip.
 *   4. Primitive last element or enum last element → return type; not in call args.
 */
function translateCall(ast, ctx) {
  const { name, args } = ast;

  if (name === 'any_of') {
    if (args.length !== 1 || args[0].type !== 'List') {
      throw new Error('any_of() expects exactly one list argument');
    }
    const items = args[0].items.map(item => celOf(item, ctx));
    return `(${items.join(' || ')})`;
  }

  if (name === 'min') {
    return `min(${args.map(a => celOf(a, ctx)).join(', ')})`;
  }

  if (name === 'today') {
    return 'today()';
  }

  const callable = ctx.callables.get(name);
  if (!callable) {
    // Unknown callable — emit a raw call so the output is still parseable and
    // the error surfaces at CEL evaluation time rather than translation time.
    return `${name}(${args.map(a => celOf(a, ctx)).join(', ')})`;
  }

  const sig = callable.sigTypes;

  // The call args correspond to sig[0..N], where N may be sig.length-1 if the
  // last sig element is a return type (not passed as an argument). We align
  // call args to sig positions by taking only the first args.length positions.
  const callSig = sig.length > args.length ? sig.slice(0, args.length) : sig;

  let entityVar = null;
  const discValues = [];

  for (let i = 0; i < callSig.length; i++) {
    const sigType = callSig[i];
    const arg = args[i];

    if (i === 0 && ENTITY_SIG_TYPES.has(sigType)) {
      // Position 0 entity: the call arg is the entity variable name.
      entityVar = arg.type === 'Identifier' ? arg.name : celOf(arg, ctx);
    } else if (PERIOD_SIG_TYPES.has(sigType)) {
      // Period variable: skip — it's a temporal arg, not part of the fact path.
    } else if (!PRIMITIVE_SIG_TYPES.has(sigType)) {
      // Non-primitive, non-period: this is a discriminator enum value.
      // The call arg should be an identifier whose name is the enum value.
      const val = arg.type === 'Identifier' ? arg.name : celOf(arg, ctx);
      // Strip CEL quoting if translateIdentifier already turned it into 'val'
      const rawVal = val.startsWith("'") && val.endsWith("'") ? val.slice(1, -1) : val;
      discValues.push(rawVal);
    }
    // Primitive types in non-last positions would be unusual — skip them.
  }

  const suffix = discValues.length > 0 ? '_' + discValues.join('_') : '';
  const factKey = `${name}${suffix}`;

  if (entityVar) {
    return `${entityVar}.${factKey}`;
  }
  // No entity (e.g. Eternity-period case-state predicates with no entity arg).
  return factKey;
}
