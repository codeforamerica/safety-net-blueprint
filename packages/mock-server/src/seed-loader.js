/**
 * Loads seed YAML files and resolves `{{...}}` date tokens.
 *
 * Two consumers — seed-validator and seeder — both need post-template seed
 * data, validator to check shape and seeder to insert. Centralizing the load
 * + resolve step here keeps templating concerns out of both consumers.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { resolveTemplates } from './seed-template-resolver.js';

/**
 * Load a single seed YAML file and resolve every `{{...}}` token in it.
 *
 * @param {string} seedDir - Path to seed directory.
 * @param {string} apiName - API name; resolves to `${seedDir}/${apiName}.yaml`.
 * @param {Date} now - Reference instant for token resolution.
 * @returns {Object} The parsed-and-resolved seed object (empty if file absent).
 * @throws {Error} If the file is malformed YAML.
 * @throws {SeedTemplateError} If any token can't be resolved cleanly.
 */
export function loadResolvedSeed(seedDir, apiName, now) {
  const seedPath = join(seedDir, `${apiName}.yaml`);
  if (!existsSync(seedPath)) return {};
  const raw = yaml.load(readFileSync(seedPath, 'utf8')) || {};
  return resolveTemplates(raw, now, apiName);
}
