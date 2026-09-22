/**
 * Resolve a contract set.
 *
 * Applies overlays, injects cross-file enum values, filters by environment and
 * substitutes variables, producing the documents a consumer reads. Nothing is
 * written here — the caller decides where the result goes, which keeps every
 * pass pure and testable without a filesystem.
 *
 * Each pass has the same contract:
 *
 *     (docs, ...args) => { docs, warnings, applied }
 *
 * It returns a new document set rather than mutating the one it was given, so
 * the pipeline is a fold and any pass can be run, reordered or tested alone.
 * `applied` is what a verbose caller reports; core does not print.
 */

import { applyOverlays } from './resolve/overlays.js';
import { injectEnumSources } from './resolve/enum-sources.js';
import { filterEnvironment } from './resolve/environment.js';
import { substituteVariables } from './resolve/variables.js';

/**
 * @param {import('../types.js').Doc[]} docs
 * @param {object} [options]
 * @param {object[]} [options.overlays] - Overlay documents to apply, in order
 * @param {string|null} [options.envTarget] - Environment to filter to
 * @param {Record<string,string>} [options.envVariables] - Values for ${VAR} placeholders
 * @returns {import('../types.js').ResolveResult}
 */
export function resolve(docs, { overlays = [], envTarget = null, envVariables = {} } = {}) {
  const pipeline = [
    (set) => applyOverlays(set, overlays),
    (set) => injectEnumSources(set),
    (set) => filterEnvironment(set, envTarget),
    (set) => substituteVariables(set, envVariables),
  ];

  const warnings = [];
  const applied = [];

  const resolved = pipeline.reduce((set, pass) => {
    const result = pass(set);
    warnings.push(...result.warnings);
    applied.push(...result.applied);
    return result.docs;
  }, docs);

  return {
    docs: resolved,
    manifest: {
      resolvedAt: new Date().toISOString(),
      overlays: overlays.map((o) => o?.info?.title ?? null).filter(Boolean),
      envTarget,
      variables: Object.keys(envVariables).sort(),
    },
    warnings,
    applied,
  };
}
