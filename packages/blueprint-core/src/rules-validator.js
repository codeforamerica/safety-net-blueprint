/**
 * Rules contract validator.
 *
 * Validates *-rules.yaml source files beyond what JSON Schema can check:
 *   - Cycle detection: no fact depends on itself directly or transitively
 *   - Unreachable nodes: facts not in outputs and not depended on by any other fact
 *   - CEL expression syntax: expressions are parseable
 *   - $ref resolution: input and output $refs resolve via the resolverMap
 *
 * Schema correctness (required fields, types, patterns) is handled upstream
 * by JSON Schema validation via each file's $schema declaration.
 *
 * Errors follow the same shape as the state machine validator:
 *   { rule: string, message: string, path: string }
 */

import { existsSync } from 'fs';
import { compileRuleset } from './rules.js';
import { resolverMap } from './index.js';

// ── Full dependency scan ──────────────────────────────────────────────────────

/**
 * Build a complete fact-to-fact dependency map by scanning all expressions
 * bidirectionally. The compiler only tracks backward references (facts can only
 * reference previously declared facts), so cycles involving forward references
 * would be silently dropped. This scan catches them.
 *
 * @param {Array<{ path: string, expression: string }>} facts
 * @returns {Object} { factPath: [referencedFactPath, ...], ... }
 */
function buildFullFactDeps(facts) {
  const factNames = new Set(facts.map(f => f.path));
  const deps = {};
  for (const factDecl of facts) {
    const refs = [];
    for (const name of factNames) {
      if (name === factDecl.path) continue;
      if (new RegExp(`\\b${name}\\b`).test(factDecl.expression || '')) {
        refs.push(name);
      }
    }
    if (refs.length > 0) deps[factDecl.path] = refs;
  }
  return deps;
}

// ── Cycle detection ───────────────────────────────────────────────────────────

/**
 * Detect facts that are part of a dependency cycle using Kahn's algorithm.
 * Adapted from the spike's topoSort (evaluate-graph.js).
 *
 * @param {Object} facts        - { factPath: { expression, ... }, ... }
 * @param {Object} dependencies - { factPath: [dep, ...], ... }
 * @returns {string[]} fact paths that are in a cycle
 */
export function detectCycles(facts, dependencies) {
  const factSet = new Set(Object.keys(facts));
  const inDegree = Object.fromEntries([...factSet].map(f => [f, 0]));
  const outEdges = Object.fromEntries([...factSet].map(f => [f, []]));

  for (const [fact, deps] of Object.entries(dependencies)) {
    if (!factSet.has(fact)) continue;
    for (const dep of deps) {
      if (factSet.has(dep)) {
        inDegree[fact]++;
        outEdges[dep].push(fact);
      }
    }
  }

  const queue = [...factSet].filter(f => inDegree[f] === 0);
  const ordered = new Set();
  while (queue.length) {
    const n = queue.shift();
    ordered.add(n);
    for (const m of outEdges[n]) {
      inDegree[m]--;
      if (inDegree[m] === 0) queue.push(m);
    }
  }

  return [...factSet].filter(f => !ordered.has(f));
}

// ── Unreachable node detection ────────────────────────────────────────────────

/**
 * Detect facts that are not reachable from any output.
 * A fact is unreachable if it is not in outputs and no other fact depends on it.
 *
 * @param {Object}   facts        - { factPath: { expression, ... }, ... }
 * @param {Object}   dependencies - { factPath: [dep, ...], ... }
 * @param {string[]} outputs      - declared output fact paths
 * @returns {string[]} unreachable fact paths
 */
export function detectUnreachable(facts, dependencies, outputs) {
  const outputSet = new Set(outputs);
  const depended = new Set();

  for (const deps of Object.values(dependencies)) {
    for (const dep of deps) depended.add(dep);
  }

  return Object.keys(facts).filter(f => !outputSet.has(f) && !depended.has(f));
}

// ── CEL expression syntax ─────────────────────────────────────────────────────

/**
 * Check whether a CEL expression is syntactically parseable.
 * Uses JavaScript's Function constructor as a lightweight parser — the
 * expressions used in rules are a CEL-compatible subset that is also
 * valid JavaScript (arithmetic, comparison, logical, ternary, member access).
 *
 * @param {string} expression
 * @returns {string|null} error message if invalid, null if valid
 */
export function checkCelSyntax(expression) {
  if (!expression || typeof expression !== 'string' || !expression.trim()) {
    return 'expression is empty';
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function('return (' + expression + ')');
    return null;
  } catch (e) {
    return e.message;
  }
}

// ── $ref resolution ───────────────────────────────────────────────────────────

