/**
 * The site's environments, in the page: which one the reader picked, and the
 * contracts, routing and sign-in that come with it.
 *
 * A site that lists environments in config.yaml is built from contracts
 * resolved without one, and carries each environment's config (its `${VAR}`
 * values), overlays, routing and sign-in (lib/environments.js). Picking one
 * applies it to the contracts in the page, as resolve's last step does: the
 * release step of the Twelve-Factor App's build, release, run, as Postman
 * fills in a collection from the environment picked. The pick is kept for the
 * browser tab, and each environment keeps its own records, stubs and sign-in,
 * under a scope of its own.
 *
 * A site that lists none is built from contracts already resolved, and none of
 * this applies.
 */

import { applyEnvironment, extract, generate } from '@codeforamerica/blueprint-core/browser';

/** The environments the site lists, as the build put them on the page. */
export const environments = () => globalThis.BlueprintExplorer?.environments ?? [];

const keyFor = (scope) => `blueprint-mock-environment:${scope}`;

/**
 * The environment picked for the tab: the one stored, or else the first the
 * site lists. Null for a site that lists none.
 *
 * @param {string} scope - The mock's folder, the same for every environment
 */
export function chosenEnvironment(scope) {
  const listed = environments();
  if (!listed.length) return null;
  let name = null;
  try { name = sessionStorage.getItem(keyFor(scope)); } catch { /* the first, then */ }
  return listed.find((environment) => environment.name === name) ?? listed[0];
}

/**
 * Pick an environment for the tab. The page reloads to apply it, before
 * anything runs, as a portal's environment switch does.
 *
 * @param {string} scope
 * @param {string} name
 */
export function chooseEnvironment(scope, name) {
  try { sessionStorage.setItem(keyFor(scope), name); } catch { /* this page only */ }
}

/** The environment the page applied, for what reads it later: routing and sign-in. */
let applied = null;
export const currentEnvironment = () => applied;

/** Whether the page runs against the mock: the site's first environment, or a site that lists none. */
export const inSandbox = () => !applied || applied === environments()[0];

/**
 * The site as the picked environment has it: the contracts with its release
 * applied, a version and a scope of its own, so its records, stubs and
 * sign-in are kept apart from another environment's.
 *
 * @param {{ contracts: object, version: string, scope: string }} site - As the page has them
 * @param {{ first?: boolean }} [options] - first: use the first environment the
 *   site lists, whatever was picked, as the Scenarios page does, since
 *   scenarios run against the mock
 * @returns {{ contracts: object, version: string, scope: string, environment: object|null }}
 */
export function inEnvironment({ contracts, version, scope }, { first = false } = {}) {
  const environment = first ? (environments()[0] ?? null) : chosenEnvironment(scope);
  applied = environment;
  if (!environment) return { contracts, version, scope, environment: null };
  const { docs, unresolved } = applyEnvironment(extract(contracts, 'docs'), {
    overlays: environment.overlays ?? [],
    envTarget: environment.name,
    envVariables: environment.variables ?? {},
  });
  if (unresolved.length) console.warn(`${environment.name} gives no value for ${unresolved.map((name) => `\${${name}}`).join(', ')}`);
  return {
    contracts: generate(docs, 'artifact'),
    version: `${version}:${environment.name}`,
    scope: `${scope}#${encodeURIComponent(environment.name)}`,
    environment,
  };
}
