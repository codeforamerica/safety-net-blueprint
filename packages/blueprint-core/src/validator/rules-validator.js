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
import { compileRuleset, listFactOf } from '../rules.js';
import { resolverMap } from '../paths.js';
import { celSyntaxError, inputOf } from '../cel.js';

// ── Full dependency scan ──────────────────────────────────────────────────────


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
 * Check whether a CEL expression parses, with the CEL implementation the mock
 * server and rules engine evaluate it with. This used to ask JavaScript
 * whether the expression parsed as JavaScript, which passed `a?.b`,
 * `new Date()` and `$this.name` — none of them CEL.
 *
 * @param {string} expression
 * @returns {string|null} error message if invalid, null if valid
 */
export function checkCelSyntax(expression) {
  return celSyntaxError(expression);
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

  // 1. Cycle detection
  //
  // The compiled graph's own dependencies are used. They used to be
  // backward-only, so a cycle formed through a forward reference was invisible
  // and this scanned the expressions again to find one — two dependency
  // scanners, disagreeing by construction. The compiler records every edge
  // now, so there is one.
  for (const fact of detectCycles(graph.facts, graph.dependencies)) {
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

  // Every name in an expression's scope means one thing. Inputs and facts share
  // that scope, and a dot nests in it — `household.income` is a field of the
  // input `household`, and `risks.cashIncome` a fact in the group `risks` — so
  // a fact can't repeat another, start with an input's name, or be a group too.
  const inputNames = new Set(Object.keys(ruleset.inputs || {}));
  // Constants are in scope as `constants`, so that name is taken too.
  if (ruleset.constants) {
    if (inputNames.has('constants')) {
      errors.push({
        rule: 'constants-input',
        message: 'An input named "constants" would hide the ruleset\'s constants, which facts read as `constants.<name>`. Rename the input.',
        path: `${base}.inputs.constants`,
      });
    }
    inputNames.add('constants');
    // A date constant that doesn't parse would reach the evaluator as a plain
    // string, and every comparison with a date input would fail to evaluate.
    for (const [name, constant] of Object.entries(ruleset.constants)) {
      if (!['date', 'date-time'].includes(constant?.format)) continue;
      const pattern = constant.format === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T/;
      if (typeof constant.value !== 'string' || !pattern.test(constant.value) || Number.isNaN(Date.parse(constant.value))) {
        errors.push({
          rule: 'constant-format',
          message: `Constant "${name}" is a ${constant.format}, but its value ${JSON.stringify(constant.value)} is not one. Write it as ${constant.format === 'date' ? '2027-01-01' : '2027-01-01T00:00:00Z'}.`,
          path: `${base}.constants.${name}`,
        });
      }
    }
  }
  const paths = new Set();
  for (const { path } of ruleset.facts || []) {
    if (typeof path !== 'string') continue;
    if (paths.has(path)) {
      errors.push({
        rule: 'duplicate-fact',
        message: `Fact "${path}" is declared more than once.`,
        path: `${base}.facts.${path}`,
      });
    }
    paths.add(path);
    const first = path.split('.')[0];
    if (inputNames.has(first)) {
      errors.push({
        rule: 'fact-shadows-input',
        message: `Fact "${path}" starts with the input "${first}", so the two can't be told apart in an expression. Rename the fact.`,
        path: `${base}.facts.${path}`,
      });
    }
  }
  for (const path of paths) {
    const segments = path.split('.');
    for (let i = 1; i < segments.length; i++) {
      const group = segments.slice(0, i).join('.');
      if (paths.has(group)) {
        errors.push({
          rule: 'fact-is-a-group',
          message: `"${group}" is a fact and also groups "${path}". A path is one or the other: rename the fact, or the group.`,
          path: `${base}.facts.${group}`,
        });
      }
    }
  }

  errors.push(...validatePerItemFacts(ruleset, graph, inputNames, base));

  // 4. $ref resolution
  const schemasToCheck = [
    ...Object.values(ruleset.inputs || {}),
    ...Object.values(ruleset.outputs || {}),
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
 * Per-item facts: each is on a list fact, and the names its expression reads
 * an item by mean one thing.
 *
 * - `per-item-without-list`: `x[].y` needs a fact `x` that declares `as`.
 * - `as-name-in-use`: an item's name can't be an input, a fact, `constants`,
 *   or an enclosing item's name, or the expression couldn't tell them apart.
 * - `item-field-name-in-use`: a fact on an item can't be named like a field
 *   the item already has, or `month.hoursWorked` would mean two things.
 *
 * @param {Object} ruleset
 * @param {Object} graph - The ruleset compiled
 * @param {Set<string>} inputNames - Every input's name, and `constants` if declared
 * @param {string} base - Where the ruleset sits, for error paths
 * @returns {{ rule: string, message: string, path: string }[]}
 */
function validatePerItemFacts(ruleset, graph, inputNames, base) {
  const errors = [];
  const decls = Object.fromEntries((ruleset.facts || []).filter((f) => typeof f.path === 'string').map((f) => [f.path, f]));
  const taken = new Set([...inputNames, 'constants', ...Object.keys(decls).filter((p) => !p.includes('[]')).map((p) => p.split('.')[0])]);

  for (const [path, { as }] of Object.entries(decls)) {
    const list = listFactOf(path);
    if (list && !decls[list]?.as) {
      errors.push({
        rule: 'per-item-without-list',
        message: `Fact "${path}" is on the items of "${list}", which is not a list fact. Declare "${list}" with \`as\`, naming its items.`,
        path: `${base}.facts.${path}`,
      });
    }
    if (!as) continue;
    const enclosing = [];
    for (let l = list; l; l = listFactOf(l)) if (decls[l]?.as) enclosing.push(decls[l].as);
    if (taken.has(as) || enclosing.includes(as)) {
      errors.push({
        rule: 'as-name-in-use',
        message: `Fact "${path}" names its items "${as}", which is already an input, a fact, \`constants\` or an enclosing item's name. Choose another name.`,
        path: `${base}.facts.${path}`,
      });
    }
  }

  // An item's fields are known when its items are an input's: the fields
  // declared under that input.
  const inputPaths = Object.keys(graph.inputs);
  const listInput = Object.fromEntries(Object.keys(decls).filter((p) => decls[p].as).map((p) => [p, inputOf(graph, p)]));
  for (const path of Object.keys(decls)) {
    const list = listFactOf(path);
    if (!list || !listInput[list]) continue;
    const name = path.slice(list.length + 3);
    if (inputPaths.some((p) => [`${listInput[list]}.${name}`, `${listInput[list]}.${name}[]`].includes(p) || p.startsWith(`${listInput[list]}.${name}.`))) {
      errors.push({
        rule: 'item-field-name-in-use',
        message: `Fact "${path}" has the name of a field "${list}"'s items already have, so \`${decls[list].as}.${name}\` would mean two things. Rename the fact.`,
        path: `${base}.facts.${path}`,
      });
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

