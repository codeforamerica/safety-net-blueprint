/**
 * Apply one environment to built contracts: the release step of the
 * Twelve-Factor App's build, release, run (https://12factor.net/build-release-run),
 * as Helm fills in a chart's templates from an environment's values file and
 * Postman fills in a collection's variables from the chosen environment.
 *
 * Resolve is the build: overlays, generation and everything else that doesn't
 * differ by environment, once, leaving the environment's `${VAR}`s as
 * placeholders. This is the rest, which does:
 *
 *   applyOverlays       the environment's own overlays, for what differs in
 *                       shape, such as how callers sign in
 *   filterEnvironment   the nodes `x-environments` keeps for it
 *   substituteVariables its config: the values of the `${VAR}`s, the event
 *                       type prefix among them
 *   requireSignIn       every domain API requires the sign-in it has left
 *
 * Resolve runs it last for the environment it's given; the explorer runs it
 * in the page on contracts built without one, when the reader picks an
 * environment. Nothing here reads a file, so it runs in a browser as in Node.
 */

import { applyOverlays } from './overlays.js';
import { filterEnvironment } from './environment.js';
import { substituteVariables } from './variables.js';
import { requireSignIn } from './security.js';

/**
 * @param {import('../../types.js').Doc[]} docs - Built: resolved without an environment
 * @param {object} [environment]
 * @param {object[]} [environment.overlays] - Its overlays, applied in order
 * @param {string|null} [environment.envTarget] - The name `x-environments` lists it by
 * @param {Record<string,string>} [environment.envVariables] - Its config, the `${VAR}` values
 * @returns {{ docs: import('../../types.js').Doc[], warnings: string[], applied: string[], unresolved: string[] }}
 */
export function applyEnvironment(docs, { overlays = [], envTarget = null, envVariables = {} } = {}) {
  const passes = [
    (set) => applyOverlays(set, overlays),
    (set) => filterEnvironment(set, envTarget),
    (set) => substituteVariables(set, envVariables),
    (set) => requireSignIn(set),
  ];
  const warnings = [];
  const applied = [];
  const unresolved = new Set();
  const result = passes.reduce((set, pass) => {
    const out = pass(set);
    warnings.push(...out.warnings);
    applied.push(...out.applied);
    for (const name of out.unresolved ?? []) unresolved.add(name);
    return out.docs;
  }, docs);
  return { docs: result, warnings, applied, unresolved: [...unresolved].sort() };
}
