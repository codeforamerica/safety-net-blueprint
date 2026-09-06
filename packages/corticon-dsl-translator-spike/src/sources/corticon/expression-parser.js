/**
 * Tokenizer + recursive-descent parser for Corticon's own expression text (the
 * `@_text` field on a parsed condition/action/filter -- see expression.js).
 * Corticon's real XML never carries a structured operator tree (confirmed real:
 * every `parserOutput` element has only a flat `@_text` string plus the atomic
 * ATTRIBUTE/ENTITY terms touched -- no `<leftOperand>`/`<operator>` nesting anywhere),
 * so this is the only place the real operator/literal structure can come from.
 *
 * This is intentionally Corticon-specific -- the tokenizer/grammar below matches
 * Corticon's own text syntax (`->` collection navigation, `[field=value, ...]`
 * bracket construction). The AST it produces is NOT Corticon-specific: a future
 * front-end for a different forward-chaining engine would need its own
 * tokenizer/parser for that engine's syntax, but could target this same AST shape,
 * so `to-cel.js` (and anything else consuming the AST) stays engine-agnostic.
 *
 * Scoped to exactly the grammar confirmed real across every fixture in this spike,
 * PLUS operators confirmed real by Corticon's own documented precedence table
 * (docs.progress.com/bundle/corticon-js-rule-modeling/page/Operator-precedence-and-order-of-evaluation.html)
 * even where no fixture happens to exercise them yet -- "not in our 6 fixtures" is
 * not the same claim as "not real Corticon syntax," and the precedence table is a
 * primary source, not an inference. Anything outside BOTH of those throws a clear
 * parse error rather than guessing at a translation -- consistent with this spike's
 * classify-before-translate approach.
 *
 * Confirmed real precedence, highest to lowest (same source): parentheses; unary
 * `-`/`not`; multiplicative `*` `/` `**` (exponentiation is the same tier as
 * multiply/divide in Corticon, NOT higher, unlike most general-purpose languages --
 * checked rather than assumed); additive `+` `-`; relational `<` `<=` `>` `>=` `=`
 * `<>`; logical `and` `or`. Equal-precedence operators evaluate left to right
 * (left-associative) per that same page. `<>` is Corticon's real documented
 * not-equal spelling; `!=` is kept too as a defensive alias since it's never been
 * seen in a real fixture OR found in documentation -- unconfirmed either way, but
 * accepting a superset of real syntax is harmless, unlike guessing at output.
 */

const OPERATORS = ['->', '+=', '>=', '<=', '<>', '!=', '..', '=', '>', '<', '**', '+', '-', '*', '/', '.', '(', ')', '[', ']', ','];

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let value = '';
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\' && text[i + 1] === quote) {
          value += quote;
          i += 2;
        } else {
          value += text[i];
          i++;
        }
      }
      if (text[i] !== quote) throw new Error(`Unterminated string literal in expression: ${text}`);
      i++;
      tokens.push({ type: 'string', value });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let value = '';
      let sawDot = false;
      // Stop at a second '.', and stop BEFORE a '.' that's immediately followed by
      // another '.' -- confirmed real range syntax ("Person.age in 21 .. 64") uses
      // '..' as a distinct range separator token, not a second decimal point. Every
      // confirmed real case has whitespace around '..' already, so this only
      // matters defensively, but a number tokenizer that greedily ate "5..10" as one
      // malformed token ("5..1" then a stray "0") would be exactly the kind of
      // silent wrong-parse this whole design is meant to avoid.
      while (i < text.length && (/[0-9]/.test(text[i]) || (text[i] === '.' && !sawDot && text[i + 1] !== '.'))) {
        if (text[i] === '.') sawDot = true;
        value += text[i];
        i++;
      }
      tokens.push({ type: 'number', value: Number(value) });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let value = '';
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) {
        value += text[i];
        i++;
      }
      tokens.push({ type: 'identifier', value });
      continue;
    }
    const op = OPERATORS.find((candidate) => text.startsWith(candidate, i));
    if (!op) throw new Error(`Unsupported character '${ch}' in expression: ${text}`);
    tokens.push({ type: 'operator', value: op });
    i += op.length;
  }
  return tokens;
}

// Bare identifier-shaped keywords that are actually literals, not references --
// confirmed real: `T`/`F` (loanapp.creditReqtMet = T), `true`/`false` (a boolean
// sub-expression compared against a literal, e.g. "(...) = true"), and `null`
// (Mortgage's real null-check-masking pattern: "loanapp.late30DaysSum = null").
const KEYWORD_LITERALS = {
  T: { kind: 'boolean', value: true },
  F: { kind: 'boolean', value: false },
  true: { kind: 'boolean', value: true },
  false: { kind: 'boolean', value: false },
  null: { kind: 'null', value: null },
};

