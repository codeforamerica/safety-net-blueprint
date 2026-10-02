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
 *   examples         example records, grouped by the schema each exemplifies
 *   docs             the documents inside an artifact, as a contract set
 *
 * `state-machines` through `config` name contract types, so they read the same
 * vocabulary as `discover(dir, type)`. Each replaces a loader in
 * `blueprint-mock-server` that walked the contracts directory itself; see
 * `contract-readers.js`.
 *
 * `examples` was `generate(docs, 'examples')` until it was noticed that it
 * groups records the documents already declare rather than producing anything
 * the inputs do not contain — a readout, by this function's own definition.
 *
 * `docs` is the one case whose first argument is not a contract set but an
 * artifact: `generate(docs, 'artifact')` serializes a set, and this reads it
 * back. It belongs here rather than with `load` because the caller has already
 * read and parsed the file — in a page, `await (await fetch(…)).json()` — so
 * there is nothing left to load, only documents to rebuild (#448).
 *
 * Takes the whole set because the questions are cross-document by nature —
 * a single document cannot say whether its key is the first declaration, and
 * a state machine's `extends` names a sibling.
 */

import { buildRelationshipIndex } from './indexes.js';
import { readStateMachines, readSlaTypes, readMetrics, readConfigs } from './contract-readers.js';
import { buildExamples } from './examples.js';
import { docsFromArtifact } from './artifact.js';

/** What `extract` knows how to read. */
const READERS = {
  relationships: buildRelationshipIndex,
  'state-machines': readStateMachines,
  'sla-types': readSlaTypes,
  metrics: readMetrics,
  config: readConfigs,
  examples: buildExamples,
  docs: docsFromArtifact,
};

/**
 * @param {import('../types.js').Doc[]|object} docs - A contract set, or an
 *   artifact when reading `docs`
 * @param {'relationships'|'state-machines'|'sla-types'|'metrics'|'config'|'examples'|'docs'} type - Which fact to read out
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
