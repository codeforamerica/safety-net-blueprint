/**
 * OpenAPI and contract file loading utilities.
 *
 * Combines:
 *   - openapi-loader.js: discover, load, and parse OpenAPI specs
 *   - bundle.js: inline all external $refs into a single spec object
 *   - contract-files.js: walk contract directories and detect file types
 */

export {
  discoverApiSpecs,
  loadSpec,
  loadAllSpecs,
  extractMetadata,
  collectionToSchemaPrefix,
  extractIndividualResources,
} from './validation/openapi-loader.js';

export { bundleSpec } from './bundle.js';

export { detectType, loadContractFiles, loadExternalRefs } from './contract-files.js';
