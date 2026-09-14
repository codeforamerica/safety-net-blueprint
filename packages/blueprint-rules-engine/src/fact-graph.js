/**
 * FactGraph translator and evaluator.
 *
 * Translates Blueprint ruleset CEL expressions into IRS Direct File
 * FactGraph XML (gov.irs.factgraph) and evaluates rulesets using the
 * vendored FactGraph engine (vendor/fg.js).
 *
 * This module is Node-only. The primary (browser-compatible) evaluator
 * lives in src/evaluator.js. Use this module when generating FactGraph XML
 * for interoperability with IRS Direct File's Scala.js compiled engine.
 *
 * Path mapping strategy (flat paths):
 *   $.household.monthlyIncome  → /household_monthlyIncome     (writable Int)
 *   $.household.members[]      → /household_members           (writable Collection)
 *   $.household.members[].age  → /household_members/{*}/age   (writable Int)
 *   factName                   → /factName                    (derived fact)
 *
 * @module fact-graph
 */

import { compileRuleset } from '@codeforamerica/blueprint-core';
import { matchesType, EvalResult, Graph } from './evaluator.js';
import {
  FactDictionaryFactory,
  GraphFactory,
  CollectionFactory,
} from '../vendor/fg.js';

// ── CEL Tokenizer ─────────────────────────────────────────────────────────────

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }

    if (ch === '&' && expr[i + 1] === '&') { tokens.push({ type: 'op', value: '&&' }); i += 2; continue; }
    if (ch === '|' && expr[i + 1] === '|') { tokens.push({ type: 'op', value: '||' }); i += 2; continue; }
    if (ch === '<' && expr[i + 1] === '=') { tokens.push({ type: 'op', value: '<=' }); i += 2; continue; }
    if (ch === '>' && expr[i + 1] === '=') { tokens.push({ type: 'op', value: '>=' }); i += 2; continue; }
    if (ch === '!' && expr[i + 1] === '=') { tokens.push({ type: 'op', value: '!=' }); i += 2; continue; }
    if (ch === '=' && expr[i + 1] === '=') { tokens.push({ type: 'op', value: '==' }); i += 2; continue; }
    if (ch === '<' || ch === '>' || ch === '!') { tokens.push({ type: 'op', value: ch }); i++; continue; }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'comma' }); i++; continue; }
    if (ch === '.') { tokens.push({ type: 'dot' }); i++; continue; }

    if (/[0-9]/.test(ch)) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) num += expr[i++];
      const isFloat = num.includes('.');
      tokens.push({ type: 'literal', kind: isFloat ? 'float' : 'int', value: isFloat ? parseFloat(num) : parseInt(num, 10) });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let str = '';
      i++;
      while (i < expr.length && expr[i] !== quote) str += expr[i++];
      i++; // closing quote
      tokens.push({ type: 'literal', kind: 'string', value: str });
      continue;
    }

    if (/[a-zA-Z_$]/.test(ch)) {
      let id = '';
      while (i < expr.length && /[a-zA-Z0-9_$]/.test(expr[i])) id += expr[i++];
      if (id === 'true')  tokens.push({ type: 'literal', kind: 'bool', value: true });
      else if (id === 'false') tokens.push({ type: 'literal', kind: 'bool', value: false });
      else if (id === 'has') tokens.push({ type: 'kw', value: 'has' });
      else tokens.push({ type: 'ident', value: id });
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i} in: ${expr}`);
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

// ── CEL Parser → AST ──────────────────────────────────────────────────────────

/**
 * Parse a CEL expression string into an AST.
 *
 * AST node types:
 *   { type: 'literal', kind: 'int'|'float'|'bool'|'string', value }
 *   { type: 'prop', chain: string[] }          e.g. ['household', 'monthlyIncome']
 *   { type: 'unary', op: '!', operand }
 *   { type: 'binary', op, left, right }        op: '&&'|'||'|'<'|'>'|'<='|'>='|'=='|'!='
 *   { type: 'call', method, receiver, var, body }  filter/all/exists
 *   { type: 'call', method: 'contains', receiver, arg }
 *   { type: 'call', method: 'size', receiver }
 *   { type: 'has', operand }
 */
function parse(expr) {
  const tokens = tokenize(expr);
  let pos = 0;

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  const expectType = (type) => {
    const t = consume();
    if (t.type !== type) throw new Error(`Expected ${type}, got ${t.type} at pos ${pos}`);
    return t;
  };
  const matchOp = (v) => peek().type === 'op' && peek().value === v;

  function parseExpr() { return parseOr(); }

  function parseOr() {
    let left = parseAnd();
    while (matchOp('||')) { consume(); left = { type: 'binary', op: '||', left, right: parseAnd() }; }
    return left;
  }

  function parseAnd() {
    let left = parseCmp();
    while (matchOp('&&')) { consume(); left = { type: 'binary', op: '&&', left, right: parseCmp() }; }
    return left;
  }

  function parseCmp() {
    let left = parseUnary();
    const t = peek();
    if (t.type === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(t.value)) {
      consume();
      return { type: 'binary', op: t.value, left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary() {
    if (matchOp('!')) { consume(); return { type: 'unary', op: '!', operand: parseUnary() }; }
    return parsePostfix();
  }

  function parsePostfix() {
    let node = parsePrimary();
    while (peek().type === 'dot') {
      consume(); // eat .
      const field = expectType('ident');
      if (peek().type === 'lparen') {
        consume(); // eat (
        const method = field.value;
        if (['filter', 'all', 'exists'].includes(method)) {
          const variable = expectType('ident').value;
          expectType('comma');
          const body = parseExpr();
          expectType('rparen');
          node = { type: 'call', method, receiver: node, var: variable, body };
        } else if (method === 'contains') {
          const arg = parseExpr();
          expectType('rparen');
          node = { type: 'call', method: 'contains', receiver: node, arg };
        } else if (method === 'size') {
          expectType('rparen');
          node = { type: 'call', method: 'size', receiver: node };
        } else {
          // Unknown method — consume args and produce an opaque node
          let depth = 1;
          while (depth > 0) {
            const t = consume();
            if (t.type === 'lparen') depth++;
            else if (t.type === 'rparen') depth--;
          }
          node = { type: 'call', method, receiver: node };
        }
      } else {
        // Property access — extend the chain
        const chain = nodeToChain(node);
        node = { type: 'prop', chain: [...chain, field.value] };
      }
    }
    return node;
  }

  function nodeToChain(node) {
    if (node.type === 'prop') return node.chain;
    return []; // shouldn't happen for well-formed CEL
  }

  function parsePrimary() {
    const t = peek();
    if (t.type === 'literal') { consume(); return { type: 'literal', kind: t.kind, value: t.value }; }
    if (t.type === 'kw' && t.value === 'has') {
      consume();
      expectType('lparen');
      const inner = parseExpr();
      expectType('rparen');
      return { type: 'has', operand: inner };
    }
    if (t.type === 'ident') { consume(); return { type: 'prop', chain: [t.value] }; }
    if (t.type === 'lparen') {
      consume();
      const node = parseExpr();
      expectType('rparen');
      return node;
    }
    throw new Error(`Unexpected token '${t.type}' at pos ${pos} in: ${expr}`);
  }

  return parseExpr();
}

// ── Path utilities ─────────────────────────────────────────────────────────────

/**
 * Convert a compiled graph input JSONPath to a flat FactGraph path.
 *
 * $.household.monthlyIncome  → /household_monthlyIncome
 * $.household.members[]      → /household_members
 * $.household.members[].age  → /household_members/{uuid}/age
 */
function toFgPath(jsonPath) {
  const clean = jsonPath.slice(2); // remove $.
  if (clean.includes('[].')) {
    const [before, after] = clean.split('[].', 2);
    const parts = before.split('.');
    const prefix = parts[0] + '_' + parts.slice(1).join('_');
    return `/${prefix}/*/${after}`;
  }
  if (clean.endsWith('[]')) {
    const parts = clean.slice(0, -2).split('.');
    return '/' + parts[0] + '_' + parts.slice(1).join('_');
  }
  const parts = clean.split('.');
  if (parts.length === 1) return '/' + parts[0];
  return '/' + parts[0] + '_' + parts.slice(1).join('_');
}

// ── Schema / type utilities ───────────────────────────────────────────────────

function schemaTypeToFgType(schemaType) {
  switch (schemaType) {
    case 'integer': return 'Int';
    case 'number':  return 'Int';
    case 'boolean': return 'Boolean';
    case 'string':  return 'String';
    case 'array':   return 'Collection';
    default:        return 'String';
  }
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Context building ──────────────────────────────────────────────────────────

/**
 * Build the translation context from the compiled graph's input declarations.
 *
 * Returns:
 *   inputFgPaths: Map<celRef, fgPath>  e.g. 'household.monthlyIncome' → '/household_monthlyIncome'
 *   arrayRefs:    Set<celRef>           e.g. 'household.members'
 */
