/**
 * Blueprint core — the contract pipeline.
 *
 *   discover(dir, type?)  find contract files on disk
 *   load(path)            parse one file into a Doc
 *   generate(docs)        derive overlays and graphs from blueprint contracts
 *   resolve(docs, opts)   apply overlays, substitute variables, resolve relationships
 *   validate(docs)        check contracts against their schemas
 *
 * Only `discover` touches the filesystem for input; only the caller writes
 * output. Everything between operates on documents already in memory.
 */

export { discover } from './discover.js';
export { load } from './load.js';
export { schemasDir, baseContractsDir, resolverMap } from './paths.js';
