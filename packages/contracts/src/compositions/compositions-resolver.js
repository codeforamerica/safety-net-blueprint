/**
 * Compositions Resolver
 *
 * Discovers {domain}-compositions.yaml files, validates bind fields against
 * OpenAPI resource schemas, and generates OpenAPI overlay documents for
 * composition endpoints and response schemas.
 *
 * Bind validation: each composition node with a `bind:` field references a
 * property on the child resource's schema.  If that property doesn't exist the
 * resolver reports an error so `npm run validate` fails before a bad config
 * reaches runtime.
 *
 * Overlay generation: for each composition that declares an `endpoint:`, the
 * resolver emits an OpenAPI overlay that adds the path entry and a stub
 * response schema.  Later phases (sectionView, state, named views) replace the
 * stub with a fully-shaped schema.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

// =============================================================================
// Discovery
// =============================================================================

/**
 * Discover composition YAML files in a directory.
 *
 * @param {string} specsDir - Path to the specs directory
 * @returns {Array<{ filePath: string, domain: string, doc: Object }>}
 */
export function discoverCompositions(specsDir) {
  let files;
  try {
    files = readdirSync(specsDir);
  } catch {
    return [];
  }

  const results = [];
  for (const file of files) {
    if (!file.endsWith('-compositions.yaml')) continue;
    const domain = file.replace('-compositions.yaml', '');
    const filePath = join(specsDir, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      const doc = yaml.load(content);
      if (!doc || typeof doc !== 'object' || !doc.compositions) continue;
      results.push({ filePath, domain, doc });
    } catch {
      continue;
    }
  }

  return results;
}

// =============================================================================
// Resource Schema Index
// =============================================================================

/**
 * Extract the resource slug from an OpenAPI path.
 * The slug is the last path segment that is not a path parameter.
 *
 * "/applications/{id}/member-incomes/{memberId}" → "member-incomes"
 * "/household-info"                               → "household-info"
 *
 * @param {string} path
 * @returns {string|null}
 */
export function extractResourceSlug(path) {
  const segments = path.split('/').filter(s => s && !s.startsWith('{'));
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

/**
 * Collect all property names from a schema object.
 * Handles `properties` and `allOf` (one level deep for inline objects).
 * Does not resolve external `$ref` entries — properties on `$ref`-only allOf
 * members are skipped. This is sufficient for the common blueprint pattern of
 * `allOf: [{ $ref: external }, { type: object, properties: { ... } }]`.
 *
 * @param {Object} schema
 * @returns {Set<string>}
 */
export function collectSchemaProperties(schema) {
  const props = new Set();
  if (!schema || typeof schema !== 'object') return props;

  if (schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      props.add(key);
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      if (part && typeof part === 'object' && !part.$ref && part.properties) {
        for (const key of Object.keys(part.properties)) {
          props.add(key);
        }
      }
    }
  }

  return props;
}

/**
 * Build an index mapping resource slugs to their property names.
 *
 * Algorithm: for each OpenAPI file, scan paths for GET operations that return
 * a local schema ref (`#/components/schemas/Foo`).  Extract the slug from the
 * path and collect properties from the referenced schema.
 *
 * @param {Array<{ relativePath: string, spec: Object }>} yamlFiles
 * @returns {Map<string, Set<string>>} resourceSlug → Set of property names
 */
export function buildResourceSchemaIndex(yamlFiles) {
  const index = new Map();

  for (const { spec } of yamlFiles) {
    if (!spec || !spec.paths) continue;

    const schemas = spec.components?.schemas || {};

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;

      const slug = extractResourceSlug(path);
      if (!slug) continue;

      // Item endpoints (path ends with a param like /{id}) carry the resource's
      // own fields and always win over collection endpoints.  Skip a collection
      // path only if the slug is already represented by an item endpoint.
      const endsWithParam = path.endsWith('}');
      if (!endsWithParam && index.has(slug)) continue;

      const getOp = pathItem.get;
      if (!getOp) continue;

      const schemaRef =
        getOp.responses?.['200']?.content?.['application/json']?.schema?.$ref;
      if (!schemaRef) continue;

      const match = schemaRef.match(/^#\/components\/schemas\/(.+)$/);
      if (!match) continue;

      const schema = schemas[match[1]];
      if (!schema) continue;

      const props = collectSchemaProperties(schema);
      if (props.size > 0) {
        index.set(slug, props);
      }
    }
  }

  return index;
}

// =============================================================================
// Bind Validation
// =============================================================================

/**
 * Validate all bind fields in a composition document against the resource
 * schema index.  Walks sections, include nodes, and panel nodes recursively.
 *
 * Returns an empty array when all bind fields are valid.
 * When `resource` is not in the index the node is skipped (the resource may
 * live in a different spec file not loaded at validation time).
 *
 * @param {Object} compositionDoc - { domain, doc: { compositions } }
 * @param {Map<string, Set<string>>} resourceSchemaIndex
 * @returns {Array<{ message: string, path: string }>}
 */