function buildContext(graphInputs) {
  const inputFgPaths = new Map();
  const arrayRefs = new Set();

  for (const jsonPath of Object.keys(graphInputs)) {
    const clean = jsonPath.slice(2);
    if (clean.includes('[].')) continue; // sub-fields; accessed via relative paths in filters

    if (clean.endsWith('[]')) {
      const celRef = clean.slice(0, -2);
      inputFgPaths.set(celRef, toFgPath(jsonPath));
      arrayRefs.add(celRef);
    } else {
      inputFgPaths.set(clean, toFgPath(jsonPath));
    }
  }

  return { inputFgPaths, arrayRefs };
}

// ── AST → FactGraph XML ───────────────────────────────────────────────────────

/**
 * Convert a CEL AST node to a FactGraph XML string.
 *
 * Translation context:
 *   inputFgPaths:    Map<celRef, fgPath>
 *   arrayRefs:       Set<celRef>
 *   filterVar:       string | null  — loop variable in current filter scope
 *   filterCollPath:  string | null  — FG collection path being filtered
 */
function astToXml(node, ctx) {
  switch (node.type) {

    case 'literal': {
      const { kind, value } = node;
      if (kind === 'bool')   return value ? '<True/>' : '<False/>';
      if (kind === 'int')    return `<Int>${value}</Int>`;
      if (kind === 'float')  return `<Int>${Math.round(value)}</Int>`;
      if (kind === 'string') return `<String>${escapeXml(value)}</String>`;
      throw new Error(`Unknown literal kind: ${kind}`);
    }

    case 'prop': {
      const { chain } = node;
      // Inside a filter, references starting with the loop variable are relative
      if (ctx.filterVar && chain[0] === ctx.filterVar) {
        const field = chain.slice(1).join('.');
        return `<Dependency path="${field}"/>`;
      }
      // Absolute path reference
      const celRef = chain.join('.');
      const absPath = ctx.inputFgPaths.get(celRef);
      if (absPath) return `<Dependency path="${absPath}"/>`;
      // Fact-to-fact reference
      return `<Dependency path="/${chain.join('_')}"/>`;
    }

    case 'unary': {
      if (node.op === '!') return `<Not>${astToXml(node.operand, ctx)}</Not>`;
      throw new Error(`Unknown unary op: ${node.op}`);
    }

    case 'binary': {
      if (node.op === '&&') return flattenMulti('All', node, '&&', ctx);
      if (node.op === '||') return flattenMulti('Any', node, '||', ctx);
      const tag = binaryOpTag(node.op);
      const left = astToXml(node.left, ctx);
      const right = astToXml(node.right, ctx);
      return `<${tag}><Left>${left}</Left><Right>${right}</Right></${tag}>`;
    }

    case 'call': {
      const { method, receiver } = node;
      const collPath = collectionFgPath(receiver, ctx);

      if (method === 'filter') {
        const innerCtx = { ...ctx, filterVar: node.var, filterCollPath: collPath };
        const pred = astToXml(node.body, innerCtx);
        return `<Filter path="${collPath}">${pred}</Filter>`;
      }

      if (method === 'all') {
        // all(v, pred) → Equal(CollectionSize(Filter), CollectionSize(collection))
        const innerCtx = { ...ctx, filterVar: node.var, filterCollPath: collPath };
        const pred = astToXml(node.body, innerCtx);
        return [
          '<Equal>',
          `<Left><CollectionSize><Filter path="${collPath}">${pred}</Filter></CollectionSize></Left>`,
          `<Right><CollectionSize><Dependency path="${collPath}"/></CollectionSize></Right>`,
          '</Equal>',
        ].join('');
      }

      if (method === 'exists') {
        // exists(v, pred) → GreaterThan(CollectionSize(Filter), 0)
        const innerCtx = { ...ctx, filterVar: node.var, filterCollPath: collPath };
        const pred = astToXml(node.body, innerCtx);
        return [
          '<GreaterThan>',
          `<Left><CollectionSize><Filter path="${collPath}">${pred}</Filter></CollectionSize></Left>`,
          '<Right><Int>0</Int></Right>',
          '</GreaterThan>',
        ].join('');
      }

      if (method === 'size') {
        const dep = astToXml(receiver, ctx);
        return `<CollectionSize>${dep}</CollectionSize>`;
      }

      throw new Error(`CEL method '${method}' is not translatable to FactGraph`);
    }

    case 'has': {
      const inner = astToXml(node.operand, ctx);
      return `<IsComplete>${inner}</IsComplete>`;
    }

    default:
      throw new Error(`Unknown AST node type: ${node.type}`);
  }
}

