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
 * response schema.  Later phases (sectionView, state) replace the stub with a
 * fully-shaped schema.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import yaml from 'js-yaml';
import { applyOverlay } from '../overlay/overlay-resolver.js';

const LIST_QUERY_PARAMS = [
  { $ref: './components/parameters.yaml#/SearchQueryParam' },
  { $ref: './components/parameters.yaml#/LimitParam' },
  { $ref: './components/parameters.yaml#/OffsetParam' },
  { $ref: './components/parameters.yaml#/SortParam' },
];

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

      // Apply state composition overlays from overlays/*/
      let mergedDoc = doc;
      const overlaysDir = join(specsDir, 'overlays');
      try {
        const stateDirs = readdirSync(overlaysDir);
        for (const stateDir of stateDirs) {
          const stateDirPath = join(overlaysDir, stateDir);
          let stat;
          try { stat = statSync(stateDirPath); } catch { continue; }
          if (!stat.isDirectory()) continue;

          const overlayFilePath = join(stateDirPath, `${domain}-compositions.yaml`);
          try {
            const overlayContent = readFileSync(overlayFilePath, 'utf8');
            const overlayDoc = yaml.load(overlayContent);
            if (!overlayDoc || overlayDoc.overlay !== '1.0.0') continue;

            const { result } = applyOverlay(mergedDoc, overlayDoc, {
              silent: true,
              overlayDir: stateDirPath,
            });
            mergedDoc = result;
          } catch {
            continue;
          }
        }
      } catch {
        // overlays directory doesn't exist — fine
      }

      results.push({ filePath, domain, doc: mergedDoc });
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
 * Convert a PascalCase string to kebab-case.
 * "ReviewProgress" → "review-progress"
 *
 * @param {string} s
 * @returns {string}
 */
