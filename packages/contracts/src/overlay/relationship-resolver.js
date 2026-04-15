/**
 * Relationship resolver for x-relationship extensions.
 *
 * States opt in by adding `x-relationship` to FK fields via overlays.
 * This module discovers those annotations and transforms the spec based
 * on the chosen relationship style.
 *
 * Resolution is intentionally build-time (overlay resolution), not request-time.
 * This produces static, predictable response shapes that enable type generation,
 * caching, and consistent client expectations.
 *
 * Supported styles:
 *   links-only  — adds a `links` object with URI references (default)
 *   expand      — replaces FK field with the related object schema (renamed: fooId → foo)
 *
 * Planned (not yet implemented):
 *   include     — JSON:API-style sideloading
 *   embed       — always inline related resources
 */

// =============================================================================
// Discovery
// =============================================================================

/**
 * Walk components.schemas for properties annotated with x-relationship.
 *
 * Handles both direct `properties` and `allOf` wrappers (where properties
 * may be nested inside allOf entries).
 *
 * @param {object} spec - Parsed OpenAPI spec
 * @returns {Array<{ schemaName: string, propertyName: string, relationship: object }>}
 */
function discoverRelationships(spec) {
  const results = [];
  const schemas = spec?.components?.schemas;
  if (!schemas) return results;

  for (const [schemaName, schema] of Object.entries(schemas)) {
    // Collect properties from direct definition and allOf entries
    const propertySources = [];

    if (schema.properties) {
      propertySources.push(schema.properties);
    }

    if (Array.isArray(schema.allOf)) {
      for (const entry of schema.allOf) {
        if (entry.properties) {
          propertySources.push(entry.properties);
        }
      }
    }

    for (const properties of propertySources) {
      for (const [propertyName, propertyDef] of Object.entries(properties)) {
        if (propertyDef?.['x-relationship']) {
          results.push({
            schemaName,
            propertyName,
            relationship: propertyDef['x-relationship']
          });
        }
      }
    }
  }

  return results;
}

// =============================================================================
// Schema Dependency Helpers
// =============================================================================

/**
 * Walk a schema object and collect all internal $ref targets of the form
 * "#/components/schemas/X", returning the schema names (e.g., "User", "Address").
 *
 * @param {*} node - Any value (recursively walked)
 * @returns {Set<string>} Schema names referenced
 */
function findSchemaRefs(node) {
  const refs = new Set();
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const item of n) walk(item); return; }
    for (const [key, value] of Object.entries(n)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith('#/components/schemas/')) {
        refs.add(value.slice('#/components/schemas/'.length));
      } else {
        walk(value);
      }
    }
  }
  walk(node);
  return refs;
}

/**
 * Copy a schema (and all its transitive $ref dependencies) from the schema index
 * into a target spec's components/schemas. Skips schemas already present in the target.
 * Uses the schema index to locate transitive deps that may live in different source specs.
 *
 * @param {string} schemaName - Schema to copy
 * @param {object} sourceSpec - Spec where schemaName is defined
 * @param {object} targetSpec - Spec to copy into
 * @param {Map<string, { spec: object, specFile: string }>} schemaIndex - Cross-spec schema index
 * @param {Set<string>} [visited] - Cycle guard (schema names already processed)
 */
function copySchemaWithDependencies(schemaName, sourceSpec, targetSpec, schemaIndex, visited = new Set()) {
  if (visited.has(schemaName)) return;
  visited.add(schemaName);

  if (!targetSpec.components) targetSpec.components = {};
  if (!targetSpec.components.schemas) targetSpec.components.schemas = {};

  // Already in target spec — no need to copy, but still recurse for its deps
  if (!targetSpec.components.schemas[schemaName]) {
    const schema = sourceSpec.components?.schemas?.[schemaName];
    if (!schema) return;
    targetSpec.components.schemas[schemaName] = JSON.parse(JSON.stringify(schema));
  }

  // Walk the now-copied schema for transitive $ref dependencies
  const deps = findSchemaRefs(targetSpec.components.schemas[schemaName]);
  for (const depName of deps) {
    if (visited.has(depName)) continue;
    if (targetSpec.components.schemas[depName]) {
      visited.add(depName);
      continue;
    }
    const depSource = schemaIndex.get(depName);
    if (!depSource) continue;
    copySchemaWithDependencies(depName, depSource.spec, targetSpec, schemaIndex, visited);
  }
}

