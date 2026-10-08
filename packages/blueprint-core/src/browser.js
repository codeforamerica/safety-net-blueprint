/**
 * The portable half of blueprint-core.
 *
 *   extract(docs, type)      read out a fact the documents already state
 *   extract(artifact, 'docs') rebuild a contract set from a bundled artifact
 *   generate(docs, type)     derive an artifact from them
 *
 * `extract(artifact, 'docs')` is how a page gets documents at all: the caller
 * fetches and parses the file, this turns that data back into the same `Doc`
 * objects `discover(dir).map(load)` produces in Node, methods and all. From
 * there nothing downstream can tell the two apart.
 *
 * Both operate on documents already in memory, so neither needs a filesystem.
 * This entry exists because the main one cannot be reached without one: a
 * bundler resolves every import in a module graph before it tree-shakes, so
 * `index.js` re-exporting `discover` is enough to fail a browser build even
 * when the consumer imports nothing but `extract` (#448).
 *
 *   import { extract, generate } from '@codeforamerica/blueprint-core/browser';
 *
 * Deliberately a smaller surface rather than a second implementation, which is
 * why it is its own subpath instead of a `"browser"` condition on `"."`. A
 * condition would resolve `discover` to undefined in a page and fail somewhere
 * unrelated; an absent export fails at the import.
 *
 * `discover` and `load` are missing because they read the contract set, and a
 * page has no directory to read — `blueprint-bundle-contracts` does that work
 * ahead of time and ships the result. `validate` and `resolve` are missing for
 * a different reason: they read resources this package ships (the schemas to
 * validate against, overlay documents) rather than anything the caller
 * supplies. Those could become portable by bundling those resources the same
 * way contracts are bundled, which would make validation work in a page.
 *
 * Nothing here is re-implemented. `index.js` re-exports this module, so the
 * portable surface is defined once and the two entries cannot drift.
 */

export { extract } from './extract.js';
export { generate } from './generate.js';
