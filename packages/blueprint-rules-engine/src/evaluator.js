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

// ── Type checking ─────────────────────────────────────────────────────────────

/**
 * Check whether a runtime value matches its declared schema type.
 * null is treated as a type error (explicitly provided as wrong type),
 * undefined is absence (handled separately as missing).
 */
export function matchesType(val, declaredType) {
  const actual = Array.isArray(val) ? 'array' : val === null ? 'null' : typeof val;
  switch (declaredType) {
    case 'integer':
    case 'number':  return actual === 'number';
    case 'boolean': return actual === 'boolean';
    case 'string':  return actual === 'string';
    case 'array':   return actual === 'array';
    case 'object':  return actual === 'object';
    default:        return true;
  }
}

/**
 * Find declared array-typed input paths whose runtime value is null.
 * FactGraph's seedGraph skips null collections (treating them as absent),
 * and the Scala engine evaluates filters over an unset collection as Placeholder([]).
 * We replicate this: null collection → patch scope with [] → result is placeholder.
 */
function buildNullCollectionPaths(graphInputs, inputs) {
  const nullPaths = new Set();
  for (const [path, spec] of Object.entries(graphInputs ?? {})) {
    if (spec.type !== 'array') continue;
    const val = resolveInputPath(path, inputs);
    if (val === null) nullPaths.add(path);
  }
  return nullPaths;
}

/**
 * Patch a scope object so that null array values become [].
 * Clones affected namespace objects to avoid mutating the caller's inputs.
 */
