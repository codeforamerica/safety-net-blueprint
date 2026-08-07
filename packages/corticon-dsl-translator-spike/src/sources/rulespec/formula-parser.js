/**
 * Tokenizer and recursive-descent parser for the rulespec formula language.
 *
 * Grammar (lowest to highest precedence):
 *   expr     := implies
 *   implies  := or ( 'implies' or )*
 *   or       := and ( 'or' and )*
 *   and      := cmp ( 'and' cmp )*
 *   cmp      := add ( CMP_OP add )?     -- non-associative
 *   add      := mul ( ('+' | '-') mul )*
 *   mul      := unary ( '*' unary )*
 *   unary    := 'not' unary | atom
 *   atom     := '(' expr ')'
 *              | 'if' expr 'then' expr 'else' expr
 *              | '[' (expr (',' expr)* ','?)? ']'
 *              | IDENT '(' (expr (',' expr)*)? ')'
 *              | IDENT
 *              | NUMBER
 *              | STRING
 *
 * Inline comments (# to end of line) are stripped during tokenization.
 */

const CMP_OPS = new Set(['>=', '<=', '!=', '=', '>', '<']);

function tokenize(src) {
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    // Whitespace (including newlines)
    if (/\s/.test(src[i])) {
      i++;
      continue;
    }

    // Inline comment
    if (src[i] === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    // Two-character operators
    if (i + 1 < src.length) {
      const two = src.slice(i, i + 2);
      if (two === '>=' || two === '<=' || two === '!=') {
        tokens.push({ type: 'OP', value: two });
        i += 2;
        continue;
      }
    }

    // Single-character operators
    if (src[i] === '>' || src[i] === '<' || src[i] === '=' ||
        src[i] === '+' || src[i] === '-' || src[i] === '*') {
      tokens.push({ type: 'OP', value: src[i] });
      i++;
      continue;
    }

    // Punctuation
    if (src[i] === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (src[i] === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }
    if (src[i] === '[') { tokens.push({ type: 'LBRACKET' }); i++; continue; }
    if (src[i] === ']') { tokens.push({ type: 'RBRACKET' }); i++; continue; }
    if (src[i] === ',') { tokens.push({ type: 'COMMA' }); i++; continue; }

    // Single-quoted string
    if (src[i] === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== "'") j++;
      tokens.push({ type: 'STRING', value: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }

    // Number (integer or decimal)
    if (/[0-9]/.test(src[i])) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: 'NUMBER', value: src.slice(i, j) });
      i = j;
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(src[i])) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      tokens.push({ type: 'IDENT', value: src.slice(i, j) });
      i = j;
      continue;
    }

    throw new Error(`Unexpected character '${src[i]}' at position ${i} in formula: ${src.slice(Math.max(0, i - 20), i + 20)}`);
  }

  tokens.push({ type: 'EOF' });
  return tokens;
}

/**
 * Parse a rulespec formula string into an AST.
 *
 * AST node shapes:
 *   { type: 'Binary',     op: string,   left: node, right: node }
 *   { type: 'Implies',    left: node,   right: node }
 *   { type: 'Unary',      op: 'not',    operand: node }
 *   { type: 'IfThenElse', cond: node,   then: node, else: node }
 *   { type: 'Call',       name: string, args: node[] }
 *   { type: 'List',       items: node[] }
 *   { type: 'Identifier', name: string }
 *   { type: 'Number',     value: number }
 *   { type: 'String',     value: string }
 *
 * @param {string} src
 * @returns {object} AST root node
 */
