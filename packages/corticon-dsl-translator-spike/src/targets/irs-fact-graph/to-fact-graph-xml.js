/**
 * Translate a schema-conformant graph.json to IRS fact-graph XML format.
 *
 * The IRS fact-graph format (github.com/IRS-Public/fact-graph) represents
 * decision logic as a dictionary of typed Facts, each either Writable (user
 * input) or Derived (computed expression). Expressions are XML tree ASTs using
 * elements like <All>, <Any>, <LessThan>, <Dependency>, etc.
 *
 * This module shows what our compact CEL-based graph format looks like when
 * translated to the XML-based format — demonstrating how much simpler our
 * representation is for the same decision logic.
 *
 * Path conventions:
 *   $.Entity.attr  →  /entity/attr   (Writable)
 *   Entity.name    →  /entity/name   (Derived)
 *   paramName      →  /paramName     (Derived constant)
 *
 * @module to-fact-graph-xml
 */

// ── Path helpers ───────────────────────────────────────────────────────────────

/**
 * Convert a graph node path to an IRS fact-graph path.
 *
 * The IRS fact-graph library only supports single-segment paths (e.g. /isUsCitizen).
 * Multi-segment paths like /household/isDestituteMigrant fail dependency resolution.
 * We flatten entity+attr into a single segment joined by underscore.
 *
 * Examples:
 *   $.Household.isDestituteMigrant → /household_isDestituteMigrant
 *   $.Expedited.resourceLimit      → /expedited_resourceLimit
 *   Expedited.passesLowIncomeTest  → /expedited_passesLowIncomeTest
 *   paramName                      → /paramName
 */
function nodePathToFgPath(nodePath) {
  const canonical = nodePath.startsWith('$.') ? nodePath.slice(2) : nodePath;
  const dot = canonical.indexOf('.');
  if (dot < 0) return '/' + canonical;
  const entity = canonical.slice(0, dot).toLowerCase();
  const attr = canonical.slice(dot + 1);
  return `/${entity}_${attr}`;
}

/** Fact-graph type declaration element for a node type string. */
function typeDecl(type) {
  if (type === 'boolean') return '<Boolean/>';
  if (type === 'integer') return '<Int/>';
  return '<Dollar/>'; // number / money / default
}

/** Escape XML special characters. */
function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── CEL tokenizer ──────────────────────────────────────────────────────────────

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }

    // Two-char operators
    const two = src.slice(i, i + 2);
    if (['&&', '||', '<=', '>=', '==', '!='].includes(two)) {
      tokens.push({ kind: 'op', val: two }); i += 2; continue;
    }

    // Single-char
    if ('<>!+*/-'.includes(src[i])) {
      tokens.push({ kind: 'op', val: src[i] }); i++; continue;
    }
    if (src[i] === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
    if (src[i] === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }
    if (src[i] === '?') { tokens.push({ kind: 'question' }); i++; continue; }
    if (src[i] === ':') { tokens.push({ kind: 'colon' }); i++; continue; }

    // Number
    if (/[0-9]/.test(src[i]) || (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ kind: 'num', val: src.slice(i, j) }); i = j; continue;
    }

    // Identifier / keyword
    if (/[a-zA-Z_$]/.test(src[i])) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_$]/.test(src[j])) j++;
      tokens.push({ kind: 'id', val: src.slice(i, j) }); i = j; continue;
    }

    i++; // unknown — skip
  }
  return tokens;
}

// ── Recursive descent parser → AST ────────────────────────────────────────────

