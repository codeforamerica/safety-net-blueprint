/**
 * OpenAPI and contract file utilities.
 *
 * Combines:
 *   - contract-files.js: walk contract directories and detect file types
 *
 * Spec discovery and loading are `discover` and `load` on the package entry.
 * The mock server's runtime view of a spec — server base path, endpoint list,
 * pagination defaults — moved to blueprint-mock-server, which is the only
 * thing that wanted it.
 */

export { detectType, loadContractFiles } from './contract-files.js';

export {
  extractPathParams, buildParameterIndex, inferTagFromPath, buildPathEntry,
  extractRefName,
  collectionToSchemaPrefix, extractIndividualResources,
} from './utils.js';
