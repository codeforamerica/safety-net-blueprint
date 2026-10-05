/**
 * What the blueprint-authored contract types declare, read out of a set.
 *
 * These are the readers behind `extract(docs, 'state-machines')` and its three
 * siblings. Each had an implementation in `blueprint-mock-server` that did its
 * own `readdirSync` over the contracts directory, filtered by a hardcoded
 * filename suffix, parsed the YAML itself and skipped documents missing a
 * `domain` — four copies of what `discover` and `load` already do, and four
 * reasons the server could not run without a filesystem.
 *
 * They are readers rather than generators in `extract`'s sense: every field
 * returned is stated in the documents. The one exception is the state machine
 * reader, which follows `extends` and the `$ref`s in action schemas, and even
 * that resolves within the set rather than deriving anything new.
 *
 * Unlike the loaders these replace, a document that declares none of the
 * section being asked for is skipped silently instead of warning. `validate`
 * is what reports a malformed contract; a reader that writes to stderr makes
 * every consumer inherit that choice.
 */

import { followRef, indexByRelativePath, splitRef, pointerInto } from './ref-lookup.js';

/** Envelope keys a config document carries that are not catalogs. */
const CONFIG_METADATA_KEYS = new Set(['$schema', 'version', 'domain']);

/** @param {import('../types.js').Doc[]} docs @param {string} type */
const ofType = (docs, type) => docs.filter((d) => d.type === type && d.content?.domain);

/**
 * SLA type definitions, by domain.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {{ domain: string, slaTypes: object[], relativePath: string|null }[]}
 */
export function readSlaTypes(docs) {
  return ofType(docs, 'sla-types')
    .filter((doc) => doc.content.slaTypes)
    .map((doc) => ({
      domain: doc.content.domain,
      slaTypes: doc.content.slaTypes,
      relativePath: doc.relativePath,
    }));
}

/**
 * Metric definitions, by domain.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {{ domain: string, metrics: object[], relativePath: string|null }[]}
 */
export function readMetrics(docs) {
  return ofType(docs, 'metrics')
    .filter((doc) => doc.content.metrics)
    .map((doc) => ({
      domain: doc.content.domain,
      metrics: doc.content.metrics,
      relativePath: doc.relativePath,
    }));
}

/**
 * Domain configuration catalogs, by domain.
 *
 * A catalog is any top-level array the document declares; everything else at
 * the top level is envelope metadata. `*-config-schema.yaml` is excluded for
 * free, because `discover` types it as `schema` rather than `config`.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {{ domain: string, version: string, catalogs: Record<string, object[]>, relativePath: string|null }[]}
 */
export function readConfigs(docs) {
  return ofType(docs, 'config').map((doc) => {
    const catalogs = {};
    for (const [key, value] of Object.entries(doc.content)) {
      if (!CONFIG_METADATA_KEYS.has(key) && Array.isArray(value)) catalogs[key] = value;
    }
    return {
      domain: doc.content.domain,
      version: doc.content.version,
      catalogs,
      relativePath: doc.relativePath,
    };
  });
}

/**
 * State machines, one entry per machine.
 *
 * Two authored shapes are flattened to one result shape. The current format
 * declares `machines: [{ object, states, actions, ... }]`; the older one puts
 * a single machine's `object` and `transitions` at the top level. Either way
 * `machine` points at the machine and `stateMachine` at the document holding
 * it, so a caller never has to ask which shape it was given.
 *
 * Two things are resolved against the set while reading:
 *
 *   `extends:`        the extended document's guards and procedures are
 *                     attached as `_platformGuards` / `_platformProcedures`.
 *                     Matched on filename alone, ignoring any directory part,
 *                     so moving a file does not require editing every
 *                     document that extends it.
 *   action `$ref`s    `schema.request` and `schema.response` are replaced by
 *                     what they point at.
 *
 * @param {import('../types.js').Doc[]} docs
 * @returns {{ domain: string, object: string, apiSpec: string|null, stateMachine: object, machine: object, relativePath: string|null }[]}
 */