function patchNullCollections(scope, inputs, nullCollectionPaths) {
  for (const path of nullCollectionPaths) {
    // '$.household.members[]' → 'household.members' → ['household', 'members']
    const clean = path.slice(2).replace(/\[\]$/, '');
    const parts = clean.split('.');
    const namespace = parts[0];
    // Shallow-clone the namespace so we don't mutate the user's object
    if (scope[namespace] === inputs[namespace]) {
      scope[namespace] = { ...inputs[namespace] };
    }
    let obj = scope[namespace];
    for (let i = 1; i < parts.length - 1; i++) {
      if (obj[parts[i]] != null) obj[parts[i]] = { ...obj[parts[i]] };
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = [];
  }
}

/**
 * Build a map of type errors for all declared input paths.
 * Only flags values that are present but have the wrong type.
 *
 * For scalar paths ($.household.monthlyIncome), the path itself is the map key.
 * For sub-field paths ($.household.members[].age), the *parent collection path*
 * ($.household.members[]) is the key — this aligns with the dependency graph,
 * where facts declare a dep on the collection, not individual sub-fields.
 * If any item in the collection has a wrong-type field, the whole collection
 * is flagged so all dependent facts are moved to errors.
 */
function buildInputTypeErrors(graphInputs, inputs) {
  const typeErrors = new Map();
  for (const [path, spec] of Object.entries(graphInputs ?? {})) {
    const inner = path.slice(2); // strip '$.'
    const subFieldIdx = inner.indexOf('[].');
    if (subFieldIdx !== -1) {
      // Sub-field path: e.g. $.household.members[].age
      const collRef = inner.slice(0, subFieldIdx);          // household.members
      const fieldName = inner.slice(subFieldIdx + 3);       // age
      const collPath = `$.${collRef}[]`;                    // $.household.members[]
      if (typeErrors.has(collPath)) continue;               // already flagged
      // Resolve the parent array
      const collParts = collRef.split('.');
      let arr = inputs;
      for (const p of collParts) {
        if (arr == null) break;
        arr = arr[p];
      }
      if (!Array.isArray(arr)) continue;
      // Check each item's field — null treated as absent, not a type error
      for (const item of arr) {
        const val = item[fieldName];
        if (val != null && !matchesType(val, spec.type)) {
          const actual = Array.isArray(val) ? 'array' : typeof val;
          typeErrors.set(collPath, `expected ${spec.type} for .${fieldName}, got ${actual}`);
          break;
        }
      }
    } else {
      // Scalar or top-level array path
      const val = resolveInputPath(path, inputs);
      // null is treated as absent (missing), not a type error — matches FactGraph's seedGraph
      // behavior of skipping null/undefined inputs rather than rejecting them.
      if (val != null && !matchesType(val, spec.type)) {
        const actual = Array.isArray(val) ? 'array' : typeof val;
        typeErrors.set(path, `expected ${spec.type}, got ${actual}`);
      }
    }
  }
  return typeErrors;
}

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

  // Patch null collections to [] in scope, matching FactGraph's behavior of evaluating
  // filters over unset collections as Placeholder([]).
  const nullCollectionPaths = buildNullCollectionPaths(graph.inputs, inputs);
  patchNullCollections(scope, inputs, nullCollectionPaths);

  const complete = {};
  const placeholder = {};
  const missing = {};
  const errors = {};

  // Track which facts were resolved (for fact-to-fact dependency propagation)
  const resolved = {};

  // Pre-compute type errors for all declared input paths
  const inputTypeErrors = buildInputTypeErrors(graph.inputs, inputs);

  for (const factName of ordered) {
    const deps = graph.dependencies[factName] ?? [];
    const missingPaths = new Set();
    const erroredDeps = new Set();
    const defaultedDeps = new Set();

    for (const dep of deps) {
      if (dep.startsWith('$.')) {
        if (inputTypeErrors.has(dep)) {
          erroredDeps.add(dep);
        } else if (nullCollectionPaths.has(dep)) {
          defaultedDeps.add(dep);
        } else {
          const val = resolveInputPath(dep, inputs);
          if (val == null) {
            const topLevel = dep.slice(2).split('.')[0];
            if (!defaultedNamespaces.has(topLevel)) {
              missingPaths.add(dep);
            }
          }
        }
      } else {
        // Fact dependency — propagate errors or missing upward
        if (errors[dep]) {
          erroredDeps.add(dep);
        } else if (resolved[dep] === undefined) {
          if (missing[dep]) {
            for (const p of missing[dep]) missingPaths.add(p);
          } else {
            missingPaths.add(dep);
          }
        }
      }
    }

    if (erroredDeps.size > 0) {
      const details = [...erroredDeps].map(d =>
        inputTypeErrors.has(d) ? `'${d}' — ${inputTypeErrors.get(d)}` : `'${d}' — ${errors[d]}`
      ).join('; ');
      errors[factName] = `Dependency error: ${details}`;
      continue;
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

      // Placeholder if any dep used a schema default or was a null-patched collection
      const usedDefault = defaultedDeps.size > 0 || deps.some(dep => {
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

  // Pre-compute type errors for all declared input paths (including sub-fields)
  const inputTypeErrors = buildInputTypeErrors(graph.inputs, inputs);

  // Patch null collections to [] in scope, matching FactGraph's placeholder behavior
  const nullCollectionPaths = buildNullCollectionPaths(graph.inputs, inputs);
  patchNullCollections(scope, inputs, nullCollectionPaths);

  for (const factName of ordered) {
    const deps = graph.dependencies[factName] ?? [];
    const missingPaths = new Set();
    const erroredDeps = new Set();

    for (const dep of deps) {
      if (dep.startsWith('$.')) {
        if (inputTypeErrors.has(dep)) {
          erroredDeps.add(dep);
        } else if (nullCollectionPaths.has(dep)) {
          // null collection → evaluates with [] in scope → will be placeholder after eval
        } else if (resolveInputPath(dep, inputs) == null) {
          missingPaths.add(dep);
        }
      } else {
        // Fact dependency — propagate errors or missing upward
        if (errors[dep]) {
          erroredDeps.add(dep);
        } else if (resolved[dep] === undefined) {
          if (missing[dep]) {
            for (const p of missing[dep]) missingPaths.add(p);
          } else {
            missingPaths.add(dep);
          }
        }
      }
    }

    if (erroredDeps.size > 0) {
      const details = [...erroredDeps].map(d =>
        inputTypeErrors.has(d) ? `'${d}' — ${inputTypeErrors.get(d)}` : `'${d}' — ${errors[d]}`
      ).join('; ');
      errors[factName] = `Dependency error: ${details}`;
      continue;
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

      // Placeholder if any dep was a null-patched collection
      const usedNullCollection = deps.some(dep => nullCollectionPaths.has(dep));
      if (usedNullCollection) {
        placeholder[factName] = result;
      } else {
        complete[factName] = result;
      }
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
