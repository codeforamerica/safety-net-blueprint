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

import { resolveSchemaRefs, collectTopLevelProperties } from './json-schema/index.js';
import { indexByRelativePath } from './ref-lookup.js';
import { extractPathParams, buildParameterIndex, buildPathEntry, toPascalCase } from './openapi/utils.js';
import { buildApiModel } from './openapi/model.js';

const JSON_PATCH_SCHEMA = 'https://blueprint.codeforamerica.org/base/schemas/operations.yaml#/$defs/JsonPatch';

const LIST_QUERY_PARAMS = [
  { $ref: './components/parameters.yaml#/SearchQueryParam' },
  { $ref: './components/parameters.yaml#/LimitParam' },
  { $ref: './components/parameters.yaml#/OffsetParam' },
  { $ref: './components/parameters.yaml#/SortParam' },
];

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
 * Handles `properties` and `allOf` entries, including external `$ref` allOf
 * members that point to domain schema `$defs`. Uses `specsByFile` to follow
 * those refs and collect properties from the referenced `$defs` entry.
 *
 * @param {Object} schema
 * @param {Map<string, Object>} [specsByFile] - relativePath → parsed spec
 * @returns {Set<string>}
 */
export function collectSchemaProperties(schema, specsByFile = new Map()) {
  const props = new Set();
  if (!schema || typeof schema !== 'object') return props;

  if (schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      props.add(key);
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      if (!part || typeof part !== 'object') continue;

      if (part.$ref && !part.$ref.startsWith('#')) {
        // Follow external $ref into domain schema $defs
        const hashIdx = part.$ref.indexOf('#');
        if (hashIdx !== -1 && specsByFile.size > 0) {
          const filePart = part.$ref.slice(0, hashIdx).replace(/^\.\//, '');
          const anchorPart = part.$ref.slice(hashIdx + 1);
          const refSpec = specsByFile.get(filePart);
          if (refSpec) {
            let node = refSpec;
            for (const seg of anchorPart.split('/').filter(Boolean)) {
              node = node?.[seg];
            }
            if (node?.properties) {
              for (const key of Object.keys(node.properties)) {
                props.add(key);
              }
            }
          }
        }
      } else if (!part.$ref && part.properties) {
        for (const key of Object.keys(part.properties)) {
          props.add(key);
        }
      }
    }
  }

  return props;
}

/**
 * Build an index mapping resources, by schema name, to their property names.
 *
 * A composition names a resource as x-relationship and a state machine's
 * `object:` do: by the schema its endpoints return, such as `ApplicationMember`.
 * For each OpenAPI file, every GET answering with a local schema ref
 * (`#/components/schemas/Foo`) indexes that schema's properties under `Foo`.
 *
 * @param {Array<{ relativePath: string, spec: Object }>} yamlFiles
 * @returns {Map<string, Set<string>>} schema name → Set of property names
 */
