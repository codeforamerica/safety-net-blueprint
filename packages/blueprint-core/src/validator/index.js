/**
 * Contract validation utilities, used by `validate`.
 *
 *   - API pattern validation (validateApiPatterns)
 *   - State machine validation (validateWithinFile, validateCrossArtifact)
 *   - Rules doc validation (validateRulesDoc)
 *   - General contract dispatch (validateContract)
 *
 * The OpenAPI structural validators and example-data validation moved to
 * blueprint-mock-server: they gate whether the server will serve a spec,
 * which is a runtime question, not a contract one.
 */

// API pattern validation — validateSpec is aliased to avoid collision with the OpenAPI one
export {
  validateSpec as validateApiPatterns,
  validateForeignKeys,
  validateSortableExtension,
  validateListEndpointParameters,
  validateListResponseSchema,
  validatePostEndpoint,
  validatePatchEndpoint,
  validateSingleResourceGet,
  validateSharedErrorResponses,
  hasJsonResponse,
  isCollectionPath,
  isSingleResourcePath,
  isActionPath,
  SORTABLE_FIELD_REGEX,
} from './pattern-validator.js';

// State machine validation
export {
  VALID_ACTOR_ROLES,
  SYSTEM_VARIABLES,
  extractFieldRefs,
  extractEnumComparisons,
  collectContextBindings,
  loadExtendsDoc,
  collectGuardIds,
  collectCallableIds,
  extractConditionIds,
  walkPushBodiesInCalls,
  collectCallBodyLiterals,
  validateWithinFile,
  validateCrossArtifact,
} from './state-machine-validator.js';

// Rules doc validation
export {
  detectCycles,
  detectUnreachable,
  checkCelSyntax,
  canResolveRef,
  validateRuleset,
  validateRulesDoc,
} from './rules-validator.js';

// General contract type dispatch
export { validateContract } from './contract-validator.js';
