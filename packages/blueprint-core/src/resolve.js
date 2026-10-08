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
import { prefixEventTypes } from './resolve/event-prefix.js';
import { resolveRelationshipAnnotations } from './resolve/relationships.js';
import { filterEnvironment } from './resolve/environment.js';
import { substituteVariables, substituteConfig } from './resolve/variables.js';
import { overlayConfig } from './overlay/config.js';

/**
 * @param {import('../types.js').Doc[]} docs
 * @param {object} [options]
 * @param {object[]} [options.overlays] - Overlay documents to apply, in order
 * @param {string|null} [options.envTarget] - Environment to filter to
 * @param {Record<string,string>} [options.envVariables] - Values for ${VAR} placeholders
 * @returns {import('../types.js').ResolveResult}
 */
export function resolve(docs, { overlays = [], envTarget = null, envVariables = {} } = {}) {
  // Cross-cutting settings a state declares in the `config:` block of its
  // overlays. Read here rather than in each pass: the overlays are an argument
  // to resolve, not documents in the set, so a pass cannot reach them.
  const { config: declared, errors: configErrors } = overlayConfig(overlays);

  // Config carries `${VAR}` too, resolved here because the passes below read
  // it. A setting like the event type prefix is a fact about the deployment,
  // not about the contract — so an overlay declares that it is configurable
  // and the environment supplies the value, rather than the contract naming
  // one jurisdiction.
  const { config, warnings: configWarnings, unresolved: configUnresolved } =
    substituteConfig(declared, envVariables);

  // Order is load-bearing, not incidental:
  //   overlays first, so every later pass sees the state's customizations
  //   enum injection and relationships before filtering, so they are not
  //     resolving against nodes the environment is about to remove
  //   variables last, so a substituted value cannot look like an annotation
  const pipeline = [
    (set) => applyOverlays(set, overlays),
    (set) => injectEnumSources(set),
    (set) => prefixEventTypes(set, config?.['x-event-type-prefix'] ?? null),
    (set) => resolveRelationshipAnnotations(set, config?.['x-relationship']?.style ?? null),
    (set) => filterEnvironment(set, envTarget),
    (set) => substituteVariables(set, envVariables),
  ];

  const warnings = [...configErrors, ...configWarnings];
  const applied = [];

  // Placeholders that found no value. Reported as names rather than only as
  // warning prose, because a caller has to decide whether to write the result
  // — and an artifact carrying a literal `${VAR}` fails far from its cause.
  const unresolved = new Set(configUnresolved);

  const resolved = pipeline.reduce((set, pass) => {
    const result = pass(set);
    warnings.push(...result.warnings);
    applied.push(...result.applied);
    for (const name of result.unresolved ?? []) unresolved.add(name);
    return result.docs;
  }, docs);

  return {
    docs: resolved,
    warnings,
    applied,
    unresolved: [...unresolved].sort(),
  };
}
