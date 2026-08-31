import jsYaml from 'js-yaml';
import { readFileSync } from 'node:fs';

/**
 * Loads a rulespec/v1+cc-implementation-layer YAML file and returns a parsed
 * in-memory model. The returned object separates rules by kind so callers
 * don't need to filter the flat `rules` array themselves.
 *
 * @param {string} filePath - Absolute or relative path to the .yaml file.
 * @returns {{
 *   module: object,
 *   types: Map<string, object>,
 *   parameters: object[],
 *   dataRelations: object[],
 *   definitions: object[],
 *   derivedRules: object[],
 *   notices: object[],
 *   procedures: object[],
 * }}
 */
export function loadRulespec(filePath) {
  const raw = jsYaml.load(readFileSync(filePath, 'utf-8'));

  const types = new Map();
  for (const t of raw.types ?? []) {
    types.set(t.name, t);
  }

  const parameters = [];
  const dataRelations = [];
  const definitions = [];
  const derivedRules = [];
  const notices = [];
  const procedures = [];

  for (const rule of raw.rules ?? []) {
    switch (rule.kind) {
      case 'parameter':     parameters.push(rule);    break;
      case 'data_relation': dataRelations.push(rule); break;
      case 'definition':    definitions.push(rule);   break;
      case 'derived':       derivedRules.push(rule);  break;
      case 'notice':        notices.push(rule);       break;
      case 'procedure':     procedures.push(rule);    break;
      default:
        // unknown kind — ignore silently (forward-compatible)
        break;
    }
  }

  return { module: raw.module, types, parameters, dataRelations, definitions, derivedRules, notices, procedures };
}