/**
 * Check whether a $ref resolves to a real file via the resolverMap.
 * Only canonical blueprint URIs are checked — relative and internal refs
 * are validated by the JSON Schema and ref validators.
 *
 * @param {string} ref
 * @returns {boolean} true if resolvable or not a canonical URI
 */
export function canResolveRef(ref) {
  if (!ref || typeof ref !== 'string') return true;
  if (!ref.startsWith('http')) return true; // relative/internal refs validated elsewhere

  for (const [prefix, dir] of Object.entries(resolverMap)) {
    if (ref.startsWith(prefix)) {
      const filePath = ref.replace(prefix, dir).split('#')[0];
      return existsSync(filePath);
    }
  }

  // Unknown canonical URI — not in resolverMap
  return false;
}

/**
 * Collect all $ref values in a schema object (recursive, depth-limited).
 *
 * @param {Object} schema
 * @param {number} [depth=0]
 * @returns {string[]}
 */
function collectRefs(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 5) return [];
  const refs = [];
  if (schema.$ref) refs.push(schema.$ref);
  for (const value of Object.values(schema)) {
    if (value && typeof value === 'object') {
      refs.push(...collectRefs(value, depth + 1));
    }
  }
  return refs;
}

// ── Ruleset validator ─────────────────────────────────────────────────────────

/**
 * Validate a single ruleset.
 *
 * @param {string} domain
 * @param {string} rulesetName
 * @param {Object} ruleset
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function validateRuleset(domain, rulesetName, ruleset) {
  const errors = [];
  const base = `rulesets.${rulesetName}`;

  // Compile to get the dependency graph (used for unreachable detection)
  const graph = compileRuleset(domain, rulesetName, ruleset);

  // Build full bidirectional fact deps for cycle detection — the compiler only
  // tracks backward references, so forward-reference cycles would be missed.
  const fullFactDeps = buildFullFactDeps(ruleset.facts || []);

  // 1. Cycle detection
  for (const fact of detectCycles(graph.facts, fullFactDeps)) {
    errors.push({
      rule: 'no-cycles',
      message: `Fact "${fact}" is part of a dependency cycle`,
      path: `${base}.facts`,
    });
  }

  // 2. Unreachable nodes
  for (const fact of detectUnreachable(graph.facts, graph.dependencies, graph.outputs)) {
    errors.push({
      rule: 'no-unreachable',
      message: `Fact "${fact}" is never used and not declared in outputs`,
      path: `${base}.facts.${fact}`,
    });
  }

  // 3. Forward reference detection — a fact referencing a fact declared after it
  //    would be silently ignored by the compiler (backward-only dependency tracking)
  const declaredBefore = [];
  for (const factDecl of ruleset.facts || []) {
    const allFactNames = (ruleset.facts || []).map(f => f.path);
    const declaredAfter = allFactNames.filter(n => !declaredBefore.includes(n) && n !== factDecl.path);
    for (const name of declaredAfter) {
      if (new RegExp(`\\b${name}\\b`).test(factDecl.expression || '')) {
        errors.push({
          rule: 'no-forward-refs',
          message: `Fact "${factDecl.path}" references "${name}" which is declared after it — move "${name}" before "${factDecl.path}"`,
          path: `${base}.facts.${factDecl.path}`,
        });
      }
    }
    declaredBefore.push(factDecl.path);
  }

  // 4. CEL expression syntax
  for (const factDecl of ruleset.facts || []) {
    const syntaxError = checkCelSyntax(factDecl.expression);
    if (syntaxError) {
      errors.push({
        rule: 'cel-syntax',
        message: `Fact "${factDecl.path}" has invalid expression: ${syntaxError}`,
        path: `${base}.facts.${factDecl.path}`,
      });
    }
  }

  // 4. $ref resolution
  const schemasToCheck = [
    ...Object.values(ruleset.inputs || {}),
    ruleset.outputs,
  ].filter(Boolean);

  for (const schema of schemasToCheck) {
    for (const ref of collectRefs(schema)) {
      if (!canResolveRef(ref)) {
        errors.push({
          rule: 'ref-resolution',
          message: `$ref "${ref}" does not resolve to a known blueprint schema`,
          path: `${base}`,
        });
      }
    }
  }

  return errors;
}

/**
 * Validate all rulesets in a rules document.
 *
 * @param {Object} doc - parsed *-rules.yaml document
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function validateRulesDoc(doc) {
  const errors = [];
  const domain = doc.domain || '(unknown)';

  for (const [rulesetName, ruleset] of Object.entries(doc.rulesets || {})) {
    errors.push(...validateRuleset(domain, rulesetName, ruleset));
  }

  return errors;
}