/**
 * Flatten a left-recursive &&/|| tree into an n-ary All/Any element.
 */
function flattenMulti(tag, node, op, ctx) {
  const children = [];
  function collect(n) {
    if (n.type === 'binary' && n.op === op) {
      collect(n.left);
      collect(n.right);
    } else {
      children.push(astToXml(n, ctx));
    }
  }
  collect(node);
  return `<${tag}>${children.join('')}</${tag}>`;
}

function binaryOpTag(op) {
  const tags = { '<': 'LessThan', '>': 'GreaterThan', '<=': 'LessThanOrEqual', '>=': 'GreaterThanOrEqual', '==': 'Equal', '!=': 'NotEqual' };
  const tag = tags[op];
  if (!tag) throw new Error(`Unknown binary op: ${op}`);
  return tag;
}

/**
 * Resolve a receiver AST node to its FactGraph collection path.
 */
function collectionFgPath(receiver, ctx) {
  if (receiver.type === 'prop') {
    const celRef = receiver.chain.join('.');
    const fgp = ctx.inputFgPaths.get(celRef);
    if (fgp) return fgp;
  }
  throw new Error(`Cannot determine collection path for: ${JSON.stringify(receiver)}`);
}

// ── FactDictionary XML generation ─────────────────────────────────────────────

