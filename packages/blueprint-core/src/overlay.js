/**
 * Overlay configuration and resolution.
 *
 * Combines:
 *   - overlay/config.js: discover and validate state overlay config declarations
 *   - overlay/overlay-resolver.js: apply OpenAPI Overlay Specification actions
 */

export { CONFIG_SCHEMA, extractConfig, overlayConfig, validateConfig, getConfigDefaults } from './overlay/config.js';

export {
  parsePath,
  resolvePath,
  setAtPath,
  removeAtPath,
  renameAtPath,
  checkPathExists,
  rootExists,
  replaceAtPath,
  appendAtPath,
  addAtPath,
  loadReplacementRef,
  applyOverlay,
} from './overlay/overlay-resolver.js';
