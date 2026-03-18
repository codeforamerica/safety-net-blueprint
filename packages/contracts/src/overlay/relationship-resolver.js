/**
 * Relationship resolver for x-relationship extensions.
 *
 * States opt in by adding `x-relationship` to FK fields via overlays.
 * This module discovers those annotations and transforms the spec based
 * on the chosen relationship style.
 *
 * Supported styles:
 *   links-only  — adds a `links` object with URI references (default)
 *   expand      — converts FK to oneOf[string, object], adds ?expand param
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
 * Find GET endpoints that return a given schema (direct or via list wrapper).
 *
 * @param {object} spec - Parsed OpenAPI spec
 * @param {string} schemaName - Schema name to match
 * @returns {string[]} Array of path strings (e.g., ["/tasks", "/tasks/{taskId}"])
 */
function findGetEndpoints(spec, schemaName) {
  const endpoints = [];
  if (!spec.paths) return endpoints;

  const directRef = `#/components/schemas/${schemaName}`;

  for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
    const getOp = pathItem?.get;
    if (!getOp) continue;

    const responseSchema = getOp.responses?.['200']?.content?.['application/json']?.schema;
    if (!responseSchema) continue;

    // Direct $ref match (item endpoint)
    if (responseSchema.$ref === directRef) {
      endpoints.push(pathStr);
      continue;
    }

    // List endpoint: check allOf entries for items.$ref match
    if (Array.isArray(responseSchema.allOf)) {
      for (const entry of responseSchema.allOf) {
        if (entry.properties?.items?.items?.$ref === directRef) {
          endpoints.push(pathStr);
          break;
        }
      }
    }

    // List endpoint: direct properties.items check
    if (responseSchema.properties?.items?.items?.$ref === directRef) {
      endpoints.push(pathStr);
    }

    // List endpoint via $ref to a *List schema — resolve and check
    if (responseSchema.$ref && responseSchema.$ref.startsWith('#/components/schemas/')) {
      const listSchemaName = responseSchema.$ref.replace('#/components/schemas/', '');
      const listSchema = spec.components?.schemas?.[listSchemaName];
      if (listSchema) {
        // Check direct properties
        if (listSchema.properties?.items?.items?.$ref === directRef) {
          endpoints.push(pathStr);
          continue;
        }
        // Check allOf
        if (Array.isArray(listSchema.allOf)) {
          for (const entry of listSchema.allOf) {
            if (entry.properties?.items?.items?.$ref === directRef) {
              endpoints.push(pathStr);
              break;
            }
          }
        }
      }
    }
  }

  return endpoints;
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
 * Apply expand style to a schema and its GET endpoints.
 * Converts FK fields to oneOf[string, object/$ref] and adds ?expand query param.
 *
 * @param {object} spec - Full parsed OpenAPI spec (mutated in place)
 * @param {string} schemaName - Name of the schema being transformed
 * @param {object} schema - The schema object (mutated in place)
 * @param {Array<{ propertyName: string, relationship: object }>} fields - Annotated FK fields
 * @param {Map} schemaIndex - Schema index for cross-spec resolution
 * @param {string[]} warnings - Warning accumulator
 */
function applyExpand(spec, schemaName, schema, fields, schemaIndex, warnings) {
  const expandableNames = [];

  for (const { propertyName, relationship } of fields) {
    const propDef = findProperty(schema, propertyName);
    if (!propDef) continue;

    const linkName = deriveLinkName(propertyName);
    expandableNames.push(linkName);

    // Preserve the original description
    const originalDescription = propDef.description;

    // Build the expanded alternative
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
      // Full $ref to target schema
      const targetInfo = schemaIndex.get(relationship.resource);
      if (targetInfo) {
        expandedSchema = {
          $ref: `#/components/schemas/${relationship.resource}`
        };
      } else {
        // Target not in this spec — use inline object as fallback
        warnings.push(
          `Resource "${relationship.resource}" not found in schema index for expand on ${schemaName}.${propertyName}`
        );
        expandedSchema = {
          type: 'object',
          description: `Expanded ${relationship.resource}.`
        };
      }
    }

    // Replace property with oneOf
    const oneOf = [
      { type: 'string', format: 'uuid', description: `${relationship.resource} ID.` },
      expandedSchema
    ];

    // Clear existing keys and set new structure
    const keysToRemove = Object.keys(propDef).filter(k => k !== 'description');
    for (const key of keysToRemove) {
      delete propDef[key];
    }
    propDef.oneOf = oneOf;
    if (originalDescription) {
      propDef.description = originalDescription;
    }
  }

  // Add ?expand query parameter to GET endpoints
  if (expandableNames.length > 0) {
    const endpoints = findGetEndpoints(spec, schemaName);
    const expandParam = {
      name: 'expand',
      in: 'query',
      description: 'Comma-separated list of relationships to expand inline.',
      schema: {
        type: 'array',
        items: { type: 'string' }
      },
      style: 'form',
      explode: false,
      example: expandableNames.join(',')
    };

    for (const pathStr of endpoints) {
      const getOp = spec.paths[pathStr].get;
      if (!getOp.parameters) {
        getOp.parameters = [];
      }
      // Don't add if already present
      if (!getOp.parameters.some(p => p.name === 'expand')) {
        getOp.parameters.push(expandParam);
      }
    }
  }
}

/**
 * Build subset properties by picking fields from the target schema.
 * Falls back to generic string type if the target schema or field is not found.
 */
function buildSubsetProperties(resourceName, fields, schemaIndex, warnings) {
  const properties = {};
  const targetInfo = schemaIndex.get(resourceName);

  if (!targetInfo) {
    // Can't resolve — generate generic properties
    for (const field of fields) {
      properties[field] = { type: 'string' };
    }
    return properties;
  }

  const targetSchema = targetInfo.spec.components?.schemas?.[resourceName];
  const targetProperties = gatherAllProperties(targetSchema);

  for (const field of fields) {
    if (targetProperties[field]) {
      // Deep copy the property definition (strip readOnly, examples, etc. that are schema-level)
      properties[field] = JSON.parse(JSON.stringify(targetProperties[field]));
    } else {
      properties[field] = { type: 'string' };
      warnings.push(
        `Field "${field}" not found on ${resourceName} schema; using generic string type`
      );
    }
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
 * @returns {{ result: object, warnings: string[] }}
 */
function resolveRelationships(spec, globalStyle = 'links-only', schemaIndex = new Map()) {
  const warnings = [];

  // Validate global style
  if (PLANNED_STYLES.includes(globalStyle)) {
    throw new Error(
      `Style "${globalStyle}" is not yet implemented. Supported styles: ${SUPPORTED_STYLES.join(', ')}.`
    );
  }

  const relationships = discoverRelationships(spec);
  if (relationships.length === 0) {
    return { result: spec, warnings };
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
    }

    if (expandFields.length > 0) {
      applyExpand(spec, schemaName, schema, expandFields, schemaIndex, warnings);
    }
  }

  return { result: spec, warnings };
}

export {
  discoverRelationships,
  buildSchemaIndex,
  deriveLinkName,
  resolveRelationships,
  findGetEndpoints
};