/**
 * Indent a flat XML string with 2-space indentation.
 * Text nodes (e.g. <Int>18</Int>) are kept on a single line.
 */
function indentXml(flat) {
  const tokens = flat.split(/(<[^>]+>)/g);
  let depth = 0;
  const out = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].trim();
    if (!tok) continue;

    if (!tok.startsWith('<')) {
      // Text node — append inline to previous tag
      out[out.length - 1] += tok;
      continue;
    }

    if (tok.startsWith('</')) {
      depth--;
      const prev = out[out.length - 1];
      // If previous line is an open tag with no content, keep close tag inline
      if (prev && !prev.trimEnd().endsWith('>') || prev.endsWith(tok.replace('</', '<'))) {
        out[out.length - 1] += tok;
      } else {
        out.push('  '.repeat(depth) + tok);
      }
    } else if (tok.endsWith('/>')) {
      out.push('  '.repeat(depth) + tok);
    } else {
      out.push('  '.repeat(depth) + tok);
      depth++;
    }
  }

  return out.join('\n');
}

function buildFactDictionaryXml(graph) {
  const lines = ['<FactDictionaryModule>'];
  const ctx = buildContext(graph.inputs);

  // Writable input facts
  for (const [jsonPath, spec] of Object.entries(graph.inputs)) {
    const fgp = toFgPath(jsonPath);
    const fgType = schemaTypeToFgType(spec.type);
    lines.push(`  <Fact path="${fgp}"><Writable><${fgType}/></Writable></Fact>`);
  }

  // Derived output facts
  for (const [factName, factDecl] of Object.entries(graph.facts)) {
    const expr = factDecl?.expression;
    if (!expr) continue;

    let derivedXml;
    try {
      const ast = parse(expr);
      derivedXml = astToXml(ast, { ...ctx, filterVar: null, filterCollPath: null });
    } catch (err) {
      // Skip facts that can't be translated to FactGraph XML
      continue;
    }

    lines.push(`  <Fact path="/${factName}"><Derived>${derivedXml}</Derived></Fact>`);
  }

  lines.push('</FactDictionaryModule>');
  return indentXml(lines.join(''));
}

