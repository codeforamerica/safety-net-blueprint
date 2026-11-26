/**
 * Resolve a contract set.
 *
 * Applies overlays, adds what the contracts generate, injects cross-file enum
 * values, filters by environment and substitutes variables, producing the
 * documents a consumer reads. Nothing is
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
import { generatedOverlays, rulesApis, eventsAsyncapis } from './generate.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { selectDocs } from './select.js';
import { schemasDir } from './paths.js';

/**
 * @param {import('../types.js').Doc[]} docs
 * @param {object} [options]
 * @param {object[]} [options.overlays] - The state's overlays, applied in order.
 *   Not the generated ones: resolve generates those from the overlaid contracts.
 * @param {string|null} [options.envTarget] - Environment to filter to
 * @param {Record<string,string>} [options.envVariables] - Values for ${VAR} placeholders
 * @param {string[]} [options.domains] - Keep only these domains, with what they
 *   need to stand on their own (select.js). Adds to `capabilities`.
 * @param {string[]} [options.capabilities] - Keep only these capabilities, likewise
 * @param {string[]} [options.apis] - Keep only these APIs (doc.api), with the
 *   parts of the documents beside them about their resources, likewise
 * @returns {import('../types.js').ResolveResult}
 * @throws {Error} When a domain or capability is none the set declares
 */
export function resolve(docs, { overlays = [], envTarget = null, envVariables = {}, apis = [], domains = [], capabilities = [] } = {}) {
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
  //   generation next, from the contracts as the state has them, so what a
  //     ruleset, state machine or composition implies follows its overlay,
  //     and every later pass covers the generated documents too
  //   enum injection and relationships before filtering, so they are not
  //     resolving against nodes the environment is about to remove
  //   variables after that, so a substituted value cannot look like an annotation
  //   choosing last, so overlays see the whole set, and what's kept is
  //     judged by the contracts as they'll be written
  const pipeline = [
    (set) => applyOverlays(set, overlays),
    (set) => addGenerated(set),
    (set) => injectEnumSources(set),
    (set) => prefixEventTypes(set, config?.['x-event-type-prefix'] ?? null),
    (set) => resolveRelationshipAnnotations(set, config?.['x-relationship']?.style ?? null),
    (set) => filterEnvironment(set, envTarget),
    (set) => substituteVariables(set, envVariables),
    (set) => choose(set, { apis, domains, capabilities }),
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

/**
 * Add what the contracts generate: the API document beside each rules file,
 * the events AsyncAPI beside each OpenAPI document, and the endpoints
 * compositions, rulesets and state machine actions imply, applied as
 * overlays. Run on the overlaid set, so a state that moves a ruleset's
 * endpoint or describes an event differently sees that in what is generated.
 *
 * A state doesn't overlay a generated document; it changes what generation
 * reads.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {{ docs: import('../types.js').Doc[], warnings: string[], applied: string[] }}
 */
function addGenerated(docs) {
  const added = [...rulesApis(docs), ...eventsAsyncapis(docs)];
  const set = [...docs, ...added];
  const result = applyOverlays(set, generatedOverlays(set));
  const applied = added.length ? [`Generated ${added.map((doc) => doc.relativePath).join(', ')}`] : [];
  return { ...result, applied: [...applied, ...result.applied] };
}

/**
 * Keep only the chosen domains and capabilities, and what they need to stand
 * on their own (select.js); the whole set when nothing is chosen.
 *
 * @param {import('../types.js').Doc[]} docs
 * @param {{ apis: string[], domains: string[], capabilities: string[] }} choice
 * @returns {{ docs: import('../types.js').Doc[], warnings: string[], applied: string[] }}
 */
function choose(docs, { apis, domains, capabilities }) {
  if (!apis.length && !domains.length && !capabilities.length) return { docs, warnings: [], applied: [] };
  const kept = selectDocs(docs, { apis, domains, capabilities, schemaRefs: blueprintSchemaRefs });
  const named = [...apis.map((a) => `API ${a}`), ...domains.map((d) => `domain ${d}`), ...capabilities.map((c) => `capability ${c}`)].join(', ');
  return { docs: kept, warnings: [], applied: [`Kept ${kept.length} of ${docs.length} documents: ${named}, with what they need`] };
}

const schemaRefCache = new Map();

/** The `$ref`s a blueprint schema makes, by its file name; none for one core doesn't ship. */
function blueprintSchemaRefs(name) {
  if (!schemaRefCache.has(name)) {
    let refs = [];
    try {
      const text = readFileSync(join(schemasDir, name), 'utf8');
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (typeof node.$ref === 'string') refs.push(node.$ref);
        for (const value of Object.values(node)) walk(value);
      };
      walk(yaml.load(text));
    } catch {
      refs = [];
    }
    schemaRefCache.set(name, refs);
  }
  return schemaRefCache.get(name);
}
