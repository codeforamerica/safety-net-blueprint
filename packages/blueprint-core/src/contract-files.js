import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, relative, resolve, dirname, basename } from 'path';
import yaml from 'js-yaml';

/**
 * Detect the contract file type from a filename.
 * First-match wins against the suffix list.
 * Returns 'unknown' if the filename does not match any known contract convention.
 */
export function detectType(filename) {
  if (filename.endsWith('-openapi.yaml'))         return 'openapi';
  if (filename.endsWith('-asyncapi.yaml'))        return 'asyncapi';
  if (filename.endsWith('-state-machine.yaml'))   return 'state-machine';
  if (filename.endsWith('-schema.yaml'))          return 'schema';
  if (filename.endsWith('-mock-data.yaml'))       return 'mock-data';
  if (filename.endsWith('-metrics.yaml'))         return 'metrics';
  if (filename.endsWith('-compositions.yaml'))    return 'compositions';
  if (filename.endsWith('-annotations-docs.yaml')) return 'annotations';
  if (filename.endsWith('-annotations.yaml'))     return 'annotations';
  if (filename.endsWith('-sla-types.yaml'))       return 'sla-types';
  if (filename.endsWith('-config.yaml'))          return 'config';
  if (filename.endsWith('-overlay.yaml'))         return 'overlay';
  if (filename === 'parameters.yaml')             return 'parameters';
  if (filename === 'responses.yaml')              return 'responses';
  if (filename === 'pagination.yaml')             return 'pagination';
  return 'unknown';
}

/**
 * Extract a domain value from a file entry using layered heuristics.
 *
 * Priority:
 *   1. content.info['x-domain']  — explicit annotation on openapi/asyncapi specs
 *   2. content.domain            — top-level field on annotations files
 *   3. A path segment matching a known domain value
 *   4. The filename prefix before the first '-' if it matches a known domain value
 *   5. null
 *
 * @param {string} filename
 * @param {string} relativePath - Forward-slash relative path from the root dir
 * @param {object} content - Parsed YAML content
 * @param {Set<string>} knownDomains - Valid domain values from the resolved Domain enum
 * @returns {string|null}
 */
function extractDomain(filename, relativePath, content, knownDomains) {
  if (content?.info?.['x-domain']) return content.info['x-domain'];
  if (content?.domain) return content.domain;

  for (const segment of relativePath.split('/').slice(0, -1)) {
    if (knownDomains.has(segment)) return segment;
  }

  const dashIdx = filename.indexOf('-');
  if (dashIdx > 0) {
    const prefix = filename.slice(0, dashIdx);
    if (knownDomains.has(prefix)) return prefix;
  }

  return null;
}

/**
 * Recursively walk a directory, loading all .yaml files.
 * Skips dot-prefixed directories and node_modules.
 *
 * Each entry includes a `domain` field derived from the file content and path,
 * validated against the Domain enum found in the loaded files (if present).
 *
 * @param {string} dir - Absolute path to the root directory to walk.
 * @returns {Map<string, {content: object, type: string, relativePath: string, domain: string|null}>}
 *   Map keyed by absolute file path.
 */
export function loadContractFiles(dir) {
  const map = new Map();
  if (!existsSync(dir)) return map;

  function walk(currentDir) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      const absPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
      } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
        let content;
        try {
          content = yaml.load(readFileSync(absPath, 'utf8'));
        } catch {
          continue;
        }
        const type = detectType(entry.name);
        // Normalize to forward slashes
        const relativePath = relative(dir, absPath).replace(/\\/g, '/');
        map.set(absPath, { content, type, relativePath, domain: null });
      }
    }
  }

  walk(dir);

  // Extract known Domain enum values from any schema file that defines them
  const knownDomains = new Set();
  for (const { content, type } of map.values()) {
    if (type === 'schema' && Array.isArray(content?.$defs?.Domain?.enum)) {
      for (const d of content.$defs.Domain.enum) knownDomains.add(d);
      break;
    }
  }

  // Annotate each entry with its domain
  for (const [absPath, entry] of map) {
    entry.domain = extractDomain(basename(absPath), entry.relativePath, entry.content, knownDomains);
  }

  return map;
}

/**
 * Collect all external $ref file parts from a YAML object tree.
 * A ref is external if it does not start with '#'.
 * The file part is everything before the '#' fragment separator.
 *
 * @param {*} node - YAML object to walk
 * @param {Set<string>} refs - Accumulator set
 */
function collectExternalRefFiles(node, refs) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectExternalRefFiles(item, refs);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && !value.startsWith('#')) {
      // Extract file part (before any '#' fragment)
      const hashIdx = value.indexOf('#');
      const filePart = hashIdx === -1 ? value : value.slice(0, hashIdx);
      if (filePart) refs.add(filePart);
    } else {
      collectExternalRefFiles(value, refs);
    }
  }
}

/**
 * Load the content of all external $ref files referenced by a spec,
 * using the already-loaded fileMap to avoid re-reading from disk.
 *
 * @param {string} specAbsPath - Absolute path to the spec file (used to resolve relative refs)
 * @param {*} rawSpec - The parsed (raw) spec object to scan for $refs
 * @param {Map<string, {content: object, type: string, relativePath: string}>} fileMap
 *   The map returned by loadContractFiles
 * @returns {Map<string, object>} Map from ref file part to parsed content
 */
export function loadExternalRefs(specAbsPath, rawSpec, fileMap) {
  const result = new Map();
  const refs = new Set();
  collectExternalRefFiles(rawSpec, refs);

  const specDir = dirname(specAbsPath);

  for (const refFilePart of refs) {
    // Skip HTTP/HTTPS canonical URIs
    if (refFilePart.startsWith('http://') || refFilePart.startsWith('https://')) continue;

    const absRefPath = resolve(specDir, refFilePart);
    const entry = fileMap.get(absRefPath);
    if (entry) {
      result.set(refFilePart, entry.content);
    }
  }

  return result;
}