// ── Public: toFactGraphXml ─────────────────────────────────────────────────────

/**
 * Generate FactGraph XML (FactDictionaryModule) for a ruleset.
 *
 * The XML can be passed to IRS Direct File's FactDictionary.importFromXml()
 * to create a FactGraph dictionary for the ruleset's logic.
 *
 * @param {Object} rulesDoc      - parsed *-rules.yaml document
 * @param {string} [rulesetName] - which ruleset to translate; defaults to first
 * @returns {string} FactGraph XML string
 */
export function toFactGraphXml(rulesDoc, rulesetName) {
  const rulesets = rulesDoc?.rulesets ?? {};
  const name = rulesetName ?? Object.keys(rulesets)[0];
  const ruleset = rulesets[name];
  if (!ruleset) throw new Error(`Ruleset "${name}" not found`);

  const domain = rulesDoc.domain ?? 'unknown';
  const graph = compileRuleset(domain, name, ruleset);
  return buildFactDictionaryXml(graph);
}

// ── Graph seeding ─────────────────────────────────────────────────────────────

/**
 * Transitively find all facts (by name) that depend on any of the given
 * failed input paths, using the graph's dependency map.
 *
 * Returns an object mapping each affected fact name to an error message.
 */
function findAffectedFacts(failedPaths, graph) {
  const affected = {}; // factName → error message

  for (const [factName, deps] of Object.entries(graph.dependencies ?? {})) {
    const badDep = deps.find(d => failedPaths.has(d));
    if (badDep) {
      const actual = Array.isArray(failedPaths.get(badDep)) ? 'array' : typeof failedPaths.get(badDep);
      affected[factName] = `Dependency error: '${badDep}' — ${failedPaths.get(badDep)}`;
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [factName, deps] of Object.entries(graph.dependencies ?? {})) {
      if (factName in affected) continue;
      const badDep = deps.find(d => d in affected);
      if (badDep) {
        affected[factName] = `Dependency error: '${badDep}' — ${affected[badDep]}`;
        changed = true;
      }
    }
  }

  return affected;
}

/**
 * Seed a FactGraph from named input objects.
 *
 * Handles both scalar inputs (set directly) and array inputs (creates
 * CollectionItems with UUIDs, then sets each item's properties).
 *
 * Scalar inputs are type-checked before seeding. Wrong-type values are skipped
 * and recorded in failedPaths so callers can put dependent facts into errors
 * rather than letting the Scala engine throw.
 *
 * @returns {{ uuidToItem: Map, failedPaths: Map }} uuid→item map and path→errorMsg map
 */
