import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

/**
 * Load and merge annotation files for a domain.
 *
 * Accepts either a directory path (legacy) or a fileMap returned by loadContractFiles.
 * When a fileMap is provided, annotation files are identified by their `domain` field
 * rather than by filename, so directory structure does not matter.
 *
 * @param {string} domain - Domain name (e.g. 'intake')
 * @param {string|Map} dirOrFileMap - Directory path or fileMap from loadContractFiles
 * @returns {{ schema: Record<string, object>, operations: Record<string, object>, events: Record<string, object> }}
 */
export function loadAnnotations(domain, dirOrFileMap) {
  const merged = { schema: {}, operations: {}, events: {} };

  let contents = [];
  if (dirOrFileMap instanceof Map) {
    for (const { content, type } of dirOrFileMap.values()) {
      if (type === 'annotations' && content?.domain === domain) {
        contents.push(content);
      }
    }
  } else {
    const files = readdirSync(dirOrFileMap)
      .filter(f => f.startsWith(`${domain}-annotations`) && f.endsWith('.yaml'))
      .sort();
    for (const file of files) {
      contents.push(yaml.load(readFileSync(join(dirOrFileMap, file), 'utf8')));
    }
  }

  // Deep-merge per entry key so that structured annotations (programs, policies)
  // and docs annotations (reason, modeling) for the same path are combined, not overwritten.
  for (const data of contents) {
    for (const [key, val] of Object.entries(data.schema || {}))
      merged.schema[key] = { ...(merged.schema[key] ?? {}), ...val };
    for (const [key, val] of Object.entries(data.operations || {}))
      merged.operations[key] = { ...(merged.operations[key] ?? {}), ...val };
    for (const [key, val] of Object.entries(data.events || {}))
      merged.events[key] = { ...(merged.events[key] ?? {}), ...val };
  }
  return merged;
}