function toKebabCase(s) {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Derive state resource name info from a state config block.
 *
 * @param {Object} stateConfig - composition.state
 * @returns {{ defsKey: string, kebabName: string, camelKey: string } | null}
 */
export function deriveStateResourceName(stateConfig) {
  if (!stateConfig?.schema?.$ref) return null;
  const match = stateConfig.schema.$ref.match(/#\/\$defs\/([A-Za-z][A-Za-z0-9]*)$/);
  if (!match) return null;
  const defsKey = match[1];
  return {
    defsKey,
    kebabName: toKebabCase(defsKey),
    camelKey: defsKey.charAt(0).toLowerCase() + defsKey.slice(1),
  };
}

/**
 * Load properties from the companion schema file referenced in state.schema.$ref.
 *
 * @param {Object} stateConfig - composition.state
 * @param {string} compositionFilePath - Absolute path to the composition YAML file
 * @returns {{ properties: Object, required: string[] } | null}
 */
function loadCompanionSchemaEntry(stateConfig, compositionFilePath) {
  if (!stateConfig?.schema?.$ref || !compositionFilePath) return null;
  const [filePart, defsPath] = stateConfig.schema.$ref.split('#');
  const defsKey = defsPath?.match(/\/\$defs\/([A-Za-z][A-Za-z0-9]*)$/)?.[1];
  if (!filePart || !defsKey) return null;

  try {
    const schemaPath = join(dirname(compositionFilePath), filePart);
    const doc = yaml.load(readFileSync(schemaPath, 'utf8'));
    const schema = doc?.$defs?.[defsKey];
    return schema ? { properties: schema.properties ?? {}, required: schema.required ?? [] } : null;
  } catch {
    return null;
  }
}

/**
 * Generate OpenAPI path and schema entries for the panel endpoint of a sectionView composition.
 *
 * For sectionView compositions, emits:
 *   GET {endpoint.path}/{section}  — panel for a named section
 *
 * @param {string} compositionName
 * @param {string} endpointPath - Index endpoint path (e.g. /applications/{applicationId}/review)
 * @param {Map<string, string>} paramIndex - From buildParameterIndex
 * @returns {{ path: string, schemaName: string, pathEntry: Object, schemaEntry: Object }}
 */
export function generateSectionViewPanelEndpoint(compositionName, endpointPath, paramIndex) {
  const panelPath = `${endpointPath}/{section}`;
  const paramNames = extractPathParams(endpointPath);
  const sectionSchemaName = `${toPascalCase(compositionName)}SectionResponse`;

  const parentParams = paramNames.map(name => {
    const ref = paramIndex.get(name);
    return ref
      ? { $ref: ref }
      : { name, in: 'path', required: true, schema: { type: 'string' } };
  });

  const sectionParam = {
    name: 'section',
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description: 'Section name within the sectionView composition.',
  };

  const pathEntry = {
    parameters: [...parentParams, sectionParam],
    get: {
      summary: `Get ${compositionName} section panel`,
      operationId: `get${toPascalCase(compositionName)}Section`,
      'x-composition': compositionName,
      'x-composition-type': 'sectionView',
      parameters: LIST_QUERY_PARAMS,
      responses: {
        '200': {
          description: `${compositionName} section panel retrieved successfully.`,
          content: {
            'application/json': { schema: { $ref: `#/components/schemas/${sectionSchemaName}` } }
          }
        },
        '404': { $ref: './components/responses.yaml#/NotFound' },
        '500': { $ref: './components/responses.yaml#/InternalError' },
      }
    }
  };

  const schemaEntry = {
    type: 'object',
    description: `Generated section panel response for ${compositionName}.`,
    'x-composition': compositionName,
    'x-composition-type': 'sectionView',
  };

  return { path: panelPath, schemaName: sectionSchemaName, pathEntry, schemaEntry };
}


/**
 * Generate OpenAPI path entries and schemas for a composition state resource.
 *
 * For sectionView compositions, generates:
 *   GET    /{stateResource}/{section}          — list (paginated)
 *   GET    /{stateResource}/{section}/{itemId} — single record
 *   PUT    /{stateResource}/{section}          — replace (singleton)
 *   PATCH  /{stateResource}/{section}          — partial update (singleton)
 *   PUT    /{stateResource}/{section}/{itemId} — replace (collection item)
 *   PATCH  /{stateResource}/{section}/{itemId} — partial update (collection item)
 *
 * @param {Object} composition - Composition definition
 * @param {string} endpointPath - Composition endpoint path (e.g. /applications/{applicationId}/review)
 * @param {Map<string, string>} paramIndex - From buildParameterIndex
 * @param {string} compositionFilePath - Absolute path to the composition YAML file
 * @returns {{ pathEntries: Object, schemaEntries: Object }}
 */
export function generateStateEndpoints(composition, endpointPath, paramIndex, compositionFilePath) {
  const stateNameInfo = deriveStateResourceName(composition.state);
  if (!stateNameInfo) return { pathEntries: {}, schemaEntries: {} };

  const { defsKey, kebabName } = stateNameInfo;

  // Derive parent base path: strip the last segment
  // e.g. /applications/{applicationId}/review → /applications/{applicationId}
  const parentBase = endpointPath.replace(/\/[^/]+$/, '');
  const stateBasePath = `${parentBase}/${kebabName}`;
  const sectionPath = `${stateBasePath}/{section}`;
  const itemPath = `${stateBasePath}/{section}/{itemId}`;

  // Build parent path parameters (from parent base path)
  const parentParamNames = extractPathParams(parentBase);
  const parentParams = parentParamNames.map(name => {
    const ref = paramIndex.get(name);
    return ref ? { $ref: ref } : { name, in: 'path', required: true, schema: { type: 'string' } };
  });

  const sectionParam = { name: 'section', in: 'path', required: true, schema: { type: 'string' },
    description: 'Section name within the sectionView composition.' };
  const itemIdParam = { name: 'itemId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' },
    description: 'Item identifier for collection-backed sections.' };

  const sectionParams = [...parentParams, sectionParam];
  const itemParams   = [...parentParams, sectionParam, itemIdParam];

  // Schema names
  const writableSchemaName = `${defsKey}Writable`;
  const resourceSchemaName = defsKey;
  const listSchemaName     = `${defsKey}ListResponse`;

  const notFound     = { $ref: './components/responses.yaml#/NotFound' };
  const internalErr  = { $ref: './components/responses.yaml#/InternalError' };
  const badRequest   = { $ref: './components/responses.yaml#/BadRequest' };
  const unprocessable = { $ref: './components/responses.yaml#/UnprocessableEntity' };

  const resourceRef = { $ref: `#/components/schemas/${resourceSchemaName}` };
  const listRef     = { $ref: `#/components/schemas/${listSchemaName}` };

  const readBody = (schemaRef, description) => ({
    content: { 'application/json': { schema: schemaRef } },
    description,
  });

  const pathEntries = {
    [sectionPath]: {
      parameters: sectionParams,
      get: {
        summary: `List ${defsKey} state records for a section`,
        operationId: `list${defsKey}BySection`,
        parameters: LIST_QUERY_PARAMS,
        responses: {
          '200': { description: `${defsKey} state records retrieved successfully.`, ...readBody(listRef, undefined) },
          '404': notFound,
          '500': internalErr,
        },
      },
      put: {
        summary: `Replace ${defsKey} state for a section`,
        operationId: `replace${defsKey}BySection`,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${writableSchemaName}` } } } },
        responses: {
          '200': { description: `${defsKey} state replaced successfully.`, ...readBody(resourceRef, undefined) },
          '400': badRequest, '404': notFound, '422': unprocessable, '500': internalErr,
        },
      },
      patch: {
        summary: `Update ${defsKey} state for a section`,
        operationId: `update${defsKey}BySection`,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${writableSchemaName}` } } } },
        responses: {
          '200': { description: `${defsKey} state updated successfully.`, ...readBody(resourceRef, undefined) },
          '400': badRequest, '404': notFound, '422': unprocessable, '500': internalErr,
        },
      },
    },
    [itemPath]: {
      parameters: itemParams,
      get: {
        summary: `Get ${defsKey} state for a collection item`,
        operationId: `get${defsKey}ByItem`,
        responses: {
          '200': { description: `${defsKey} state retrieved successfully.`, ...readBody(resourceRef, undefined) },
          '404': notFound,
          '500': internalErr,
        },
      },
      put: {
        summary: `Replace ${defsKey} state for a collection item`,
        operationId: `replace${defsKey}ByItem`,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${writableSchemaName}` } } } },
        responses: {
          '200': { description: `${defsKey} state replaced successfully.`, ...readBody(resourceRef, undefined) },
          '400': badRequest, '404': notFound, '422': unprocessable, '500': internalErr,
        },
      },
      patch: {
        summary: `Update ${defsKey} state for a collection item`,
        operationId: `update${defsKey}ByItem`,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${writableSchemaName}` } } } },
        responses: {
          '200': { description: `${defsKey} state updated successfully.`, ...readBody(resourceRef, undefined) },
          '400': badRequest, '404': notFound, '422': unprocessable, '500': internalErr,
        },
      },
    },
  };

  // Build schema entries
  const companionEntry = loadCompanionSchemaEntry(composition.state, compositionFilePath);
  const writableProperties = companionEntry?.properties ?? {};
  const writableRequired   = companionEntry?.required ?? [];

  const frameworkProperties = {
    id:            { type: 'string', format: 'uuid', readOnly: true },
    section:       { type: 'string', readOnly: true },
    itemId:        { type: 'string', format: 'uuid', nullable: true, readOnly: true },
    createdAt:     { type: 'string', format: 'date-time', readOnly: true },
    updatedAt:     { type: 'string', format: 'date-time', readOnly: true },
  };

  const schemaEntries = {
    [writableSchemaName]: {
      type: 'object',
      description: `Client-writable fields for the ${stateNameInfo.camelKey} state resource. Framework fields (id, section, itemId, createdAt, updatedAt) are added automatically.`,
      ...(Object.keys(writableProperties).length > 0 ? { properties: writableProperties } : {}),
      ...(writableRequired.length > 0 ? { required: writableRequired } : {}),
    },
    [resourceSchemaName]: {
      type: 'object',
      description: `Generated state resource for ${stateNameInfo.camelKey}.`,
      allOf: [
        { $ref: `#/components/schemas/${writableSchemaName}` },
        {
          type: 'object',
          properties: frameworkProperties,
          required: ['id', 'section', 'createdAt', 'updatedAt'],
        },
      ],
    },
    [listSchemaName]: {
      type: 'object',
      description: `Paginated list of ${stateNameInfo.camelKey} state records.`,
      properties: {
        items:   { type: 'array', items: { $ref: `#/components/schemas/${resourceSchemaName}` } },
        total:   { type: 'integer' },
        limit:   { type: 'integer' },
        offset:  { type: 'integer' },
        hasNext: { type: 'boolean' },
      },
      required: ['items', 'total', 'limit', 'offset', 'hasNext'],
    },
  };

  return { pathEntries, schemaEntries };
}