function seedGraph(fgGraph, graphInputs, inputs) {
  const uuidToItem = new Map();
  const failedPaths = new Map(); // jsonPath → error message

  for (const [jsonPath, spec] of Object.entries(graphInputs)) {
    // Skip sub-fields — handled when seeding the parent array
    if (jsonPath.slice(2).includes('[].')) continue;

    if (jsonPath.endsWith('[]')) {
      // Array input → seed collection
      const collPath = toFgPath(jsonPath);
      const celRef = jsonPath.slice(2, -2);       // $.household.members[] → household.members
      const parts = celRef.split('.');
      const namespace = parts[0];

      let arr = inputs[namespace];
      for (const f of parts.slice(1)) {
        if (arr == null) break;
        arr = arr[f];
      }
      if (!Array.isArray(arr)) continue;

      // Find sub-field paths (e.g. $.household.members[].age)
      const arrayPrefix = jsonPath.slice(0, -2) + '[].'; // $.household.members[].
      const subFields = Object.keys(graphInputs)
        .filter(p => p.startsWith(arrayPrefix))
        .map(p => p.slice(arrayPrefix.length));    // ['age', 'employed', ...]

      // Pre-validate sub-field types before seeding — set__T__O__V throws on type mismatches.
      // If any item has a wrong-type sub-field, flag the collection path and skip seeding.
      let subFieldError = false;
      for (const fieldName of subFields) {
        if (subFieldError) break;
        const subSpec = graphInputs[`${arrayPrefix}${fieldName}`];
        if (!subSpec) continue;
        for (const item of arr) {
          const val = item[fieldName];
          if (val != null && !matchesType(val, subSpec.type)) {
            const actual = Array.isArray(val) ? 'array' : typeof val;
            failedPaths.set(jsonPath, `expected ${subSpec.type} for .${fieldName}, got ${actual}`);
            subFieldError = true;
            break;
          }
        }
      }
      if (subFieldError) continue;

      // Generate UUIDs for all items and build the uuid→item map
      const uuids = arr.map(() => crypto.randomUUID());
      for (let i = 0; i < arr.length; i++) {
        uuidToItem.set(uuids[i], arr[i]);
      }

      // Set the full Collection on the collection fact (expects Collection, not CollectionItem)
      fgGraph.set(collPath, CollectionFactory(uuids));

      // Commit the collection before seeding sub-fields. FactGraph traverses the member
      // UUID tree only after the collection is in the store (live → store via save()).
      // Without this intermediate save(), set__T__O__V on member paths silently no-ops.
      fgGraph.save();

      // Set sub-field values for each item.
      // Use #uuid prefix (FactGraph member path format) and set__T__O__V (tree traversal)
      // directly, bypassing the public set() which routes string values through set__T__T__V.
      // set__T__T__V does a direct dictionary lookup that fails for member paths because
      // the dictionary only stores wildcard templates (/collection/*/field), not UUID paths.
      for (let i = 0; i < arr.length; i++) {
        const uuid = uuids[i];
        const item = arr[i];
        for (const fieldName of subFields) {
          const val = item[fieldName];
          if (val !== undefined) {
            fgGraph['set__T__O__V'](`${collPath}/#${uuid}/${fieldName}`, val);
          }
        }
      }

    } else {
      // Scalar input
      const celRef = jsonPath.slice(2);
      const parts = celRef.split('.');
      const namespace = parts[0];
      let val = inputs[namespace];
      for (const f of parts.slice(1)) {
        if (val == null) break;
        val = val[f];
      }
      if (val == null) continue;
      if (!matchesType(val, spec.type)) {
        const actual = typeof val;
        failedPaths.set(jsonPath, `expected ${spec.type}, got ${actual}`);
        continue;
      }
      fgGraph.set(toFgPath(jsonPath), val);
    }
  }

  return { uuidToItem, failedPaths };
}

// ── Result extraction ─────────────────────────────────────────────────────────

const COMPLETE_KEY   = 'Lgov_irs_factgraph_monads_Result$Complete__f_v';
const PLACEHOLDER_KEY = 'Lgov_irs_factgraph_monads_Result$Placeholder__f_v';
const COLLECTION_ITEMS_KEY = 'Lgov_irs_factgraph_types_Collection__f_items';

/**
 * Extract a value from a FactGraph Result object.
 *
 * If the result value is a Collection (filter/array fact), iterates the
 * collection's UUID items and maps them back to the original input objects
 * via the uuidToItem map.
 *
 * @returns {{ value, state: 'complete'|'placeholder'|'incomplete' }}
 */