export function validateBindFields(compositionDoc, resourceSchemaIndex) {
  const errors = [];

  function checkNode(node, nodePath) {
    if (!node || typeof node !== 'object') return;

    if (node.bind && node.resource) {
      const binds = Array.isArray(node.bind) ? node.bind : [node.bind];
      const props = resourceSchemaIndex.get(node.resource);

      if (props) {
        for (const bindField of binds) {
          if (!props.has(bindField)) {
            errors.push({
              message: `Bind field "${bindField}" not found on resource "${node.resource}"`,
              path: nodePath
            });
          }
        }
      }
    }

    if (node.include && typeof node.include === 'object') {
      for (const [key, child] of Object.entries(node.include)) {
        checkNode(child, `${nodePath}.include.${key}`);
      }
    }

    if (node.sections && typeof node.sections === 'object') {
      for (const [key, child] of Object.entries(node.sections)) {
        checkNode(child, `${nodePath}.sections.${key}`);
      }
    }

    if (node.panel?.include && typeof node.panel.include === 'object') {
      for (const [key, child] of Object.entries(node.panel.include)) {
        checkNode(child, `${nodePath}.panel.include.${key}`);
      }
    }
  }

  const { domain, doc } = compositionDoc;

  for (const [name, composition] of Object.entries(doc.compositions || {})) {
    checkNode(composition, `${domain}.compositions.${name}`);
  }

  return errors;
}

// =============================================================================
// Overlay Generation
// =============================================================================

/**
 * Extract path parameter names from an endpoint path.
 *
 * "/applications/{applicationId}/review" → ["applicationId"]
 *
 * @param {string} path
 * @returns {string[]}
 */
export function extractPathParams(path) {
  return (path.match(/\{([^}]+)\}/g) || []).map(m => m.slice(1, -1));
}

/**
 * Build a parameter reference index from all loaded OpenAPI files.
 * Maps parameter name → `$ref` string, e.g.:
 *   "applicationId" → "#/components/parameters/ApplicationIdParam"
 *
 * @param {Array<{ relativePath: string, spec: Object }>} yamlFiles
 * @returns {Map<string, string>}
 */
export function buildParameterIndex(yamlFiles) {
  const index = new Map();

  for (const { spec } of yamlFiles) {
    if (!spec?.components?.parameters) continue;

    for (const [key, paramDef] of Object.entries(spec.components.parameters)) {
      if (paramDef?.name && !index.has(paramDef.name)) {
        index.set(paramDef.name, `#/components/parameters/${key}`);
      }
    }
  }

  return index;
}

/**
 * Capitalise the first letter of a string.
 */
function toPascalCase(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Generate an OpenAPI overlay for a single composition file.
 *
 * Emits one path entry per composition that declares an `endpoint:`.
 * The generated operation includes:
 *  - parameter refs derived from the path pattern
 *  - a stub response schema named `{CompositionName}Response`
 *  - `x-composition` annotation for downstream tooling
 *
 * The overlay uses `./components/responses.yaml#/...` for error response refs.
 * Callers that need a different prefix should rewrite refs after calling this.
 *
 * @param {Object} compositionFile - { filePath, domain, doc }
 * @param {Map<string, string>} paramIndex - from buildParameterIndex
 * @returns {Object|null} Overlay document, or null if no endpoints were declared
 */
export function generateCompositionOverlay(compositionFile, paramIndex) {
  const { domain, doc } = compositionFile;
  const apiSpecFile = `${domain}-openapi.yaml`;

  const pathsUpdate = {};
  const schemasUpdate = {};

  for (const [compositionName, composition] of Object.entries(doc.compositions || {})) {
    if (!composition.endpoint?.path) continue;

    const endpointPath = composition.endpoint.path;
    const paramNames = extractPathParams(endpointPath);
    const schemaName = `${toPascalCase(compositionName)}Response`;
    const operationId = `get${toPascalCase(compositionName)}`;

    const parameters = paramNames.map(name => {
      const ref = paramIndex.get(name);
      return ref
        ? { $ref: ref }
        : { name, in: 'path', required: true, schema: { type: 'string' } };
    });

    const operation = {
      summary: `Get ${compositionName}`,
      operationId,
      'x-composition': compositionName,
      responses: {
        '200': {
          description: `${compositionName} retrieved successfully.`,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${schemaName}` }
            }
          }
        },
        '404': { $ref: './components/responses.yaml#/NotFound' },
        '500': { $ref: './components/responses.yaml#/InternalError' }
      }
    };

    const pathEntry = {};
    if (parameters.length > 0) {
      pathEntry.parameters = parameters;
    }
    pathEntry.get = operation;

    pathsUpdate[endpointPath] = pathEntry;

    const schemaEntry = {
      type: 'object',
      description: `Generated composition response for ${compositionName}.`,
      'x-composition': compositionName
    };
    if (composition.compositeType) {
      schemaEntry['x-composition-type'] = composition.compositeType;
    }
    schemasUpdate[schemaName] = schemaEntry;
  }

  if (Object.keys(pathsUpdate).length === 0) return null;

  const actions = [
    {
      target: '$.paths',
      file: apiSpecFile,
      description: `Add generated composition endpoints for ${domain}`,
      update: pathsUpdate
    },
    {
      target: '$.components.schemas',
      file: apiSpecFile,
      description: `Add generated composition response schemas for ${domain}`,
      update: schemasUpdate
    }
  ];

  return {
    overlay: '1.0.0',
    info: {
      title: `${domain} Composition Overlay`,
      version: '1.0.0',
      description: `Auto-generated composition endpoints from ${domain}-compositions.yaml`
    },
    actions
  };
}

/**
 * Generate composition overlays for all discovered composition files.
 *
 * @param {Array<{ filePath: string, domain: string, doc: Object }>} compositionFiles
 * @param {Array<{ relativePath: string, spec: Object }>} yamlFiles
 * @returns {Array<{ overlay: Object, domain: string }>}
 */
export function generateCompositionOverlays(compositionFiles, yamlFiles) {
  const paramIndex = buildParameterIndex(yamlFiles);
  const result = [];

  for (const compositionFile of compositionFiles) {
    const overlay = generateCompositionOverlay(compositionFile, paramIndex);
    if (overlay) {
      result.push({ overlay, domain: compositionFile.domain });
    }
  }

  return result;
}
