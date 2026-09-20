/**
 * Contract validation utilities.
 *
 * Combines all type-specific validators:
 *   - OpenAPI structural validation (validateSpec, validateAll)
 *   - API pattern validation (validateApiPatterns)
 *   - Example data validation (validateExamples)
 *   - State machine validation (validateWithinFile, validateCrossArtifact)
 *   - Rules doc validation (validateRulesDoc)
 *   - General contract dispatch (validateContract)
 *
 * Note: schema navigation utilities (resolveRef, resolveSchemaRefs,
 * collectTopLevelProperties, getPropertyAtPath) live in @codeforamerica/blueprint-core/json-schema.
 */

// OpenAPI structural validation
export { validateSpec, validateAll, formatResults, getValidationStatus } from './openapi-validator.js';

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

// Example data validation
export { deriveSchemaName, validateExamples } from './example-validator.js';

// State machine validation
export {
  VALID_ACTOR_ROLES,
  SYSTEM_VARIABLES,
  buildSchemaIndex,
  buildEndpointIndex,
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