export function parse(src) {
  const tokens = tokenize(src.trim());
  let pos = 0;

  function peek() { return tokens[pos]; }
  function consume(type, value) {
    const t = tokens[pos];
    if (t.type !== type) {
      throw new Error(`Expected token type ${type} but got ${t.type} ('${t.value}') near position ${pos}`);
    }
    if (value !== undefined && t.value !== value) {
      throw new Error(`Expected '${value}' but got '${t.value}'`);
    }
    pos++;
    return t;
  }
  function at(type, value) {
    const t = tokens[pos];
    return t.type === type && (value === undefined || t.value === value);
  }

  function parseExpr() { return parseImplies(); }

  function parseImplies() {
    let left = parseOr();
    while (at('IDENT', 'implies')) {
      consume('IDENT', 'implies');
      const right = parseOr();
      left = { type: 'Implies', left, right };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (at('IDENT', 'or')) {
      consume('IDENT', 'or');
      const right = parseAnd();
      left = { type: 'Binary', op: 'or', left, right };
    }
    return left;
  }

  function parseAnd() {
    let left = parseCmp();
    while (at('IDENT', 'and')) {
      consume('IDENT', 'and');
      const right = parseCmp();
      left = { type: 'Binary', op: 'and', left, right };
    }
    return left;
  }

  function parseCmp() {
    let left = parseAdd();
    if (at('OP') && CMP_OPS.has(peek().value)) {
      const op = consume('OP').value;
      const right = parseAdd();
      return { type: 'Binary', op, left, right };
    }
    return left;
  }

  function parseAdd() {
    let left = parseMul();
    while (at('OP') && (peek().value === '+' || peek().value === '-')) {
      const op = consume('OP').value;
      const right = parseMul();
      left = { type: 'Binary', op, left, right };
    }
    return left;
  }

  function parseMul() {
    let left = parseUnary();
    while (at('OP') && peek().value === '*') {
      consume('OP', '*');
      const right = parseUnary();
      left = { type: 'Binary', op: '*', left, right };
    }
    return left;
  }

  function parseUnary() {
    if (at('IDENT', 'not')) {
      consume('IDENT', 'not');
      return { type: 'Unary', op: 'not', operand: parseUnary() };
    }
    return parseAtom();
  }

  function parseAtom() {
    // if/then/else expression
    if (at('IDENT', 'if')) {
      consume('IDENT', 'if');
      const cond = parseExpr();
      consume('IDENT', 'then');
      const then = parseExpr();
      consume('IDENT', 'else');
      const els = parseExpr();
      return { type: 'IfThenElse', cond, then, else: els };
    }

    // Parenthesized expression
    if (at('LPAREN')) {
      consume('LPAREN');
      const expr = parseExpr();
      consume('RPAREN');
      return expr;
    }

    // List literal [ item, item, ... ]
    if (at('LBRACKET')) {
      consume('LBRACKET');
      const items = [];
      while (!at('RBRACKET') && !at('EOF')) {
        items.push(parseExpr());
        if (at('COMMA')) consume('COMMA');
        // trailing comma before ] is allowed
      }
      consume('RBRACKET');
      return { type: 'List', items };
    }

    // Number literal
    if (at('NUMBER')) {
      const n = consume('NUMBER').value;
      return { type: 'Number', value: parseFloat(n) };
    }

    // String literal
    if (at('STRING')) {
      const s = consume('STRING').value;
      return { type: 'String', value: s };
    }

    // Identifier or function call
    if (at('IDENT')) {
      const name = consume('IDENT').value;
      if (at('LPAREN')) {
        consume('LPAREN');
        const args = [];
        while (!at('RPAREN') && !at('EOF')) {
          args.push(parseExpr());
          if (at('COMMA')) consume('COMMA');
        }
        consume('RPAREN');
        return { type: 'Call', name, args };
      }
      return { type: 'Identifier', name };
    }

    const t = peek();
    throw new Error(`Unexpected token ${t.type} ('${t.value ?? ''}') at position ${pos}`);
  }

  const ast = parseExpr();
  if (!at('EOF')) {
    const t = peek();
    throw new Error(`Unexpected token ${t.type} ('${t.value ?? ''}') at position ${pos} — expected end of formula`);
  }
  return ast;
}