class Parser {
  constructor(tokens, sourceText) {
    this.tokens = tokens;
    this.pos = 0;
    this.sourceText = sourceText;
  }

  peek() {
    return this.tokens[this.pos];
  }

  next() {
    return this.tokens[this.pos++];
  }

  expectOperator(value) {
    const token = this.next();
    if (!token || token.type !== 'operator' || token.value !== value) {
      throw new Error(`Expected '${value}' in expression: ${this.sourceText} (got ${JSON.stringify(token)})`);
    }
  }

  atEnd() {
    return this.pos >= this.tokens.length;
  }

  isOperator(value) {
    const token = this.peek();
    return Boolean(token && token.type === 'operator' && token.value === value);
  }

  // `and`/`or`/`not` are real Corticon operators (per the precedence table cited
  // above) but are spelled as bare words, not symbols -- they tokenize as ordinary
  // identifiers, so checking for them is a keyword check, not an isOperator() check.
  isKeyword(value) {
    const token = this.peek();
    return Boolean(token && token.type === 'identifier' && token.value === value);
  }

  // Statement := Logical (('=' | '+=') Logical)?
  // A bare top-level '=' is ambiguous between assignment and equality-comparison in
  // Corticon's own text syntax (confirmed real: both render identically, e.g.
  // "Household.fpl110 = ( Household.fpl * 1.1 )" is an ASSIGNMENT while
  // "liability.accountType = 'CreditLine'" is an EXPRESSION/comparison, per each
  // cell's own `expressiontype` metadata -- not visible in the text at all). This
  // parser stays agnostic and always produces the same node shape; the caller
  // decides how to interpret it using the cell's real expressionType.
  parseStatement() {
    const left = this.parseLogical();
    if (this.isOperator('+=')) {
      this.next();
      const value = this.parseLogical();
      return { type: 'Assignment', operator: '+=', target: left, value };
    }
    if (this.atEnd()) return left;
    throw new Error(`Unexpected trailing tokens in expression: ${this.sourceText}`);
  }

  // Logical := Comparison (('and' | 'or') Comparison)* -- lowest precedence, per the
  // confirmed real precedence table cited at the top of this file.
  parseLogical() {
    let left = this.parseComparison();
    while (this.isKeyword('and') || this.isKeyword('or')) {
      const operator = this.next().value;
      const right = this.parseComparison();
      left = { type: 'BinaryOp', operator, left, right };
    }
    return left;
  }

  // Comparison := Additive (('>=' | '<=' | '!=' | '<>' | '=' | '>' | '<') Additive | RangeMembership)?
  // `<>` (Corticon's real documented not-equal spelling) is normalized to `!=` in
  // the AST here, so nothing downstream needs to know both spellings exist.
  parseComparison() {
    const left = this.parseAdditive();
    for (const op of ['>=', '<=', '!=', '<>', '=', '>', '<']) {
      if (this.isOperator(op)) {
        this.next();
        const right = this.parseAdditive();
        return { type: 'BinaryOp', operator: op === '<>' ? '!=' : op, left, right };
      }
    }
    if (this.isKeyword('in')) {
      this.next();
      return this.parseRangeMembership(left);
    }
    return left;
  }

  // RangeMembership := ('(' | '[')? Additive '..' Additive (')' | ']')?
  // Confirmed real, DC Medicaid/CHIP: `Person.age in ( 18 .. 26 )` (both exclusive),
  // `Person.HouseholdActualPercentFPL in ( 220 .. 250 ]` (lower exclusive, upper
  // inclusive), and `Person.age in 21 .. 64` -- the parsed `text` field DROPS the
  // bracket characters entirely when both bounds are inclusive (confirmed by
  // comparing this real case's own raw `expression` attribute, `[21..64]`, against
  // its parsed `text`), so "no bracket present" means inclusive on that side, not
  // "bracket syntax doesn't apply here." Each side's bracket is independent.
  parseRangeMembership(value) {
    let lowerInclusive = true;
    if (this.isOperator('(')) {
      lowerInclusive = false;
      this.next();
    } else if (this.isOperator('[')) {
      this.next();
    }
    const lower = this.parseAdditive();
    this.expectOperator('..');
    const upper = this.parseAdditive();
    let upperInclusive = true;
    if (this.isOperator(')')) {
      upperInclusive = false;
      this.next();
    } else if (this.isOperator(']')) {
      this.next();
    }
    return { type: 'RangeMembership', value, lower, lowerInclusive, upper, upperInclusive };
  }

