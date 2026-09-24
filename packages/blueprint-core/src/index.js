/**
 * Blueprint core — the contract pipeline.
 *
 *   discover(dir, type?)  find contract files on disk
 *   load(file)            parse what discover found into a Doc
 *   generate(docs, type)  derive an artifact: 'overlay', 'graph', 'postman', 'examples'
 *   extract(docs, type)   read out a fact the documents already state
 *   resolve(docs, opts)   apply overlays, substitute variables, resolve relationships
 *   validate(docs)        check contracts against their schemas
 *
 * Alongside them, `schemasDir` and `baseContractsDir` — the directories this
 * package ships.
 *
 * Only `discover` touches the filesystem for input; only the caller writes
 * output. Everything between operates on documents already in memory.
 */

export { discover } from './discover.js';
export { load } from './load.js';
export { generate } from './generate.js';
export { extract } from './extract.js';
export { resolve } from './resolve.js';
export { validate } from './validate.js';
export { schemasDir, baseContractsDir } from './paths.js';