// =============================================================================
// Schema Index
// =============================================================================

/**
 * Build an index mapping schema name → { spec, specFile } across all specs.
 * Used for cross-spec $ref resolution when expand style needs schema details.
 *
 * @param {Map<string, object>|Array<[string, object]>} allSpecs - Map or entries of specFile → spec
 * @returns {Map<string, { spec: object, specFile: string }>}
 */
function buildSchemaIndex(allSpecs) {
  const index = new Map();
  const entries = allSpecs instanceof Map ? allSpecs.entries() : allSpecs;

  for (const [specFile, spec] of entries) {
    const schemas = spec?.components?.schemas;
    if (!schemas) continue;

    for (const schemaName of Object.keys(schemas)) {
      index.set(schemaName, { spec, specFile });
    }
  }

  return index;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Derive a link/relationship name from an FK field name.
 * Strips trailing `Id` suffix: assignedToId → assignedTo, personId → person.
 * No suffix → returns as-is.
 *
 * @param {string} fkFieldName
 * @returns {string}
 */
function deriveLinkName(fkFieldName) {
  if (fkFieldName.endsWith('Id') && fkFieldName.length > 2) {
    return fkFieldName.slice(0, -2);
  }
  return fkFieldName;
}

/**
 * Derive the API base path for a resource name.
 * Converts PascalCase to kebab-case plural: User → /users, CaseWorker → /case-workers.
 *
 * @param {string} resource - Schema name (PascalCase)
 * @returns {string} Base path (e.g., '/users')
 */
function resourceNameToPath(resource) {
  const kebab = resource.replace(/([A-Z])/g, (m, c, offset) =>
    offset > 0 ? '-' + c.toLowerCase() : c.toLowerCase()
  );
  return `/${kebab}s`;
}

// =============================================================================
// Style Transforms
// =============================================================================

/**
 * Apply links-only style to a schema.
 * Adds a `links` property with URI entries for each annotated FK field.
 *
 * @param {object} schema - The schema object (mutated in place)
 * @param {Array<{ propertyName: string, relationship: object }>} fields - Annotated FK fields
 */
function applyLinksOnly(schema, fields) {
  // Find the properties object (direct or inside allOf)
  const propertiesObj = findPropertiesObject(schema);
  if (!propertiesObj) return;

  // Build links entries
  const linkProperties = {};
  for (const { propertyName, relationship } of fields) {
    const linkName = deriveLinkName(propertyName);
    linkProperties[linkName] = {
      type: 'string',
      format: 'uri',
      description: `Link to the related ${relationship.resource} resource.`
    };
  }

  // Add or merge into existing links property
  if (propertiesObj.links) {
    Object.assign(propertiesObj.links.properties || {}, linkProperties);
  } else {
    propertiesObj.links = {
      type: 'object',
      readOnly: true,
      description: 'Related resource links.',
      properties: linkProperties
    };
  }

  // Strip x-relationship from each FK field
  for (const { propertyName } of fields) {
    const propDef = findProperty(schema, propertyName);
    if (propDef) {
      delete propDef['x-relationship'];
    }
  }
}

/**
 * Apply expand style to a schema.
 * Renames the FK field (fooId → foo) and replaces it with the related object schema.
 * Resolution is build-time: the expanded object is always present, no query param needed.
 *
 * For full-object expand (no fields list), copies the target schema and all its transitive
 * $ref dependencies into the target spec's components/schemas so the local $ref resolves.
 *
 * @param {string} schemaName - Name of the schema being transformed (for warnings)
 * @param {object} schema - The schema object (mutated in place)
 * @param {Array<{ propertyName: string, relationship: object }>} fields - Annotated FK fields
 * @param {Map} schemaIndex - Schema index for cross-spec resolution
 * @param {string[]} warnings - Warning accumulator
 * @param {object} spec - The full target spec (needed to copy schemas for cross-spec refs)
 */
function applyExpand(schemaName, schema, fields, schemaIndex, warnings, spec) {
  for (const { propertyName, relationship } of fields) {
    // Build the expanded schema
    let expandedSchema;
    if (relationship.fields && Array.isArray(relationship.fields)) {
      // Inline subset: pick specific fields from the target schema
      const subsetProperties = buildSubsetProperties(
        relationship.resource, relationship.fields, schemaIndex, warnings
      );
      expandedSchema = {
        type: 'object',
        description: `Expanded ${relationship.resource} (subset).`,
        properties: subsetProperties
      };
    } else {
      // Full $ref to target schema — copy schema and all transitive deps into this spec
      const targetInfo = schemaIndex.get(relationship.resource);
      if (targetInfo) {
        copySchemaWithDependencies(relationship.resource, targetInfo.spec, spec, schemaIndex);
        expandedSchema = { $ref: `#/components/schemas/${relationship.resource}` };
      } else {
        warnings.push(
          `Resource "${relationship.resource}" not found in schema index for expand on ${schemaName}.${propertyName}`
        );
        expandedSchema = { type: 'object', description: `Expanded ${relationship.resource}.` };
      }
    }

    // Rename FK field (fooId → foo) and replace with expanded schema
    const expandedFieldName = deriveLinkName(propertyName);

    const propertySources = schema.properties ? [schema.properties] : [];
    if (Array.isArray(schema.allOf)) {
      for (const entry of schema.allOf) {
        if (entry.properties) propertySources.push(entry.properties);
      }
    }

    for (const props of propertySources) {
      if (propertyName in props) {
        delete props[propertyName];
        props[expandedFieldName] = expandedSchema;
        break;
      }
    }

    // Update required arrays so the renamed field stays required
    const schemasToCheck = [schema, ...(Array.isArray(schema.allOf) ? schema.allOf : [])];
    for (const s of schemasToCheck) {
      if (Array.isArray(s.required)) {
        const idx = s.required.indexOf(propertyName);
        if (idx !== -1) s.required[idx] = expandedFieldName;
      }
    }
  }
}

/**
 * Build subset properties by picking fields from the target schema.
 * Supports dot notation to reach into related resources (e.g., "case.application.name").
 * Each dot-path segment must correspond to an FK field with an x-relationship annotation.
 * Recursion terminates naturally when all paths are reduced to simple field names.
 *
 * @param {string} resourceName - Schema to pick fields from
 * @param {string[]} fields - Field names or dot paths (e.g., ['id', 'case.application.name'])
 * @param {Map} schemaIndex - Schema index for cross-spec resolution
 * @param {string[]} warnings - Warning accumulator
 * @returns {object} Properties object suitable for use in an inline object schema
 */
function buildSubsetProperties(resourceName, fields, schemaIndex, warnings) {
  const properties = {};
  const targetInfo = schemaIndex.get(resourceName);
  const targetSchema = targetInfo?.spec.components?.schemas?.[resourceName];
  const targetProperties = targetSchema ? gatherAllProperties(targetSchema) : {};

  // Separate simple fields from dot-notation paths, grouping by first segment
  const simpleFields = [];
  const nestedGroups = new Map(); // expandedName → subpaths[]

  for (const field of fields) {
    const dotIdx = field.indexOf('.');
    if (dotIdx === -1) {
      simpleFields.push(field);
    } else {
      const head = field.slice(0, dotIdx);
      const tail = field.slice(dotIdx + 1);
      if (!nestedGroups.has(head)) nestedGroups.set(head, []);
      nestedGroups.get(head).push(tail);
    }
  }

  // Simple fields: deep-copy from target schema
  for (const field of simpleFields) {
    if (targetProperties[field]) {
      properties[field] = JSON.parse(JSON.stringify(targetProperties[field]));
    } else {
      properties[field] = { type: 'string' };
      if (targetInfo) {
        warnings.push(`Field "${field}" not found on ${resourceName} schema; using generic string type`);
      }
    }
  }

  // Dot-notation groups: find the FK relationship and recurse
  for (const [head, subpaths] of nestedGroups) {
    // Find a property where deriveLinkName(propName) === head and has x-relationship
    const fkEntry = Object.entries(targetProperties).find(
      ([propName, propDef]) => deriveLinkName(propName) === head && propDef?.['x-relationship']
    );

    if (!fkEntry) {
      warnings.push(
        `No x-relationship field found for "${head}" on ${resourceName}; cannot resolve dot-notation path`
      );
      continue;
    }

    const [, fkPropDef] = fkEntry;
    const nestedResource = fkPropDef['x-relationship'].resource;
    const subsetProperties = buildSubsetProperties(nestedResource, subpaths, schemaIndex, warnings);

    properties[head] = {
      type: 'object',
      description: `Expanded ${nestedResource} (subset).`,
      properties: subsetProperties
    };
  }

  return properties;
}

/**
 * Gather all properties from a schema, including those in allOf entries.
 */
function gatherAllProperties(schema) {
  const properties = {};

  if (schema?.properties) {
    Object.assign(properties, schema.properties);
  }

  if (Array.isArray(schema?.allOf)) {
    for (const entry of schema.allOf) {
      if (entry.properties) {
        Object.assign(properties, entry.properties);
      }
    }
  }

  return properties;
}

/**
 * Find the properties object in a schema (direct or first allOf entry with properties).
 */
function findPropertiesObject(schema) {
  if (schema.properties) return schema.properties;

  if (Array.isArray(schema.allOf)) {
    for (const entry of schema.allOf) {
      if (entry.properties) return entry.properties;
    }
  }

  return null;
}

/**
 * Find a specific property definition in a schema (direct or allOf).
 */
function findProperty(schema, propertyName) {
  if (schema.properties?.[propertyName]) {
    return schema.properties[propertyName];
  }

  if (Array.isArray(schema.allOf)) {
    for (const entry of schema.allOf) {
      if (entry.properties?.[propertyName]) {
        return entry.properties[propertyName];
      }
    }
  }

  return null;
}

// =============================================================================
// Main Transform
// =============================================================================

const SUPPORTED_STYLES = ['links-only', 'expand'];
const PLANNED_STYLES = ['include', 'embed'];

/**
 * Resolve x-relationship annotations in a spec.
 *
 * For each annotated FK field, applies the appropriate style transform.
 * Per-field `style` overrides the global style.
 *
 * @param {object} spec - Parsed OpenAPI spec (deep-cloned before calling)
 * @param {string} globalStyle - Default style from config (default: 'links-only')
 * @param {Map} schemaIndex - Schema index from buildSchemaIndex()
 * @returns {{ result: object, warnings: string[], expandRenames: Array, linksData: Array }}
 *   expandRenames: fields that were expanded, for use with resolveExampleRelationships
 *   linksData: fields that got links-only treatment, for use with resolveExampleRelationships
 */
function resolveRelationships(spec, globalStyle = 'links-only', schemaIndex = new Map()) {
  const warnings = [];
  const expandRenames = [];
  const linksData = [];

  // Validate global style
  if (PLANNED_STYLES.includes(globalStyle)) {
    throw new Error(
      `Style "${globalStyle}" is not yet implemented. Supported styles: ${SUPPORTED_STYLES.join(', ')}.`
    );
  }

  const relationships = discoverRelationships(spec);
  if (relationships.length === 0) {
    return { result: spec, warnings, expandRenames };
  }

  // Warn about unknown resource references
  for (const { schemaName, propertyName, relationship } of relationships) {
    if (relationship.resource && !schemaIndex.has(relationship.resource)) {
      warnings.push(
        `${schemaName}.${propertyName}: resource "${relationship.resource}" not found in any loaded spec`
      );
    }
  }

  // Group by schema for batch processing
  const bySchema = new Map();
  for (const rel of relationships) {
    if (!bySchema.has(rel.schemaName)) {
      bySchema.set(rel.schemaName, []);
    }
    bySchema.get(rel.schemaName).push(rel);
  }

  // Process each schema
  for (const [schemaName, fields] of bySchema) {
    const schema = spec.components.schemas[schemaName];

    // Partition fields by effective style
    const linksOnlyFields = [];
    const expandFields = [];

    for (const field of fields) {
      const effectiveStyle = field.relationship.style || globalStyle;

      if (PLANNED_STYLES.includes(effectiveStyle)) {
        throw new Error(
          `Style "${effectiveStyle}" is not yet implemented. Supported styles: ${SUPPORTED_STYLES.join(', ')}.`
        );
      }

      if (effectiveStyle === 'expand') {
        expandFields.push(field);
      } else {
        linksOnlyFields.push(field);
      }
    }

    if (linksOnlyFields.length > 0) {
      applyLinksOnly(schema, linksOnlyFields);

      for (const field of linksOnlyFields) {
        linksData.push({
          propertyName: field.propertyName,
          linkName: deriveLinkName(field.propertyName),
          resource: field.relationship.resource,
          basePath: resourceNameToPath(field.relationship.resource)
        });
      }
    }

    if (expandFields.length > 0) {
      applyExpand(schemaName, schema, expandFields, schemaIndex, warnings, spec);

      for (const field of expandFields) {
        expandRenames.push({
          propertyName: field.propertyName,
          expandedFieldName: deriveLinkName(field.propertyName),
          resource: field.relationship.resource,
          fields: field.relationship.fields || null
        });
      }
    }
  }

  return { result: spec, warnings, expandRenames, linksData };
}

// =============================================================================
// Example Transform
// =============================================================================

/**
 * Build a flat index of id → record across multiple example data objects.
 * Used by resolveExampleRelationships to look up related resources by UUID.
 *
 * @param {object[]} allExamplesData - Array of parsed examples YAML objects
 * @returns {Map<string, object>}
 */
function buildExamplesIndex(allExamplesData) {
  const index = new Map();
  for (const examplesData of allExamplesData) {
    if (!examplesData || typeof examplesData !== 'object') continue;
    for (const record of Object.values(examplesData)) {
      if (record && typeof record === 'object' && record.id) {
        index.set(record.id, record);
      }
    }
  }
  return index;
}

/**
 * Build a subset of an example record according to a fields list that may include
 * dot-notation paths (e.g., ['id', 'case.application.name']).
 *
 * For each dot-notation path, finds the FK field in the record by matching
 * deriveLinkName(fkField) === firstSegment, looks up the related record by UUID
 * from the examples index, and recurses with the remaining path segments.
 * Recursion terminates naturally when all paths are reduced to simple field names.
 *
 * @param {object} record - The example record to pick fields from
 * @param {string[]} fields - Field names or dot paths
 * @param {Map<string, object>} examplesIndex - id → record across all example files
 * @param {string} context - Path string for warning messages
 * @param {string[]} warnings - Warning accumulator
 * @returns {object}
 */
function buildExampleSubset(record, fields, examplesIndex, context, warnings) {
  const subset = {};
  const simpleFields = [];
  const nestedGroups = new Map(); // head → subpaths[]

  for (const field of fields) {
    const dotIdx = field.indexOf('.');
    if (dotIdx === -1) {
      simpleFields.push(field);
    } else {
      const head = field.slice(0, dotIdx);
      const tail = field.slice(dotIdx + 1);
      if (!nestedGroups.has(head)) nestedGroups.set(head, []);
      nestedGroups.get(head).push(tail);
    }
  }

  for (const field of simpleFields) {
    if (field in record) subset[field] = record[field];
  }

  for (const [head, subpaths] of nestedGroups) {
    // Find the FK field: deriveLinkName(fkField) === head
    const fkField = Object.keys(record).find(k => deriveLinkName(k) === head && k !== head);

    if (!fkField) {
      warnings.push(`${context}: no FK field found for "${head}"; cannot resolve dot-notation path`);
      continue;
    }

    const uuid = record[fkField];
    if (!uuid) {
      subset[head] = null;
      continue;
    }

    const relatedRecord = examplesIndex.get(uuid);
    if (!relatedRecord) {
      warnings.push(`${context}.${head}: no example found with id "${uuid}"`);
      subset[head] = uuid; // best effort: preserve raw UUID
      continue;
    }

    subset[head] = buildExampleSubset(relatedRecord, subpaths, examplesIndex, `${context}.${head}`, warnings);
  }

  return subset;
}

/**
 * Transform example records to match expand-style field renames and links-only additions.
 *
 * For each expand rename, finds example records that have the FK field,
 * looks up the related resource by UUID from the examples index, and
 * replaces the FK value with the full joined object (or a subset if
 * `fields` was specified on the relationship). Fields may include dot-notation
 * paths to reach into related resources (e.g., 'case.application.name').
 *
 * For each links-only entry, adds a `links` object to example records with
 * URI values derived from the FK field value (e.g., assignedToId → links.assignedTo: "/users/{id}").
 *
 * @param {object} examplesData - Parsed examples YAML (key → record)
 * @param {Array<{ propertyName, expandedFieldName, resource, fields }>} expandRenames
 * @param {Map<string, object>} examplesIndex - id → record across all example files
 * @param {Array<{ propertyName, linkName, resource, basePath }>} linksData
 * @returns {{ result: object, warnings: string[] }}
 */
function resolveExampleRelationships(examplesData, expandRenames, examplesIndex, linksData = []) {
  if (!examplesData || (expandRenames.length === 0 && linksData.length === 0)) {
    return { result: examplesData, warnings: [] };
  }

  const warnings = [];
  const result = JSON.parse(JSON.stringify(examplesData));

  for (const [exampleName, record] of Object.entries(result)) {
    if (!record || typeof record !== 'object') continue;

    for (const { propertyName, expandedFieldName, resource, fields } of expandRenames) {
      if (!(propertyName in record)) continue;

      const fkValue = record[propertyName];
      delete record[propertyName];

      if (!fkValue) {
        record[expandedFieldName] = null;
        continue;
      }

      const relatedRecord = examplesIndex.get(fkValue);

      if (!relatedRecord) {
        warnings.push(
          `${exampleName}.${propertyName}: no example found with id "${fkValue}" for resource "${resource}"`
        );
        record[expandedFieldName] = fkValue; // best effort: preserve raw UUID
        continue;
      }

      if (fields && Array.isArray(fields)) {
        record[expandedFieldName] = buildExampleSubset(
          relatedRecord, fields, examplesIndex, `${exampleName}.${expandedFieldName}`, warnings
        );
      } else {
        // No fields specified — use full related record, but also apply expand
        // renames to it so its own FK fields are expanded (matching schema
        // behavior where all annotations are resolved in the same pass).
        const wrapped = { _: { ...relatedRecord } };
        const { result: expanded } = resolveExampleRelationships(
          wrapped, expandRenames, examplesIndex, []
        );
        record[expandedFieldName] = expanded._;
      }
    }

    // links-only: add a links object with URI values
    const linksToAdd = {};
    for (const { propertyName, linkName, basePath } of linksData) {
      if (!(propertyName in record)) continue;
      const fkValue = record[propertyName];
      if (fkValue) {
        linksToAdd[linkName] = `${basePath}/${fkValue}`;
      }
    }
    if (Object.keys(linksToAdd).length > 0) {
      record.links = record.links
        ? { ...record.links, ...linksToAdd }
        : linksToAdd;
    }
  }

  return { result, warnings };
}

export {
  discoverRelationships,
  buildSchemaIndex,
  deriveLinkName,
  resolveRelationships,
  buildExamplesIndex,
  resolveExampleRelationships
};