class CelParser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }
  peek()    { return this.tokens[this.pos]; }
  consume() { return this.tokens[this.pos++]; }
  match(kind, val) {
    const t = this.peek();
    if (!t || t.kind !== kind) return null;
    if (val !== undefined && t.val !== val) return null;
    return this.consume();
  }
  expect(kind, val) {
    const t = this.match(kind, val);
    if (!t) throw new Error(`Expected ${kind}${val ? ' "' + val + '"' : ''} near pos ${this.pos}`);
    return t;
  }

  parse() { return this.parseTernary(); }

  parseTernary() {
    const cond = this.parseOr();
    if (!this.match('question')) return cond;
    const then = this.parseTernary();
    this.expect('colon');
    const els = this.parseTernary();
    return { type: 'ternary', cond, then, els };
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.match('op', '||')) {
      left = { type: 'binary', op: '||', left, right: this.parseAnd() };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseCmp();
    while (this.match('op', '&&')) {
      left = { type: 'binary', op: '&&', left, right: this.parseCmp() };
    }
    return left;
  }

  parseCmp() {
    let left = this.parseAddSub();
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== 'op') break;
      if (!['<', '>', '<=', '>=', '==', '!='].includes(t.val)) break;
      this.consume();
      left = { type: 'binary', op: t.val, left, right: this.parseAddSub() };
    }
    return left;
  }

  parseAddSub() {
    let left = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== 'op' || (t.val !== '+' && t.val !== '-')) break;
      this.consume();
      left = { type: 'binary', op: t.val, left, right: this.parseMul() };
    }
    return left;
  }

  parseMul() {
    let left = this.parseUnary();
    while (this.match('op', '*')) {
      left = { type: 'binary', op: '*', left, right: this.parseUnary() };
    }
    return left;
  }

  parseUnary() {
    if (this.match('op', '!')) {
      return { type: 'unary', op: '!', operand: this.parseUnary() };
    }
    return this.parseAtom();
  }

  parseAtom() {
    const t = this.peek();
    if (!t) throw new Error('Unexpected end of expression');

    if (t.kind === 'lparen') {
      this.consume();
      const e = this.parseTernary();
      this.expect('rparen');
      return e;
    }
    if (t.kind === 'num') {
      this.consume();
      return { type: 'num', val: t.val };
    }
    if (t.kind === 'id') {
      this.consume();
      if (t.val === 'true')  return { type: 'bool', val: true };
      if (t.val === 'false') return { type: 'bool', val: false };
      return { type: 'id', name: t.val };
    }
    throw new Error(`Unexpected token: ${JSON.stringify(t)}`);
  }
}

export function parseCelExpr(src) {
  return new CelParser(tokenize(src)).parse();
}

// ── AST → fact-graph XML ──────────────────────────────────────────────────────

/** Collect a left-associative chain of the same binary op into a flat list. */
function flattenBinary(ast, op) {
  if (ast.type === 'binary' && ast.op === op) {
    return [...flattenBinary(ast.left, op), ...flattenBinary(ast.right, op)];
  }
  return [ast];
}

const COMPARISON_TAG = {
  '<':  'LessThan', '<=': 'LessThanOrEqual',
  '>':  'GreaterThan', '>=': 'GreaterThanOrEqual',
  '==': 'Equal', '!=': 'NotEqual',
};

function ind(n) { return '  '.repeat(n); }

/**
 * Render a parsed CEL AST as fact-graph XML.
 *
 * @param {object}  ast             - parsed AST node
 * @param {object}  localToFgPath   - local variable name → fact-graph path
 * @param {number}  depth           - current indentation depth (for pretty-print)
 */
/**
 * @param {object} ast
 * @param {object} localToFgPath  - local name → fg path
 * @param {number} depth          - indentation depth
 * @param {object} localToType    - local name → 'integer'|'number'|'boolean' (for comparison type inference)
 * @param {string} returnType     - expected return type of this expression node ('integer'|'number'|'boolean')
 */
