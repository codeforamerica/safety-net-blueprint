import { posix as posixPath } from 'node:path';
import { entriesOf, keysOf } from '../map-utils.js';

// Map keys are relative-to-projectDir paths built with node:path's `relative()`, which
// uses the OS-native separator (backslash on Windows); the XML's own `invokes` values
// always use forward slashes. Normalize both to forward slashes before comparing/joining.
function toPosix(p) {
  return p.split('\\').join('/');
}

/**
 * Resolves a raw `invokes` attribute (e.g. "../FPQ1/FPQ1Flow.erf#//@ruleflow",
 * "Calculate_premium.ers#//@ruleset", "#//@ruleflow/@connectorList.0") into
 * { kind: 'rulesheet' | 'ruleflow' | 'connector' | 'unknown', file } relative to
 * the project root, resolved against `fromRuleflowKey`'s own directory -- confirmed
 * real cross-directory references exist (DC Medicaid's `both.erf` invokes
 * "Medicaid%20Applicant/Medicaid%20Applicant.erf#//@ruleflow" from the project root).
 */
function resolveInvokes(invokes, fromRuleflowKey, ruleflowKeys, rulesheetKeys) {
  if (!invokes) return { kind: 'unknown', file: null };
  if (invokes.startsWith('#//@ruleflow/@connectorList')) return { kind: 'connector', file: null };

  const hashIndex = invokes.indexOf('#//@');
  const rawPath = hashIndex >= 0 ? invokes.slice(0, hashIndex) : invokes;
  const suffix = hashIndex >= 0 ? invokes.slice(hashIndex) : '';
  const decodedPath = decodeURIComponent(rawPath);

  const fromDir = posixPath.dirname(toPosix(fromRuleflowKey));
  const resolved = posixPath.normalize(posixPath.join(fromDir === '.' ? '' : fromDir, decodedPath));

  const ruleflowMatch = ruleflowKeys.find((key) => toPosix(key) === resolved);
  if (suffix === '#//@ruleflow' || ruleflowMatch) {
    return ruleflowMatch ? { kind: 'ruleflow', file: ruleflowMatch } : { kind: 'unknown', file: resolved };
  }
  const rulesheetMatch = rulesheetKeys.find((key) => toPosix(key) === resolved);
  if (suffix === '#//@ruleset' || rulesheetMatch) {
    return rulesheetMatch ? { kind: 'rulesheet', file: rulesheetMatch } : { kind: 'unknown', file: resolved };
  }
  return { kind: 'unknown', file: resolved };
}

function allInvokesTargets(node) {
  if (node.kind === 'ActivityNode') return [node.invokes];
  return (node.branches ?? []).flatMap((branch) => (branch.targets ?? []).map((t) => t.invokes));
}

/**
 * Resolves, for every rulesheet in the project, whether it's ever reached via an
 * `iterative="true"` node and/or a `BranchContainer`'s branches -- the signal Phase 3
 * classification needs to disambiguate a raw structural self-loop (see build-graph.js's
 * findCycles comment) into a genuine cycle, an ordinary decision-table row, or
 * null-check masking.
 *
 * Also flags two cases that fell out of building this traversal, neither confirmed in
 * any real fixture (defensive additions, not observed real patterns -- see issue #388's
 * "Additional defensive checks" section): a rulesheet never invoked from any Ruleflow
 * node at all ("unreachable"), and a rulesheet invoked from more than one distinct
 * context ("multiInvoked") -- particularly when those contexts disagree on
 * iterative/branched status. Per that same section, disagreeing contexts are combined
 * with OR (favor flagging a possible genuine cycle over missing one), not tracked
 * per-invocation-site.
 */
export function resolveRuleflowContext(project) {
  const ruleflowKeys = keysOf(project.ruleflows);
  const rulesheetKeys = keysOf(project.rulesheets);
  const ruleflowsByKey = new Map(entriesOf(project.ruleflows));

  // A ruleflow that's never the *target* of another ruleflow's invokes is an entry
  // point ("root") -- there can be more than one in a project with independent flows.
  const invokedRuleflows = new Set();
  for (const [key, ruleflow] of entriesOf(project.ruleflows)) {
    for (const node of ruleflow.nodes ?? []) {
      for (const raw of allInvokesTargets(node)) {
        const resolved = resolveInvokes(raw, key, ruleflowKeys, rulesheetKeys);
        if (resolved.kind === 'ruleflow') invokedRuleflows.add(resolved.file);
      }
    }
  }
  const roots = ruleflowKeys.filter((key) => !invokedRuleflows.has(key));

  // rulesheet file -> array of { iterative, branched } contexts it was reached through.
  const contextsByRulesheet = new Map();
  function recordContext(rulesheetFile, context) {
    if (!contextsByRulesheet.has(rulesheetFile)) contextsByRulesheet.set(rulesheetFile, []);
    contextsByRulesheet.get(rulesheetFile).push(context);
  }

  const visitedRuleflows = new Set(); // guards against ruleflow invocation cycles
  function walk(ruleflowKey, context) {
    if (visitedRuleflows.has(ruleflowKey + '|' + context.iterative + '|' + context.branched)) return;
    visitedRuleflows.add(ruleflowKey + '|' + context.iterative + '|' + context.branched);

    const ruleflow = ruleflowsByKey.get(ruleflowKey);
    if (!ruleflow) return;
    for (const node of ruleflow.nodes ?? []) {
      const nodeIterative = context.iterative || node.iterative === true;
      if (node.kind === 'ActivityNode') {
        const resolved = resolveInvokes(node.invokes, ruleflowKey, ruleflowKeys, rulesheetKeys);
        if (resolved.kind === 'rulesheet') recordContext(resolved.file, { iterative: nodeIterative, branched: context.branched });
        else if (resolved.kind === 'ruleflow') walk(resolved.file, { iterative: nodeIterative, branched: context.branched });
      } else {
        for (const branch of node.branches ?? []) {
          for (const target of branch.targets ?? []) {
            const resolved = resolveInvokes(target.invokes, ruleflowKey, ruleflowKeys, rulesheetKeys);
            if (resolved.kind === 'rulesheet') recordContext(resolved.file, { iterative: nodeIterative, branched: true });
            else if (resolved.kind === 'ruleflow') walk(resolved.file, { iterative: nodeIterative, branched: true });
          }
        }
      }
    }
  }

  for (const root of roots) walk(root, { iterative: false, branched: false });

  const perRulesheet = new Map();
  const multiInvoked = [];
  for (const rulesheetFile of rulesheetKeys) {
    const contexts = contextsByRulesheet.get(rulesheetFile) ?? [];
    const iterative = contexts.some((c) => c.iterative);
    const branched = contexts.some((c) => c.branched);
    perRulesheet.set(rulesheetFile, { iterative, branched, invocationCount: contexts.length });

    const distinctShapes = new Set(contexts.map((c) => `${c.iterative}|${c.branched}`));
    if (distinctShapes.size > 1) {
      multiInvoked.push({ rulesheet: rulesheetFile, contexts });
    }
  }

  const unreachable = rulesheetKeys.filter((key) => !contextsByRulesheet.has(key));

  return { roots, perRulesheet, unreachable, multiInvoked };
}
