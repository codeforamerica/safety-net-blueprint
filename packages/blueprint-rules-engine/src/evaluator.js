/**
 * Blueprint rules evaluator.
 *
 * Walks a compiled graph in topological order (Kahn's algorithm) and evaluates
 * each fact's CEL expression against a (possibly partial) set of inputs.
 *
 * Returns facts in three states, mirroring FactGraph's Complete/Placeholder/Incomplete:
 *   complete    — fact resolved; all inputs explicitly provided
 *   placeholder — fact resolved; at least one input used a schema default
 *   missing     — fact could not compute; missing required input paths (tracked)
 *   errors      — fact threw during evaluation
 *
 * Input scope: top-level named inputs (household, policy) are placed directly in
 * scope so expressions like "household.monthlyIncome < policy.limit" resolve via
 * JavaScript property access.
 *
 * @module evaluator
 */

import { compileRuleset } from '@codeforamerica/blueprint-core';
import { evaluateCEL } from './cel.js';

// ── Topological sort (Kahn's algorithm) ──────────────────────────────────────

function topoSort(factNames, dependencies) {
  const factSet = new Set(factNames);
  const inDegree = Object.fromEntries(factNames.map(f => [f, 0]));
  const outEdges = Object.fromEntries(factNames.map(f => [f, []]));

  for (const [fact, deps] of Object.entries(dependencies)) {
    if (!factSet.has(fact)) continue;
    for (const dep of deps) {
      if (factSet.has(dep)) {
        inDegree[fact]++;
        outEdges[dep].push(fact);
      }
    }
  }

  const queue = factNames.filter(f => inDegree[f] === 0);
  const ordered = [];
  while (queue.length) {
    const n = queue.shift();
    ordered.push(n);
    for (const m of outEdges[n]) {
      inDegree[m]--;
      if (inDegree[m] === 0) queue.push(m);
    }
  }
  return ordered;
}

// ── Input path resolution ─────────────────────────────────────────────────────

/**
 * Resolve a JSONPath input key ($.household.monthlyExpenses, $.household.members[])
 * to its value from the caller's named input objects.
 */
