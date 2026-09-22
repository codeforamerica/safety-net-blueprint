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

// Temporary, for consumers mid-migration. Both leave the surface once the CLI
// pipeline calls validate() between resolve and write, which is where schema
// conformance belongs — after overlays are applied so extended enums are in
// place, and before canonical URIs are rewritten for output.
export { resolverMap } from './paths.js';
export { validateSchemas } from './validator/json-schema-validator.js';