export function readStateMachines(docs) {
  const byRelativePath = indexByRelativePath(docs);

  // Every state machine document, including one that declares only guards and
  // procedures. Such a document is a library: it exists to be extended, has no
  // machines of its own, and declares no domain, because its identity is not
  // domain-scoped — a contract set is not obliged to have any particular
  // domain for it to sit in.
  const machineDocs = docs.filter((d) => d.type === 'state-machine' && d.content);

  // An entry needs both: machines to describe, and a domain to be filed under.
  // A library document has neither and is not an entry — but it stays in
  // `machineDocs` above so `extends` can find it. Filtering the whole set on
  // `domain` up front, which is what this did first, dropped the library
  // document before `extends` ran and lost every inherited guard.
  //
  // A document with machines and no domain is invalid — the schema's
  // `dependentRequired` says so — and is skipped here rather than returned
  // with `domain: undefined`, which anything indexing by domain would file
  // under the string "undefined". `validate` is what reports it.
  const isEntry = (d) =>
    (d.content.machines !== undefined || d.content.object !== undefined) && d.content.domain;

  // Check every document's `extends`, not only the ones that become entries. A
  // library document may itself declare one, and skipping the check there would
  // let a broken reference through on the one kind of document whose whole
  // purpose is to be referenced. Resolving it changes no output today —
  // inheritance is one level deep — but an unresolvable reference is still
  // broken, and finding out here beats finding out as a missing guard.
  for (const doc of machineDocs) {
    findExtended(doc.content, machineDocs, doc.relativePath);
  }

  const results = [];

  for (const doc of machineDocs.filter(isEntry)) {
    // Resolution mutates, so each document gets its own copy rather than
    // having inherited guards written onto the Doc every caller shares.
    const stateMachine = structuredClone(doc.content);

    attachExtended(stateMachine, machineDocs, doc.relativePath);
    resolveActionSchemas(stateMachine, byRelativePath, doc.relativePath);

    const entry = {
      domain: stateMachine.domain,
      apiSpec: stateMachine.apiSpec ?? null,
      stateMachine,
      relativePath: doc.relativePath,
    };

    if (Array.isArray(stateMachine.machines)) {
      for (const machine of stateMachine.machines) {
        if (!machine.object) continue;
        results.push({ ...entry, object: machine.object, machine });
      }
    } else if (stateMachine.object) {
      results.push({ ...entry, object: stateMachine.object, machine: stateMachine });
    }
  }

  return results;
}

const basename = (p) => p.slice(p.lastIndexOf('/') + 1);

/**
 * The document an `extends` names, or null when there is no `extends`.
 *
 * Matched by filename because the `extends` value carries a path prefix that
 * is relative to wherever the file happened to live when it was written.
 *
 * Throws when the named document is not in the set. Silence here is the worst
 * available option: an engine evaluating these treats a guard it cannot find
 * as satisfied, so a document that failed to inherit its guards would pass
 * every transition those guards were supposed to gate. A contract naming a
 * file that is not there is a broken contract, not a degraded one.
 *
 * @param {object} stateMachine - A state machine document
 * @param {import('../types.js').Doc[]} machineDocs
 * @param {string|null} from - relativePath of the extending document, for the error
 * @returns {import('../types.js').Doc|null}
 * @throws {Error} When `extends` names no document in the set
 */
function findExtended(stateMachine, machineDocs, from) {
  if (!stateMachine?.extends) return null;

  const wanted = basename(stateMachine.extends);
  const extended = machineDocs.find((d) => d.relativePath && basename(d.relativePath) === wanted);

  if (!extended) {
    const available = machineDocs.map((d) => basename(d.relativePath ?? '')).sort().join(', ');
    throw new Error(
      `${from ?? 'a state machine'} declares extends: "${stateMachine.extends}", ` +
        `but no state machine named "${wanted}" is in the contract set. ` +
        `Its guards and procedures would be missing, and a guard that cannot be ` +
        `found is treated as satisfied. Available: ${available || '(none)'}.`
    );
  }

  return extended;
}

/**
 * Attach the extended document's guards and procedures.
 *
 * @param {object} stateMachine - A copy, mutated in place
 * @param {import('../types.js').Doc[]} machineDocs
 * @param {string|null} from - relativePath of the extending document, for the error
 */
function attachExtended(stateMachine, machineDocs, from) {
  const extended = findExtended(stateMachine, machineDocs, from);
  if (!extended) return;

  stateMachine._platformGuards = extended.content.guards ?? [];
  stateMachine._platformProcedures = extended.content.procedures ?? [];
}

/**
 * Replace `$ref`s in every action's request and response schema.
 *
 * A same-document ref is resolved against the state machine itself; a
 * cross-file one against the set. An unresolvable one throws, for the same
 * reason `extends` does: the alternative is a `{ $ref: … }` object left sitting
 * where a schema should be, which validates every request body against
 * nothing at all.
 *
 * @param {object} stateMachine - A copy, mutated in place
 * @param {Map<string, *>} byRelativePath
 * @param {string|null} fromPath
 * @throws {Error} When a `$ref` names nothing in the set
 */
function resolveActionSchemas(stateMachine, byRelativePath, fromPath) {
  const target = (ref) => {
    const { file, pointer } = splitRef(ref);
    if (!file) return pointerInto(stateMachine, pointer);
    return followRef(ref, byRelativePath, fromPath)?.node;
  };

  for (const machine of stateMachine.machines ?? []) {
    for (const action of machine.actions ?? []) {
      for (const slot of ['request', 'response']) {
        const ref = action.schema?.[slot]?.$ref;
        if (typeof ref !== 'string') continue;

        const resolved = target(ref);
        if (!resolved) {
          throw new Error(
            `${fromPath ?? 'a state machine'} :: ${machine.object}.${action.id} ${slot} ` +
              `declares $ref: "${ref}", which names nothing in the contract set. ` +
              `The unresolved ref would be used as the schema, validating the ${slot} against nothing.`
          );
        }
        action.schema[slot] = resolved;
      }
    }
  }
}