function resolveInputPath(path, inputs) {
  const clean = path.slice(2).replace(/\[\]$/, '');
  const parts = clean.split('.');
  let node = inputs;
  for (const part of parts) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

// ── Default scope building ────────────────────────────────────────────────────

/**
 * Build a scope object from a schema's property defaults.
 * Returns undefined if no defaults are declared.
 */
function buildDefaultScope(inputSchema) {
  if (inputSchema.type !== 'object') return undefined;
  const obj = {};
  for (const [propName, propSchema] of Object.entries(inputSchema.properties ?? {})) {
    if (propSchema.default !== undefined) {
      obj[propName] = propSchema.default;
    }
  }
  return Object.keys(obj).length > 0 ? obj : undefined;
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

/**
 * Evaluate a ruleset against a (possibly partial) set of inputs.
 *
 * @param {Object} rulesDoc      - parsed *-rules.yaml document
 * @param {Object} inputs        - named input objects, e.g. { household: { ... } }
 * @param {string} [rulesetName] - which ruleset to evaluate; defaults to the first
 * @returns {{ complete: Object, placeholder: Object, missing: Object, errors: Object }}
 *   complete:    { factName: value } — facts resolved with all explicit inputs
 *   placeholder: { factName: value } — facts resolved using schema defaults for some inputs
 *   missing:     { factName: [paths] } — facts blocked by missing required inputs
 *   errors:      { factName: message } — facts that threw during evaluation
 */
export function evaluate(rulesDoc, inputs, rulesetName) {
  const rulesets = rulesDoc?.rulesets ?? {};
  const name = rulesetName ?? Object.keys(rulesets)[0];
  const ruleset = rulesets[name];

  if (!ruleset) {
    throw new Error(`Ruleset "${name}" not found`);
  }

  const domain = rulesDoc.domain ?? 'unknown';
  const graph = compileRuleset(domain, name, ruleset);

  const factNames = Object.keys(graph.facts);
  const ordered = topoSort(factNames, graph.dependencies);

  // Build scope from inputs, falling back to schema defaults where an entire
  // input namespace is absent. Track which namespaces used defaults.
  const scope = {};
  const defaultedNamespaces = new Set();

  for (const [inputName, inputSchema] of Object.entries(ruleset.inputs ?? {})) {
    if (inputs[inputName] !== undefined) {
      scope[inputName] = inputs[inputName];
    } else {
      const defaults = buildDefaultScope(inputSchema);
      if (defaults !== undefined) {
        scope[inputName] = defaults;
        defaultedNamespaces.add(inputName);
      }
      // else: scope[inputName] remains undefined (inputs missing — fact will be blocked)
    }
  }

  const complete = {};
  const placeholder = {};
  const missing = {};
  const errors = {};

  // Track which facts were resolved (for fact-to-fact dependency propagation)
  const resolved = {};

  for (const factName of ordered) {
    const deps = graph.dependencies[factName] ?? [];
    const missingPaths = new Set();

    for (const dep of deps) {
      if (dep.startsWith('$.')) {
        const val = resolveInputPath(dep, inputs);
        if (val === undefined) {
          // Also check if it can be satisfied by a defaulted namespace
          const topLevel = dep.slice(2).split('.')[0];
          if (!defaultedNamespaces.has(topLevel)) {
            missingPaths.add(dep);
          }
        }
      } else {
        // Fact dependency — propagate missing/errors upward
        if (resolved[dep] === undefined && !errors[dep]) {
          if (missing[dep]) {
            for (const p of missing[dep]) missingPaths.add(p);
          } else {
            missingPaths.add(dep);
          }
        }
      }
    }

    if (missingPaths.size > 0) {
      missing[factName] = [...missingPaths];
      continue;
    }

    const factDecl = graph.facts[factName];
    const expr = factDecl?.expression;
    if (!expr) continue;

    const result = evaluateCEL(expr, scope);
    if (result === undefined) {
      errors[factName] = `Expression failed to evaluate: ${expr}`;
    } else {
      resolved[factName] = result;
      scope[factName] = result;

      // Determine if any input dep used a schema default → placeholder
      const usedDefault = deps.some(dep => {
        if (!dep.startsWith('$.')) return false;
        const topLevel = dep.slice(2).split('.')[0];
        return defaultedNamespaces.has(topLevel);
      });

      if (usedDefault) {
        placeholder[factName] = result;
      } else {
        complete[factName] = result;
      }
    }
  }

  // Filter to declared outputs only
  const outputSet = new Set(graph.outputs);
  return {
    complete:    Object.fromEntries(Object.entries(complete).filter(([k]) => outputSet.has(k))),
    placeholder: Object.fromEntries(Object.entries(placeholder).filter(([k]) => outputSet.has(k))),
    missing:     Object.fromEntries(Object.entries(missing).filter(([k]) => outputSet.has(k))),
    errors:      Object.fromEntries(Object.entries(errors).filter(([k]) => outputSet.has(k))),
  };
}

/**
 * Evaluate a compiled graph directly against a (possibly partial) set of inputs.
 *
 * Accepts the output of compileRuleset() or a parsed *-graph.yaml document.
 * Unlike evaluate(), this function takes a pre-compiled graph and skips the
 * compilation step. No namespace-level schema defaults are applied — all
 * inputs must be explicit.
 *
 * @param {Object} graph   - compiled graph ({ facts, dependencies, outputs, inputs, ... })
 * @param {Object} inputs  - named input objects, e.g. { household: { ... } }
 * @returns {{ complete: Object, placeholder: Object, missing: Object, errors: Object }}
 */
export function evaluateGraph(graph, inputs) {
  const factNames = Object.keys(graph.facts);
  const ordered = topoSort(factNames, graph.dependencies);

  const scope = { ...inputs };

  const complete = {};
  const placeholder = {};
  const missing = {};
  const errors = {};
  const resolved = {};

  for (const factName of ordered) {
    const deps = graph.dependencies[factName] ?? [];
    const missingPaths = new Set();

    for (const dep of deps) {
      if (dep.startsWith('$.')) {
        const val = resolveInputPath(dep, inputs);
        if (val === undefined) {
          missingPaths.add(dep);
        }
      } else {
        if (resolved[dep] === undefined && !errors[dep]) {
          if (missing[dep]) {
            for (const p of missing[dep]) missingPaths.add(p);
          } else {
            missingPaths.add(dep);
          }
        }
      }
    }

    if (missingPaths.size > 0) {
      missing[factName] = [...missingPaths];
      continue;
    }

    const factDecl = graph.facts[factName];
    const expr = factDecl?.expression;
    if (!expr) continue;

    const result = evaluateCEL(expr, scope);
    if (result === undefined) {
      errors[factName] = `Expression failed to evaluate: ${expr}`;
    } else {
      resolved[factName] = result;
      scope[factName] = result;
      complete[factName] = result;
    }
  }

  const outputSet = new Set(graph.outputs);
  return {
    complete:    Object.fromEntries(Object.entries(complete).filter(([k]) => outputSet.has(k))),
    placeholder: Object.fromEntries(Object.entries(placeholder).filter(([k]) => outputSet.has(k))),
    missing:     Object.fromEntries(Object.entries(missing).filter(([k]) => outputSet.has(k))),
    errors:      Object.fromEntries(Object.entries(errors).filter(([k]) => outputSet.has(k))),
  };
}