function astToXml(ast, localToFgPath, depth, localToType, returnType) {
  const p = ind(depth);
  const p1 = ind(depth + 1);
  const p2 = ind(depth + 2);

  switch (ast.type) {
    case 'bool':
      return ast.val ? `${p}<True/>` : `${p}<False/>`;

    case 'num': {
      const n = Number(ast.val);
      // Use the declared return type to pick the fact-graph numeric element.
      // 'integer' → <Int>, anything else (number/money) → <Dollar>.
      // Fallback: if no returnType, use the decimal point as a heuristic.
      const useInt = returnType === 'integer'
        || (!returnType && Number.isInteger(n) && !ast.val.includes('.'));
      return useInt ? `${p}<Int>${n}</Int>` : `${p}<Dollar>${n}</Dollar>`;
    }

    case 'id': {
      const fgPath = localToFgPath[ast.name];
      if (fgPath) return `${p}<Dependency path="${fgPath}"/>`;
      return `${p}<!-- unresolved: ${escXml(ast.name)} -->`;
    }

    case 'unary': {
      return `${p}<Not>\n${astToXml(ast.operand, localToFgPath, depth + 1, localToType, 'boolean')}\n${p}</Not>`;
    }

    case 'binary': {
      const { op } = ast;

      // Flatten &&/|| chains into multi-child All/Any (always boolean context)
      if (op === '&&') {
        const children = flattenBinary(ast, '&&').map(c => astToXml(c, localToFgPath, depth + 1, localToType, 'boolean'));
        return `${p}<All>\n${children.join('\n')}\n${p}</All>`;
      }
      if (op === '||') {
        const children = flattenBinary(ast, '||').map(c => astToXml(c, localToFgPath, depth + 1, localToType, 'boolean'));
        return `${p}<Any>\n${children.join('\n')}\n${p}</Any>`;
      }

      if (COMPARISON_TAG[op]) {
        const tag = COMPARISON_TAG[op];
        // Infer comparison operand type from the left side if it's a named dependency.
        // This lets literals on the right side use the correct type (e.g. Int for size comparisons).
        const leftType = ast.left.type === 'id' ? (localToType[ast.left.name] ?? returnType) : returnType;
        return [
          `${p}<${tag}>`,
          `${p1}<Left>`,
          astToXml(ast.left, localToFgPath, depth + 2, localToType, leftType),
          `${p1}</Left>`,
          `${p1}<Right>`,
          astToXml(ast.right, localToFgPath, depth + 2, localToType, leftType),
          `${p1}</Right>`,
          `${p}</${tag}>`,
        ].join('\n');
      }

      // Arithmetic ops propagate the return type
      if (op === '+') {
        const children = flattenBinary(ast, '+').map(c => astToXml(c, localToFgPath, depth + 1, localToType, returnType));
        return `${p}<Add>\n${children.join('\n')}\n${p}</Add>`;
      }

      if (op === '-') {
        return [
          `${p}<Subtract>`,
          `${p1}<Minuend>`,
          astToXml(ast.left, localToFgPath, depth + 2, localToType, returnType),
          `${p1}</Minuend>`,
          `${p1}<Subtrahends>`,
          astToXml(ast.right, localToFgPath, depth + 2, localToType, returnType),
          `${p1}</Subtrahends>`,
          `${p}</Subtract>`,
        ].join('\n');
      }

      if (op === '*') {
        const children = flattenBinary(ast, '*').map(c => astToXml(c, localToFgPath, depth + 1, localToType, returnType));
        return `${p}<Multiply>\n${children.join('\n')}\n${p}</Multiply>`;
      }

      throw new Error(`Unknown binary op: ${op}`);
    }

    case 'ternary': {
      const { cond, then, els } = ast;
      const p3 = ind(depth + 3);
      const p4 = ind(depth + 4);
      // Use <Not>cond</Not> instead of <True/> for the else branch so the fact-graph
      // returns indeterminate (rather than the else value) when the condition's
      // dependencies are missing. <True/> would fire unconditionally through nested
      // Switches, producing a spurious value when inputs haven't been provided.
      return [
        `${p}<Switch>`,
        `${p1}<Case>`,
        `${p2}<When>`,
        astToXml(cond, localToFgPath, depth + 3, localToType, 'boolean'),
        `${p2}</When>`,
        `${p2}<Then>`,
        astToXml(then, localToFgPath, depth + 3, localToType, returnType),
        `${p2}</Then>`,
        `${p1}</Case>`,
        `${p1}<Case>`,
        `${p2}<When>`,
        `${p3}<Not>`,
        astToXml(cond, localToFgPath, depth + 4, localToType, 'boolean'),
        `${p3}</Not>`,
        `${p2}</When>`,
        `${p2}<Then>`,
        astToXml(els, localToFgPath, depth + 3, localToType, returnType),
        `${p2}</Then>`,
        `${p1}</Case>`,
        `${p}</Switch>`,
      ].join('\n');
    }

    default:
      throw new Error(`Unknown AST type: ${ast.type}`);
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Translate a schema-conformant graph.json object to IRS fact-graph XML.
 *
 * @param {object} graph - { nodes, edges } graph object
 * @returns {{ xml: string, errors: {path: string, message: string}[] }}
 */
export function toFactGraphXml(graph) {
  const { nodes = {} } = graph;

  // Build localName → fact-graph path and localName → type for expression translation.
  // If two nodes share the same local name (last segment), the input node wins;
  // otherwise last writer wins. This is a known limitation.
  const localToFgPath = {};
  const localToType = {}; // local name → 'integer'|'number'|'boolean'
  for (const [nodePath, nodeInfo] of Object.entries(nodes)) {
    const local = nodePath.split('.').pop();
    const fgPath = nodePathToFgPath(nodePath);
    // Prefer input nodes ($.prefix) for resolution since expressions reference inputs
    if (!localToFgPath[local] || nodePath.startsWith('$.')) {
      localToFgPath[local] = fgPath;
      localToType[local] = nodeInfo.type ?? 'number';
    }
  }

  // Accumulate facts by fgPath to detect collisions.
  // Derived (expression) nodes take priority over input (default) nodes since
  // a derived rule may intentionally override a policy parameter default
  // (e.g. a state overlay replaces a federal flat value with a computed rule).
  const factMap = new Map(); // fgPath → { priority, descLine, inner }
  const errors = [];

  for (const [nodePath, nodeInfo] of Object.entries(nodes)) {
    const fgPath = nodePathToFgPath(nodePath);
    const isInput = nodePath.startsWith('$.');
    const type = nodeInfo.type ?? 'number';

    const descLine = nodeInfo.description
      ? `\n      <Description>${escXml(nodeInfo.description)}</Description>`
      : '';

    let inner;
    let priority; // higher = preferred on collision
    if (isInput) {
      const hasDefault = nodeInfo.default !== undefined;
      if (hasDefault) {
        // Policy parameters: emit as Derived constants so the federal default is
        // expressed as a literal value. States override by supplying a different
        // Fact definition in their own dictionary module.
        const val = nodeInfo.default;
        let litXml;
        if (type === 'boolean') {
          litXml = val ? '        <True/>' : '        <False/>';
        } else if (type === 'integer') {
          litXml = `        <Int>${escXml(String(val))}</Int>`;
        } else {
          litXml = `        <Dollar>${escXml(String(val))}</Dollar>`;
        }
        inner = `      <Derived>\n${litXml}\n      </Derived>`;
        priority = 1; // default constant — lowest priority
      } else {
        inner = `      <Writable>\n        ${typeDecl(type)}\n      </Writable>`;
        priority = 2; // writable input
      }
    } else {
      const expr = nodeInfo.expression;
      if (expr == null) continue; // no expression, skip

      let exprXml;
      try {
        const ast = parseCelExpr(expr.trim());
        exprXml = astToXml(ast, localToFgPath, 4, localToType, type);
      } catch (e) {
        errors.push({ path: nodePath, message: e.message });
        exprXml = `        <!-- translation error: ${escXml(e.message)} -->`;
      }

      inner = `      <Derived>\n${exprXml}\n      </Derived>`;
      priority = 3; // derived expression — highest priority
    }

    const existing = factMap.get(fgPath);
    if (!existing || priority > existing.priority) {
      factMap.set(fgPath, { priority, descLine, inner });
    }
  }

  const facts = [...factMap.entries()].map(
    ([fgPath, { descLine, inner }]) =>
      `    <Fact path="${fgPath}">${descLine}\n${inner}\n    </Fact>`
  );

  const xml = [
    '<FactDictionaryModule>',
    '  <Facts>',
    facts.join('\n\n'),
    '  </Facts>',
    '</FactDictionaryModule>',
  ].join('\n');

  return { xml, errors };
}
