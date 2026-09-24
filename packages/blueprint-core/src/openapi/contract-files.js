import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, relative, resolve, dirname, basename } from 'path';
import yaml from 'js-yaml';
import { typeFromSchema, typeFromFilename, extractDomain } from '../contract-types.js';

/**
 * Detect the contract file type from parsed document content and/or filename.
 *
 * Detection order:
 *   1. doc.$schema URI — canonical for all blueprint contract types
 *   2. doc.openapi / doc.asyncapi version fields — OpenAPI/AsyncAPI have no $schema
 *   3. Filename suffix — fallback for files without a type marker in content
 *
 * @param {string} filename
 * @param {object} [doc] - parsed YAML content (optional)
 * @returns {string}
 */
export function detectType(filename, doc) {
  if (doc && typeof doc === 'object') {
    const schema = doc.$schema;
    // A JSON Schema document names a json-schema.org meta-schema. Checked
    // before the blueprint table so these are typed by what they declare
    // rather than falling through to the filename.
    if (typeof schema === 'string' && schema.includes('json-schema.org')) return 'schema';

    const bySchema = typeFromSchema(schema);
    if (bySchema) return bySchema;

    // Version fields are how these three declare themselves; an overlay names
    // the Overlay Specification version the same way OpenAPI and AsyncAPI do,
    // and is not required to carry a -overlay.yaml suffix.
    if (doc.openapi) return 'openapi';
    if (doc.asyncapi) return 'asyncapi';
    // Carrying `actions:`, `config:` or both — all of them are overlays.
    if (doc.overlay) return 'overlay';
  }

  const byFilename = typeFromFilename(filename);
  if (byFilename) return byFilename;

  // OpenAPI component libraries carry no version field or $schema — they are
  // bare maps of component objects. Checked last, so it only ever reclassifies
  // what would otherwise be 'unknown'. One type covers all of them; callers
  // wanting a specific library match on the shape of the objects inside.
  if (isComponentLibrary(doc)) return 'components';
  return 'unknown';
}

/**
 * Whether a document is a bare map of OpenAPI component objects.
 *
 * A component library has no document-level marker at all — no version field,
 * no $schema, no $id — and every top-level key is a component name mapping to
 * an object. Rather than guess at which keys a component carries (Parameter,
 * Response, Schema and Example objects share almost nothing), this checks only
 * that shape. It runs last, so it can only reclassify documents that would
 * otherwise be 'unknown'.
 *
 * @param {object} [doc] - parsed YAML content
 * @returns {boolean}
 */
function isComponentLibrary(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  if (doc.$schema || doc.$id || doc.openapi || doc.asyncapi) return false;

  const values = Object.values(doc);
  if (values.length === 0) return false;

  return values.every(
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  );
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
          content = yaml.load(readFileSync(absPath, 'utf8'), { schema: yaml.CORE_SCHEMA });
        } catch {
          continue;
        }
        const type = detectType(entry.name, content);
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
 * Load the content of all external $ref files referenced by a spec,
 * using the already-loaded fileMap to avoid re-reading from disk.
 *
 * @param {string} specAbsPath - Absolute path to the spec file (used to resolve relative refs)
 * @param {*} rawSpec - The parsed (raw) spec object to scan for $refs
 * @param {Map<string, {content: object, type: string, relativePath: string}>} fileMap
 *   The map returned by contractFileMap
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

/**
 * Collect all external $ref file parts from a YAML object tree.
 * A ref is external if it does not start with '#'. The file part is
 * everything before the '#' fragment separator.
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
      const hashIdx = value.indexOf('#');
      const filePart = hashIdx === -1 ? value : value.slice(0, hashIdx);
      if (filePart) refs.add(filePart);
    } else {
      collectExternalRefFiles(value, refs);
    }
  }
}
