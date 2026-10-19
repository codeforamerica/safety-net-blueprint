/**
 * A ruleset's compiled graph, as a state gets it.
 *
 * The contracts are resolved with the package's own overlays and, for a
 * state, that state's file in states/, then compiled — the way
 * `blueprint-resolve --overlay=src/overlays --overlay=states/<state>.yaml`
 * builds them, so a state's choices reach the graph the engine runs.
 */

import { readFileSync } from 'fs';
import { join, dirname, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { discover, load, resolve, generate } from '@codeforamerica/blueprint-core';

const here = dirname(fileURLToPath(import.meta.url));
const specArg = process.argv.find((a) => a.startsWith('--spec='));
const CONTRACTS_DIR = specArg ? specArg.slice('--spec='.length) : resolvePath(here, '..', 'src');
const STATES_DIR = resolvePath(here, '..', 'states');

const docs = discover(CONTRACTS_DIR).map(load);
const packageOverlays = docs.filter((doc) => doc.type === 'overlay').map((doc) => doc.content);
const contracts = docs.filter((doc) => doc.type !== 'overlay');
const graphs = new Map();

/**
 * @param {string} ruleset - e.g. 'medicaidWorkRequirements'
 * @param {string} [state] - A state's code, e.g. 'NC'; the federal rules when absent
 * @returns {object} The compiled graph
 */
export function graphFor(ruleset, state) {
  const key = state ?? '';
  if (!graphs.has(key)) {
    const stateOverlay = state ? [yaml.load(readFileSync(join(STATES_DIR, `${state.toLowerCase()}.yaml`), 'utf8'))] : [];
    const resolved = resolve(contracts, { overlays: [...packageOverlays, ...stateOverlay] });
    graphs.set(key, generate(resolved.docs, 'graph'));
  }
  const found = graphs.get(key).find(({ graph }) => graph.ruleset === ruleset);
  if (!found) throw new Error(`No ruleset ${ruleset}${state ? ` for ${state}` : ''}`);
  return found.graph;
}