function extractResult(result, uuidToItem) {
  let rawValue, state;
  if (COMPLETE_KEY in result) {
    rawValue = result[COMPLETE_KEY];
    state = 'complete';
  } else if (PLACEHOLDER_KEY in result) {
    rawValue = result[PLACEHOLDER_KEY];
    state = 'placeholder';
  } else {
    return { state: 'incomplete' };
  }

  // If the value is a Collection, map UUIDs → original input items
  if (rawValue != null && typeof rawValue === 'object' && COLLECTION_ITEMS_KEY in rawValue) {
    const itemsSeq = rawValue[COLLECTION_ITEMS_KEY];
    const items = [];
    const it = itemsSeq.iterator__sc_Iterator();
    while (it.hasNext__Z()) {
      const javaUuid = it.next__O();
      const uuidStr = javaUuid.toString__T();
      const original = uuidToItem.get(uuidStr);
      if (original !== undefined) items.push(original);
    }
    return { value: items, state };
  }

  return { value: rawValue, state };
}

// ── FactGraph graph wrapper ───────────────────────────────────────────────────

/**
 * Evaluate a compiled graph using the FactGraph engine, returning an EvalResult
 * with typed nodes for all facts (intermediates + outputs).
 */
function evaluateCompiledWithFactGraph(graph, inputs) {
  const outputSet = new Set(graph.outputs);
  const xml = buildFactDictionaryXml(graph);

  const dict = FactDictionaryFactory.importFromXml(xml);
  const fgGraph = GraphFactory.apply(dict);

  // Seed inputs and build UUID → original item map for collection results.
  // failedPaths records scalar inputs that had wrong types and were skipped.
  const { uuidToItem, failedPaths } = seedGraph(fgGraph, graph.inputs, inputs);

  // Commit seeded values: the FactGraph persister writes to a 'live' store on set(),
  // but reads from 'store' on get(). save() syncs live → store so derived facts resolve.
  fgGraph.save();

  const nodes = {};

  for (const factName of Object.keys(graph.facts)) {
    const type = outputSet.has(factName) ? 'output' : 'intermediate';
    const fgFactPath = `/${factName}`;
    try {
      const result = fgGraph.get(fgFactPath);
      const extracted = extractResult(result, uuidToItem);
      if (extracted.state === 'incomplete') {
        nodes[factName] = { type, state: 'missing', value: null, missing: [] };
      } else {
        nodes[factName] = { type, state: extracted.state, value: extracted.value };
      }
    } catch (err) {
      nodes[factName] = { type, state: 'error', value: null, message: err.message ?? String(err) };
    }
  }

  // Override results for facts affected by type-error inputs
  if (failedPaths.size > 0) {
    const affected = findAffectedFacts(failedPaths, graph);
    for (const [factName, msg] of Object.entries(affected)) {
      const type = outputSet.has(factName) ? 'output' : 'intermediate';
      nodes[factName] = { type, state: 'error', value: null, message: msg };
    }
  }

  return new EvalResult(nodes);
}

/**
 * A Graph wrapper backed by the FactGraph engine.
 * Returned by toGraphWithFactGraph(). Call .evaluate(inputs) to produce an EvalResult.
 */
class FactGraphGraph extends Graph {
  constructor(compiled) {
    super(compiled);
  }

  evaluate(inputs) {
    return evaluateCompiledWithFactGraph(this._compiled, inputs);
  }
}

/**
 * Compile a rules document (or wrap an already-compiled graph) into a Graph
 * that evaluates using the FactGraph engine.
 *
 * Node-only — the FactGraph engine is not browser-compatible.
 * For browser use, import { toGraph } from './evaluator.js' instead.
 *
 * @param {Object} rulesDocOrGraph - rules doc or compiled graph
 * @param {string} [rulesetName]   - which ruleset to use (defaults to first)
 * @returns {Graph}
 */
export function toGraphWithFactGraph(rulesDocOrGraph, rulesetName) {
  // Already compiled
  if (rulesDocOrGraph.facts && rulesDocOrGraph.outputs) {
    return new FactGraphGraph(rulesDocOrGraph);
  }
  // Rules doc — compile first
  const rulesets = rulesDocOrGraph.rulesets ?? {};
  const name = rulesetName ?? Object.keys(rulesets)[0];
  const ruleset = rulesets[name];
  if (!ruleset) throw new Error(`Ruleset "${name}" not found`);
  const domain = rulesDocOrGraph.domain ?? 'unknown';
  const compiled = compileRuleset(domain, name, ruleset);
  return new FactGraphGraph(compiled);
}
