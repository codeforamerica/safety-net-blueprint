/**
 * Surface something already present in a contract set.
 *
 * The counterpart to `generate`: that produces an artifact the documents
 * imply, this reads out a fact they already state. The second argument says
 * which:
 *
 *   relationships    which endpoint each contract artifact generated
 *   state-machines   one entry per machine, extends and action $refs resolved
 *   sla-types        SLA type definitions, by domain
 *   metrics          metric definitions, by domain
 *   config           domain configuration catalogs, by domain
 *
 * The last four name contract types, so they read the same vocabulary as
 * `discover(dir, type)`. Each replaces a loader in `blueprint-mock-server`
 * that walked the contracts directory itself; see `contract-readers.js`.
 *
 * Takes the whole set because the questions are cross-document by nature —
 * a single document cannot say whether its key is the first declaration, and
 * a state machine's `extends` names a sibling.
 */

import { buildRelationshipIndex } from './indexes.js';
import { readStateMachines, readSlaTypes, readMetrics, readConfigs } from './contract-readers.js';

/** What `extract` knows how to read. */
const READERS = {
  relationships: buildRelationshipIndex,
  'state-machines': readStateMachines,
  'sla-types': readSlaTypes,
  metrics: readMetrics,
  config: readConfigs,
};

/**
 * @param {import('../types.js').Doc[]} docs
 * @param {'relationships'|'state-machines'|'sla-types'|'metrics'|'config'} type - Which fact to read out
 * @param {object} [options] - Passed to the reader that needs them
 * @returns {*} Whatever that fact is
 */
export function extract(docs, type, options) {
  const reader = READERS[type];
  if (!reader) {
    throw new Error(
      `extract: unknown type "${type}". Known types: ${Object.keys(READERS).join(', ')}.`
    );
  }
  return reader(docs, options);
}
