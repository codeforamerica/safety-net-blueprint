/**
 * Resolve a contract set.
 *
 * Applies overlays, adds what the contracts generate, injects cross-file enum
 * values, then applies the environment: filters by it, substitutes its
 * variables, prefixes event types and requires its sign-in on every domain
 * API, producing the documents a consumer reads. Nothing is
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
 *
 * Resolve fills in and never takes an annotation away. An `x-` extension an
 * author wrote stays in the resolved document beside whatever a pass wrote
 * from it, such as the `enum` an `x-enum-source` names, so a reader of the
 * resolved set can still tell where something came from. The only things
 * removed are those an author asked to remove: an overlay's `remove`, and the
 * nodes of another environment when one is chosen.
 */

import { applyOverlays } from './resolve/overlays.js';
import { injectEnumSources } from './resolve/enum-sources.js';
import { prefixEventTypes } from './resolve/event-prefix.js';
import { resolveRelationshipAnnotations } from './resolve/relationships.js';
import { substituteConfig } from './resolve/variables.js';
import { applyEnvironment } from './resolve/apply-environment.js';
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
 * @param {object[]} [options.envOverlays] - The environment's own overlays,
 *   for what differs in shape between environments, such as how callers sign
 *   in, applied after the build (apply-environment.js)
 * @returns {import('../types.js').ResolveResult}
 * @throws {Error} When a domain or capability is none the set declares
 */
export function resolve(docs, { overlays = [], envTarget = null, envVariables = {}, apis = [], domains = [], capabilities = [], envOverlays = [] } = {}) {
  // Cross-cutting settings a state declares in the `config:` block of its
  // overlays. Read here rather than in each pass: the overlays are an argument
  // to resolve, not documents in the set, so a pass cannot reach them.
  const { config: declared, errors: configErrors } = overlayConfig(overlays);

  // Config carries `${VAR}` too. A setting like the event type prefix is a
  // fact about the deployment, not about the contract — so an overlay declares
  // that it is configurable and the environment supplies the value, rather
  // than the contract naming one jurisdiction. With no value given, the
  // placeholder is written into what it sets, as the prefix of every event
  // type, for the environment's step to fill in like any other `${VAR}`.
  const { config } = substituteConfig(declared, envVariables);

  // Order is load-bearing, not incidental:
  //   overlays first, so every later pass sees the state's customizations
  //   generation next, from the contracts as the state has them, so what a
  //     ruleset, state machine or composition implies follows its overlay,
  //     and every later pass covers the generated documents too
  //   enum injection and relationships before filtering, so they are not
  //     resolving against nodes the environment is about to remove
  //   choosing after the overlays, so they see the whole set
  //   the environment last, as one step (apply-environment.js), the release
  //     on top of the build: its overlays, filtering, its variables, after
  //     which a substituted value cannot look like an annotation, and the
  //     sign-in it requires. So contracts built without an environment can
  //     have any applied later, as the explorer does in the page.
  const pipeline = [
    (set) => applyOverlays(set, overlays),
    (set) => addGenerated(set),
    (set) => injectEnumSources(set),
    (set) => prefixEventTypes(set, config?.['x-event-type-prefix'] ?? null),
    (set) => resolveRelationshipAnnotations(set, config?.['x-relationship']?.style ?? null),
    (set) => choose(set, { apis, domains, capabilities }),
    (set) => applyEnvironment(set, { overlays: envOverlays, envTarget, envVariables }),
  ];

  const warnings = [...configErrors];
  const applied = [];

  // Placeholders that found no value. Reported as names rather than only as
  // warning prose, because a caller has to decide whether to write the result
  // — and an artifact carrying a literal `${VAR}` fails far from its cause.
  const unresolved = new Set();

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
