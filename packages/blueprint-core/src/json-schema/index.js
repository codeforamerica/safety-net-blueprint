/**
 * JSON Schema path utilities.
 *
 * Generic path navigation and enumeration for any JSON Schema compatible
 * document — OpenAPI schemas, state machine schemas, rules schemas, etc.
 */

export {
  resolveRef,
  resolveSchemaRefs,
  collectTopLevelProperties,
  getPropertyAtPath,
} from './paths.js';