export function buildResourceSchemaIndex(yamlFiles) {
  const index = new Map();
  const byRelativePath = indexByRelativePath(yamlFiles);

  for (const { spec, relativePath } of yamlFiles) {
    if (!spec || !spec.paths) continue;

    const schemas = spec.components?.schemas || {};

    for (const pathItem of Object.values(spec.paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;

      const schemaRef =
        pathItem.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref;
      const name = schemaRef?.match(/^#\/components\/schemas\/(.+)$/)?.[1];
      if (!name || index.has(name) || !schemas[name]) continue;

      const schema = resolveSchemaRefs(schemas[name], { spec, byRelativePath, fromPath: relativePath });
      const propMap = collectTopLevelProperties(spec, schema);
      if (propMap.size > 0) {
        index.set(name, new Set([...propMap.keys(), ...storedForeignKeys(schema)]));
      }
    }
  }

  return index;
}

/**
 * The stored foreign keys an expand-style x-relationship replaced in a resolved
 * schema. Resolve renames `applicationId` to `application` and inlines the
 * record, but records are still stored, and bound, by `applicationId`.
 *
 * @param {Object} schema - A resolved schema, before its properties' refs are followed
 * @returns {string[]}
 */
function storedForeignKeys(schema) {
  if (!schema || typeof schema !== 'object') return [];
  const fromProperties = Object.entries(schema.properties ?? {})
    .filter(([, property]) => property?.['x-relationship']?.style === 'expand')
    .map(([key]) => `${key}Id`);
  return [...fromProperties, ...(schema.allOf ?? []).flatMap(storedForeignKeys)];
}

/**
 * Report an editable composition with an include under its root's key: the
 * root record sits under its resource name with a lowercase first letter, so
 * an include there would take its place.
 *
 * @param {Object} compositionDoc - { domain, doc: { compositions } }
 * @returns {Array<{ message: string, path: string }>}
 */
export function validateEditableKeys(compositionDoc) {
  const { domain, doc } = compositionDoc;
  return Object.entries(doc.compositions || {})
    .filter(([, composition]) => composition?.compositeType === 'editable' && composition.include?.[rootKeyOf(composition)])
    .map(([name, composition]) => ({
      message: `include "${rootKeyOf(composition)}" has the key ${name}'s ${composition.resource} sits under. Name the include something else.`,
      path: `${domain}.compositions.${name}.include.${rootKeyOf(composition)}`,
    }));
}

/**
 * Report every composition node whose `resource:` names no resource's schema.
 *
 * @param {Object} compositionDoc - { domain, doc: { compositions } }
 * @param {Map<string, Set<string>>} resourceSchemaIndex
 * @returns {Array<{ message: string, path: string }>}
 */
export function validateResourceNames(compositionDoc, resourceSchemaIndex) {
  const errors = [];

  function checkNode(node, nodePath) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.resource === 'string' && !resourceSchemaIndex.has(node.resource)) {
      errors.push({
        message: `resource "${node.resource}" names no resource. Name it by the schema its endpoints return, such as ApplicationMember.`,
        path: nodePath,
      });
    }
    for (const [key, child] of Object.entries(node.include ?? {})) checkNode(child, `${nodePath}.include.${key}`);
    for (const [key, child] of Object.entries(node.sections ?? {})) checkNode(child, `${nodePath}.sections.${key}`);
    for (const [key, child] of Object.entries(node.panel?.include ?? {})) checkNode(child, `${nodePath}.panel.include.${key}`);
  }

  const { domain, doc } = compositionDoc;
  for (const [name, composition] of Object.entries(doc.compositions || {})) {
    checkNode(composition, `${domain}.compositions.${name}`);
  }
  return errors;
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
// Fields Array Validation
// =============================================================================

/**
 * Validate all fields: arrays in a composition document against the resource schema index.
 * Fields arrays contain dot-separated paths like "id", "contact.name.firstName".
 * Validates that each path resolves to a property on the referenced resource schema.
 *
 * @param {Object} compositionDoc - { domain, doc: { compositions } }
 * @param {Map<string, Set<string>>} resourceSchemaIndex
 * @returns {Array<{ message: string, path: string }>}
 */
export function validateFieldsArrays(compositionDoc, resourceSchemaIndex) {
  const errors = [];

  function getNestedProperty(props, fieldPath) {
    const parts = fieldPath.split('.');
    // Only validate the top-level field; nested paths may reference sub-schemas
    // not indexed here. Report only if the top-level field is missing.
    return props?.has(parts[0]) ?? false;
  }

  function checkNode(node, nodePath) {
    if (!node || typeof node !== 'object') return;

    if (node.fields && node.resource) {
      const props = resourceSchemaIndex.get(node.resource);
      if (props) {
        const fields = Array.isArray(node.fields) ? node.fields : [];
        for (const field of fields) {
          // `source as alias` names the field it projects by its source.
          const topField = String(field).split(/\s+as\s+/)[0].split('.')[0];
          if (topField === '*') continue;
          if (!props.has(topField)) {
            errors.push({
              message: `fields: "${field}" — field "${topField}" not found on resource "${node.resource}"`,
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
// Sortable Config Validation
// =============================================================================

const SORTABLE_FIELD_REGEX = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * Validate sortable config declared on section nodes.
 * Checks that every field name in sortable.fields matches the identifier regex
 * (same rule enforced by parseSortString and the pattern validator at runtime).
 *
 * @param {Object} compositionDoc - { domain, doc: { compositions } }
 * @returns {Array<{ message: string, path: string }>}
 */
export function validateSortableConfig(compositionDoc) {
  const errors = [];
  const { domain, doc } = compositionDoc;

  for (const [name, composition] of Object.entries(doc.compositions || {})) {
    const sections = composition.sections || {};
    for (const [sectionName, section] of Object.entries(sections)) {
      const { sortable } = section;
      if (!sortable) continue;
      const nodePath = `${domain}.compositions.${name}.sections.${sectionName}.sortable`;
      for (const field of sortable.fields || []) {
        if (!SORTABLE_FIELD_REGEX.test(field)) {
          errors.push({
            message: `Sortable field "${field}" is not a valid identifier (must match [A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*)`,
            path: nodePath,
          });
        }
      }
      if (sortable.tieBreaker && !SORTABLE_FIELD_REGEX.test(sortable.tieBreaker)) {
        errors.push({
          message: `Sortable tieBreaker "${sortable.tieBreaker}" is not a valid identifier`,
          path: nodePath,
        });
      }
    }
  }

  return errors;
}

// =============================================================================
// Overlay Generation
// =============================================================================


/**
 * Capitalise the first letter of a string.
 */
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
  const name = stateConfig?.schema?.name;
  if (!name) return null;
  return {
    defsKey: name,
    kebabName: toKebabCase(name),
    camelKey: name.charAt(0).toLowerCase() + name.slice(1),
  };
}

/**
 * Load properties from the inline schema declared in state.schema.
 *
 * @param {Object} stateConfig - composition.state
 * @returns {{ properties: Object, required: string[] } | null}
 */
function loadCompanionSchemaEntry(stateConfig) {
  const schema = stateConfig?.schema;
  if (!schema?.name) return null;
  return {
    properties: schema.properties ?? {},
    required: schema.required ?? [],
  };
}

/**
 * Generate OpenAPI path and schema entries for the static panel endpoints of a sectionView composition.
 *
 * For sectionView compositions, emits one static path per section:
 *   GET {endpoint.path}/{sectionName}  — panel for each named section (section name baked in)
 *
 * @param {string} compositionName
 * @param {string} endpointPath - Index endpoint path (e.g. /applications/{applicationId}/review)
 * @param {Object} sections - Map of section name → section config from the composition definition
 * @param {Map<string, string>} paramIndex - From buildParameterIndex
 * @returns {{ paths: Object, schemaName: string, schemaEntry: Object }}
 */
export function generateSectionViewPanelEndpoints(compositionName, endpointPath, sections, paramIndex) {
  const paramNames = extractPathParams(endpointPath);
  const sectionSchemaName = `${toPascalCase(compositionName)}SectionResponse`;

  const parentParams = paramNames.map(name => {
    const ref = paramIndex.get(name);
    return ref
      ? { $ref: ref }
      : { name, in: 'path', required: true, schema: { type: 'string' } };
  });

  const paths = {};

  for (const [sectionName, sectionConfig] of Object.entries(sections)) {
    const sectionPath = `${endpointPath}/${sectionName}`;
    const operationId = `get${toPascalCase(compositionName)}${toPascalCase(sectionName)}Section`;

    const getOp = {
      summary: `Get ${compositionName} ${sectionName} section panel`,
      operationId,
      parameters: LIST_QUERY_PARAMS,
      responses: {
        '200': {
          description: `${compositionName} ${sectionName} section panel retrieved successfully.`,
          content: {
            'application/json': { schema: { $ref: `#/components/schemas/${sectionSchemaName}` } }
          }
        },
        '404': { $ref: './components/responses.yaml#/NotFound' },
        '500': { $ref: './components/responses.yaml#/InternalError' },
      }
    };

    if (sectionConfig?.sortable) {
      const xSortable = { fields: sectionConfig.sortable.fields };
      if (sectionConfig.sortable.default !== undefined) {
        xSortable.default = sectionConfig.sortable.default;
      }
      if (sectionConfig.sortable.tieBreaker !== undefined) {
        xSortable.tieBreaker = sectionConfig.sortable.tieBreaker;
      }
      getOp['x-sortable'] = xSortable;
    }

    paths[sectionPath] = {
      parameters: parentParams,
      get: getOp,
    };
  }

  const schemaEntry = {
    type: 'object',
    description: `Generated section panel response for ${compositionName}.`,
  };

  return { paths, schemaName: sectionSchemaName, schemaEntry };
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
export function generateStateEndpoints(composition, endpointPath, paramIndex) {
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

  const schemaEntries = generateStateSchemas(composition.state, composition.sections);

  return { pathEntries, schemaEntries };
}

/**
 * Generate OpenAPI schema entries for a composition state resource.
 *
 * Returns the three generated schemas ({Name}Writable, {Name}, {Name}ListResponse)
 * derived from the inline state.schema config. Used by both the resolve pipeline
 * (generateStateEndpoints) and the mock server (to augment apiSpec.schemas at startup
 * so loadStateDefaults can read defaults from the resolved spec).
 *
 * @param {Object} stateConfig - composition.state
 * @param {Object} [sections] - composition.sections, which a state record's section names
 * @returns {Object} Map of schema name → schema entry (empty object if no state config)
 */
export function generateStateSchemas(stateConfig, sections = {}) {
  const stateNameInfo = deriveStateResourceName(stateConfig);
  if (!stateNameInfo) return {};

  const { defsKey, camelKey } = stateNameInfo;
  const companionEntry = loadCompanionSchemaEntry(stateConfig);
  const writableProperties = companionEntry?.properties ?? {};
  const writableRequired   = companionEntry?.required ?? [];

  const writableSchemaName = `${defsKey}Writable`;
  const resourceSchemaName = defsKey;
  const listSchemaName     = `${defsKey}ListResponse`;

  const sectionNames = Object.keys(sections ?? {});
  const frameworkProperties = {
    id:            { type: 'string', format: 'uuid', readOnly: true },
    section:       { type: 'string', readOnly: true, ...(sectionNames.length > 0 ? { enum: sectionNames } : {}) },
    // The record this is about, for a section of records: of the resource
    // its section shows, so section is its type and each section maps to
    // that resource. A record's progress goes when the record does.
    itemId: {
      type: ['string', 'null'],
      format: 'uuid',
      readOnly: true,
      'x-relationship': {
        resource: 'Polymorphic',
        discriminator: {
          propertyName: 'section',
          mapping: Object.fromEntries(Object.entries(sections ?? {}).map(([name, section]) => [name, section.resource])),
        },
        onDelete: 'cascade',
      },
    },
    createdAt:     { type: 'string', format: 'date-time', readOnly: true },
    updatedAt:     { type: 'string', format: 'date-time', readOnly: true },
  };

  return {
    [writableSchemaName]: {
      type: 'object',
      description: `Client-writable fields for the ${camelKey} state resource. Framework fields (id, section, itemId, createdAt, updatedAt) are added automatically.`,
      ...(Object.keys(writableProperties).length > 0 ? { properties: writableProperties } : {}),
      ...(writableRequired.length > 0 ? { required: writableRequired } : {}),
    },
    [resourceSchemaName]: {
      type: 'object',
      description: `Generated state resource for ${camelKey}.`,
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
      description: `Paginated list of ${camelKey} state records.`,
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
 * Every resource a set's OpenAPI documents serve, by schema name: the
 * document that declares it, and whether it's one of a parent's singletons.
 *
 * @param {Array<{ relativePath: string, spec: Object }>} yamlFiles
 * @returns {Map<string, { relativePath: string, singleton: boolean }>}
 */
export function indexResourcesByName(yamlFiles) {
  const byName = new Map();
  for (const { relativePath, spec } of yamlFiles) {
    if (!spec?.paths) continue;
    for (const resource of buildApiModel(spec).resources) {
      for (const each of [resource, ...resource.singletons]) {
        if (each.name && !byName.has(each.name)) byName.set(each.name, { relativePath, singleton: each.singleton });
      }
    }
  }
  return byName;
}

/**
 * The key an editable composition's root record sits under: its resource
 * name with a lowercase first letter, `application` for `Application`.
 *
 * @param {Object} composition
 * @returns {string}
 */
export function rootKeyOf(composition) {
  const name = composition.resource ?? '';
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * A ref, from the document at `fromPath`, to the schema a resource's records
 * follow: local when the resource is declared there, relative otherwise.
 */
function recordRef(name, resources, fromPath) {
  const pointer = `#/components/schemas/${name}`;
  const declaredIn = resources.get(name)?.relativePath;
  if (!declaredIn || !fromPath || declaredIn === fromPath) return { $ref: pointer };
  const fromDir = fromPath.split('/').slice(0, -1);
  const to = declaredIn.split('/');
  let shared = 0;
  while (shared < fromDir.length && shared < to.length - 1 && fromDir[shared] === to[shared]) shared++;
  const up = fromDir.slice(shared).map(() => '..');
  return { $ref: `${up.length ? `${up.join('/')}/` : './'}${to.slice(shared).join('/')}${pointer}` };
}

/**
 * The response schema of an editable composition: the root record under its
 * own key, and each include beside it, keyed by record id, or a singleton as
 * one record or null. Every record is a ref to its resource's own schema.
 */
function editableResponseSchema(compositionName, composition, resources, fromPath) {
  const rootKey = rootKeyOf(composition);
  const properties = { [rootKey]: recordRef(composition.resource, resources, fromPath) };
  for (const [key, include] of Object.entries(composition.include ?? {})) {
    const record = recordRef(include.resource, resources, fromPath);
    properties[key] = resources.get(include.resource)?.singleton
      ? { description: `The ${include.resource}, or null when there isn't one.`, anyOf: [record, { type: 'null' }] }
      : {
        type: 'object',
        description: `The ${include.resource} records, keyed by id.`,
        propertyNames: { format: 'uuid' },
        additionalProperties: record,
      };
  }
  return {
    type: 'object',
    description: `The ${compositionName} composition: the ${composition.resource} under ${rootKey}, and the records it includes, whole. Change it with a JSON Patch to the same path.`,
    required: Object.keys(properties),
    additionalProperties: false,
    properties,
  };
}

/**
 * The update operation an editable composition serves: a JSON Patch applied
 * all or nothing, each change through its record's own operation.
 */
function editableUpdateOperation(compositionName, schemaName) {
  return {
    summary: `Change ${compositionName}`,
    operationId: `update${toPascalCase(compositionName)}`,
    description:
      'Applies a JSON Patch (RFC 6902) all or nothing. Each change is made through its record\'s own ' +
      'operation, as the caller, with that operation\'s permissions, guards and events; if any change ' +
      'is refused, nothing is saved and no events are sent. A change may add a record under an id the ' +
      'caller chooses, and another change in the same patch may name it.',
    parameters: [{ $ref: './components/parameters.yaml#/IdempotencyKeyParam' }],
    requestBody: {
      required: true,
      content: { 'application/json-patch+json': { schema: { $ref: JSON_PATCH_SCHEMA } } },
    },
    responses: {
      '200': {
        description: `${compositionName} after the patch.`,
        headers: { 'Idempotent-Replayed': { $ref: './components/headers.yaml#/IdempotentReplayed' } },
        content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } },
      },
      '400': {
        $ref: './components/responses.yaml#/BadRequest',
        description: 'The body is not a JSON Patch: not JSON, an unknown op, or an op missing what it needs.',
      },
      '403': {
        $ref: './components/responses.yaml#/Forbidden',
        description: 'A change\'s own operation doesn\'t let the caller make it. Nothing was saved.',
      },
      '404': { $ref: './components/responses.yaml#/NotFound' },
      '409': {
        $ref: './components/responses.yaml#/Conflict',
        description: 'The data changed since it was read: a test operation failed, a path names a record or field that isn\'t there, or a record is in a state its change can\'t start from. Nothing was saved.',
      },
      '415': { description: 'The request body is not application/json-patch+json.' },
      '422': {
        $ref: './components/responses.yaml#/UnprocessableEntity',
        description: 'A change is refused because its record\'s own operation refuses it, such as one to a field marked readOnly, or because it moves a record to another root. Nothing was saved.',
      },
      '500': { $ref: './components/responses.yaml#/InternalError' },
    },
  };
}

/**
 * Generate an OpenAPI overlay for a single composition file.
 *
 * Emits one path entry per composition that declares an `endpoint:`.
 * The generated operation includes:
 *  - parameter refs derived from the path pattern
 *  - a stub response schema named `{CompositionName}Response`
 *
 * When `composition.state` is declared, also emits state resource endpoints
 * following the standard API patterns (paginated list, get/put/patch by section
 * and item).
 *
 * The overlay uses `./components/responses.yaml#/...` for error response refs.
 * Callers that need a different prefix should rewrite refs after calling this.
 *
 * @param {Object} compositionFile - { filePath, domain, doc, apiSpecFile? } — `apiSpecFile`, the
 *   document the overlay patches, when the caller has worked it out
 * @param {Map<string, string>} paramIndex - from buildParameterIndex
 * @returns {Object|null} Overlay document, or null if no endpoints were declared
 */
export function generateCompositionOverlay(compositionFile, paramIndex, parentSchemaMap = null, resources = new Map()) {
  const { domain, doc, filePath } = compositionFile;
  const apiSpecFile = compositionFile.apiSpecFile ?? `${domain}-openapi.yaml`;

  const pathsUpdate = {};
  const schemasUpdate = {};
  const extraActions = [];

  for (const [compositionName, composition] of Object.entries(doc.compositions || {})) {
    if (!composition.endpoint?.path) continue;

    const endpointPath = composition.endpoint.path;
    const schemaName = `${toPascalCase(compositionName)}Response`;
    const operationId = `get${toPascalCase(compositionName)}`;

    const operation = {
      summary: `Get ${compositionName}`,
      operationId,
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

    pathsUpdate[endpointPath] = buildPathEntry(endpointPath, 'get', operation, paramIndex, { type: 'composition', domain, id: compositionName });

    const schemaEntry = {
      type: 'object',
      description: `Generated composition response for ${compositionName}.`,
    };
    schemasUpdate[schemaName] = schemaEntry;

    // editable compositions: a real response schema, and the PATCH that changes it
    if (composition.compositeType === 'editable') {
      schemasUpdate[schemaName] = editableResponseSchema(compositionName, composition, resources, compositionFile.apiSpecFile ?? null);
      const marker = { type: 'composition', domain, id: compositionName };
      pathsUpdate[endpointPath].patch = buildPathEntry(endpointPath, 'patch', editableUpdateOperation(compositionName, schemaName), paramIndex, marker).patch;
    }

    // sectionView compositions: also generate static per-section panel endpoints and section enum
    if (composition.compositeType === 'sectionView') {
      const sections = composition.sections || {};
      const panel = generateSectionViewPanelEndpoints(compositionName, endpointPath, sections, paramIndex);

      // Collect named views from the composition-level views map
      const viewNames = Object.keys(composition.views || {});
      if (viewNames.length > 0) {
        const viewParam = {
          name: 'view',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: viewNames },
          description: 'Named view projection to apply.',
        };
        // Add to the index endpoint operation
        if (!operation.parameters) operation.parameters = [];
        operation.parameters.push(viewParam);
        // Add to each per-section panel endpoint
        for (const pathEntry of Object.values(panel.paths)) {
          if (!pathEntry.get.parameters) pathEntry.get.parameters = [];
          pathEntry.get.parameters.push(viewParam);
        }
      }

      Object.assign(pathsUpdate, panel.paths);
      schemasUpdate[panel.schemaName] = panel.schemaEntry;

      const sectionKeys = Object.keys(sections);
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
      const { pathEntries, schemaEntries } = generateStateEndpoints(composition, endpointPath, paramIndex);
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
  const resources = indexResourcesByName(yamlFiles);
  const result = [];

  for (const compositionFile of compositionFiles) {
    const overlay = generateCompositionOverlay(compositionFile, paramIndex, parentSchemaMap, resources);
    if (overlay) {
      result.push({ overlay, domain: compositionFile.domain, target: compositionFile.apiSpecFile ?? null });
    }
  }

  return result;
}