/**
 * Build an index mapping OpenAPI path → GET response schema info.
 * Used to locate the parent resource schema when generating parentLink overlays.
 *
 * @param {Array<{ relativePath: string, spec: Object }>} yamlFiles
 * @returns {Map<string, { schemaName: string, hasAllOf: boolean }>}
 */
export function buildPathToSchemaMap(yamlFiles) {
  const map = new Map();

  for (const { spec } of yamlFiles) {
    if (!spec?.paths) continue;

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      const getOp = pathItem?.get;
      if (!getOp) continue;

      const schemaRef =
        getOp.responses?.['200']?.content?.['application/json']?.schema?.$ref;
      if (!schemaRef) continue;

      const match = schemaRef.match(/^#\/components\/schemas\/(.+)$/);
      if (!match) continue;

      const schemaName = match[1];
      const schema = spec.components?.schemas?.[schemaName];
      if (!schema) continue;

      map.set(path, {
        schemaName,
        hasAllOf: Array.isArray(schema.allOf),
      });
    }
  }

  return map;
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
 * When `composition.state` is declared, also emits state resource endpoints
 * following the standard API patterns (paginated list, get/put/patch by section
 * and item).
 *
 * The overlay uses `./components/responses.yaml#/...` for error response refs.
 * Callers that need a different prefix should rewrite refs after calling this.
 *
 * @param {Object} compositionFile - { filePath, domain, doc }
 * @param {Map<string, string>} paramIndex - from buildParameterIndex
 * @returns {Object|null} Overlay document, or null if no endpoints were declared
 */
export function generateCompositionOverlay(compositionFile, paramIndex, parentSchemaMap = null) {
  const { domain, doc, filePath } = compositionFile;
  const apiSpecFile = `${domain}-openapi.yaml`;

  const pathsUpdate = {};
  const schemasUpdate = {};
  const extraActions = [];

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

    // sectionView compositions: also generate the panel endpoint and section enum
    if (composition.compositeType === 'sectionView') {
      const panel = generateSectionViewPanelEndpoint(compositionName, endpointPath, paramIndex);
      pathsUpdate[panel.path] = panel.pathEntry;
      schemasUpdate[panel.schemaName] = panel.schemaEntry;

      const sectionKeys = Object.keys(composition.sections || {});
      if (sectionKeys.length > 0) {
        const enumName = `${toPascalCase(compositionName)}Sections`;
        schemasUpdate[enumName] = {
          type: 'string',
          description: `Valid section names for the ${compositionName} sectionView.`,
          enum: sectionKeys,
          'x-generated': 'section-enum',
        };
      }
    }

    // If the composition declares state:, also generate state resource endpoints
    if (composition.state) {
      const { pathEntries, schemaEntries } = generateStateEndpoints(composition, endpointPath, paramIndex, filePath);
      Object.assign(pathsUpdate, pathEntries);
      Object.assign(schemasUpdate, schemaEntries);
    }

    // parentLink: true — inject _links.{compositionName} into the parent resource's
    // GET response schema at resolve time (not in the base spec).
    if (composition.endpoint?.parentLink && parentSchemaMap) {
      const parentPath = endpointPath.replace(/\/[^/]+$/, '');
      const parentInfo = parentSchemaMap.get(parentPath);
      if (parentInfo) {
        const linksBlock = {
          type: 'object',
          properties: {
            _links: {
              type: 'object',
              readOnly: true,
              description: 'Generated composition links.',
              properties: {
                [compositionName]: {
                  type: 'object',
                  description: `Link to the ${compositionName} composition.`,
                  properties: {
                    href: { type: 'string', format: 'uri-reference', readOnly: true },
                  },
                },
              },
            },
          },
        };

        if (parentInfo.hasAllOf) {
          extraActions.push({
            target: `$.components.schemas.${parentInfo.schemaName}.allOf`,
            file: apiSpecFile,
            description: `Inject _links.${compositionName} into ${parentInfo.schemaName}`,
            append: linksBlock,
          });
        } else {
          extraActions.push({
            target: `$.components.schemas.${parentInfo.schemaName}.properties`,
            file: apiSpecFile,
            description: `Inject _links.${compositionName} into ${parentInfo.schemaName}`,
            update: { _links: linksBlock.properties._links },
          });
        }
      }
    }
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
    },
    ...extraActions,
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
  const parentSchemaMap = buildPathToSchemaMap(yamlFiles);
  const result = [];

  for (const compositionFile of compositionFiles) {
    const overlay = generateCompositionOverlay(compositionFile, paramIndex, parentSchemaMap);
    if (overlay) {
      result.push({ overlay, domain: compositionFile.domain });
    }
  }

  return result;
}
