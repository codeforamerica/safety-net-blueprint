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
export { generate } from './generate.js';
export { resolve } from './resolve.js';
export { validate } from './validate.js';
export { schemasDir, baseContractsDir } from './paths.js';

// Still exported while consumers migrate; `load` and `validate` resolve
// canonical URLs internally, so this leaves the surface once the CLI stops
// passing it back in.
export { resolverMap } from './paths.js';