  // Additive := Multiplicative (('+' | '-') Multiplicative)*
  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.isOperator('+') || this.isOperator('-')) {
      const operator = this.next().value;
      const right = this.parseMultiplicative();
      left = { type: 'BinaryOp', operator, left, right };
    }
    return left;
  }

  // Multiplicative := Unary (('*' | '/' | '**') Unary)* -- `**` (exponentiation) is
  // the SAME precedence tier as multiply/divide in Corticon (confirmed via
  // documentation, not most general-purpose languages' convention of a higher tier).
  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.isOperator('*') || this.isOperator('/') || this.isOperator('**')) {
      const operator = this.next().value;
      const right = this.parseUnary();
      left = { type: 'BinaryOp', operator, left, right };
    }
    return left;
  }

  // Unary := ('-' | 'not') Unary | Postfix
  parseUnary() {
    if (this.isOperator('-')) {
      this.next();
      return { type: 'UnaryOp', operator: '-', operand: this.parseUnary() };
    }
    if (this.isKeyword('not')) {
      this.next();
      return { type: 'UnaryOp', operator: 'not', operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  // Postfix := Primary (Accessor | Construction)*
  // Accessor := ('.' | '->') identifier ('(' ArgList? ')')?
  // Construction := '[' ConstructionArg (',' ConstructionArg)* ']'
  // ConstructionArg := Postfix '=' Expression -- confirmed real: the field reference
  // inside brackets is a full entity-qualified path (e.g. "Household.PrimaryInsuredId
  // = Person.primaryInsuredId", "Cohort.type = '...'"), never a bare field name, so
  // the LHS is parsed the same way any other path is and must resolve to a Member.
  parsePostfix() {
    let node = this.parsePrimary();
    while (this.isOperator('.') || this.isOperator('->') || this.isOperator('[')) {
      if (this.isOperator('[')) {
        this.next();
        const fields = [];
        while (!this.isOperator(']')) {
          const fieldRef = this.parsePostfix();
          if (fieldRef.type !== 'Member') {
            throw new Error(`Expected an entity-qualified field reference in construction syntax: ${this.sourceText}`);
          }
          this.expectOperator('=');
          const value = this.parseLogical();
          fields.push({ name: fieldRef.property, value });
          if (this.isOperator(',')) this.next();
        }
        this.expectOperator(']');
        node = { type: 'Construction', entity: node, fields };
        continue;
      }
      const navigation = this.next().value === '->' ? 'arrow' : 'dot';
      const propertyToken = this.next();
      if (!propertyToken || propertyToken.type !== 'identifier') {
        throw new Error(`Expected a property/method name after '${navigation === 'arrow' ? '->' : '.'}' in expression: ${this.sourceText}`);
      }
      if (this.isOperator('(')) {
        this.next();
        const args = [];
        while (!this.isOperator(')')) {
          args.push(this.parseLogical());
          if (this.isOperator(',')) this.next();
        }
        this.expectOperator(')');
        node = { type: 'Call', object: node, property: propertyToken.value, navigation, args };
      } else {
        node = { type: 'Member', object: node, property: propertyToken.value, navigation };
      }
    }
    return node;
  }

  // Primary := number | string | identifier | '(' Statement ')'
  parsePrimary() {
    const token = this.next();
    if (!token) throw new Error(`Unexpected end of expression: ${this.sourceText}`);
    if (token.type === 'number') return { type: 'Literal', kind: 'number', value: token.value };
    if (token.type === 'string') return { type: 'Literal', kind: 'string', value: token.value };
    if (token.type === 'identifier') {
      if (token.value in KEYWORD_LITERALS) {
        return { type: 'Literal', ...KEYWORD_LITERALS[token.value] };
      }
      return { type: 'Identifier', name: token.value };
    }
    if (token.type === 'operator' && token.value === '(') {
      const inner = this.parseLogical();
      this.expectOperator(')');
      return inner;
    }
    throw new Error(`Unexpected token in expression: ${this.sourceText} (got ${JSON.stringify(token)})`);
  }
}

/**
 * Parses Corticon expression text into a generic AST. Throws on any unsupported
 * construct. Named `parseExpression`, not `parseCorticonExpression` -- this is
 * Corticon's implementation of the per-engine "expression parser" entry point every
 * engine adapter must export (see engines.js), the same way `project.js` exports
 * `loadProject` rather than `loadCorticonProject`. The module path (`corticon/`)
 * is what marks it Corticon-specific, not the export name.
 */
export function parseExpression(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`Expected non-empty Corticon expression text, got: ${JSON.stringify(text)}`);
  }
  const parser = new Parser(tokenize(text), text);
  return parser.parseStatement();
}
