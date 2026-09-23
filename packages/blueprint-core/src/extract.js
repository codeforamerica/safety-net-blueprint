/**
 * Surface something already present in a contract set.
 *
 * The counterpart to `generate`: that produces an artifact the documents
 * imply, this reads out a fact they already state. The second argument says
 * which:
 *
 *   relationships  which endpoint each contract artifact generated
 *
 * Takes the whole set because the questions are cross-document by nature —
 * a single document cannot say whether its key is the first declaration.
 */

import { buildRelationshipIndex } from './indexes.js';

/** What `extract` knows how to read. */
const READERS = {
  relationships: buildRelationshipIndex,
};

/**
 * @param {import('../types.js').Doc[]} docs
 * @param {'relationships'} type - Which fact to read out
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
