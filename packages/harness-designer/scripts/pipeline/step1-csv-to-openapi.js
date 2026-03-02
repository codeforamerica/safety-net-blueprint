/**
 * Step 1: Federal CSV → OpenAPI 3.1.0 schema YAML
 *
 * Parses the federal benefits data model CSV and generates an OpenAPI 3.1.0
 * components schema with Application, Household, Person, Income, Asset, and
 * Expense schemas wired together via $ref relationships.
 *
 * Output: generated/openapi/federal-benefits-schema.yaml
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import yaml from 'js-yaml';
import { parseCSV } from './csv-parser.js';
import {
  INCLUDED_ENTITIES,
  SYSTEM_FIELDS,
  ENTITY_RELATIONSHIPS,
  resolveHouseholdGroup,
  csvTypeToOpenAPI,
} from './entity-map.js';

/**
 * @param {string} csvPath - Path to federal CSV
 * @param {string} outPath - Path for output YAML
 */
export function generateOpenAPISchema(csvPath, outPath) {
  const text = readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(text);

  // Collect fields per entity (skip relationship-only rows and Type Requirements)
  const entityFields = {};
  for (const entity of INCLUDED_ENTITIES) {
    entityFields[entity] = [];
  }

  for (const row of rows) {
    const entity = row.Entity;
    if (!INCLUDED_ENTITIES.includes(entity)) continue;
    if (!row.Field || row.Field.startsWith('(')) continue; // skip header/type-req rows
    if (SYSTEM_FIELDS.has(row.Field)) continue;

    entityFields[entity].push(row);
  }

  // Build OpenAPI component schemas
  const schemas = {};

  for (const entity of INCLUDED_ENTITIES) {
    const properties = {};
    const fieldRows = entityFields[entity];

    // Track Household sub-object groups
    const householdGroups = {};

    for (const row of fieldRows) {
      const fieldName = row.Field;
      const typeInfo = csvTypeToOpenAPI(row.DataType, row.EnumValues);

      if (row.Label) {
        typeInfo.description = row.Label;
      }

      if (entity === 'Household') {
        const grouped = resolveHouseholdGroup(fieldName);
        if (grouped) {
          if (!householdGroups[grouped.group]) {
            householdGroups[grouped.group] = { type: 'object', properties: {} };
          }
          householdGroups[grouped.group].properties[grouped.subField] = typeInfo;
          continue;
        }
      }

      properties[fieldName] = typeInfo;
    }

    // Merge Household sub-object groups into properties
    if (entity === 'Household') {
      for (const [groupName, groupSchema] of Object.entries(householdGroups)) {
        properties[groupName] = groupSchema;
      }
    }

    // Wire entity relationships
    const rels = ENTITY_RELATIONSHIPS[entity];
    if (rels) {
      for (const [propName, rel] of Object.entries(rels)) {
        if (rel.type === 'object') {
          properties[propName] = { $ref: `#/components/schemas/${rel.ref}` };
        } else if (rel.type === 'array') {
          properties[propName] = {
            type: 'array',
            items: { $ref: `#/components/schemas/${rel.ref}` },
          };
        }
      }
    }

    schemas[entity] = {
      type: 'object',
      properties,
    };
  }

  // Build ApplicationCreate / ApplicationUpdate wrappers
  schemas.ApplicationCreate = { $ref: '#/components/schemas/Application' };
  schemas.ApplicationUpdate = {
    description: 'Partial update — all fields optional',
    allOf: [{ $ref: '#/components/schemas/Application' }],
  };

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Federal Benefits Data Model',
      version: '1.0.0',
      description: 'Generated from federal-benefits-data-model.csv',
      'x-api-id': 'applications',
    },
    paths: {},
    components: { schemas },
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, yaml.dump(spec, { lineWidth: 120, noRefs: true }));

  // Stats
  let totalFields = 0;
  for (const entity of INCLUDED_ENTITIES) {
    const count = entityFields[entity].length;
    totalFields += count;
    console.log(`  ${entity}: ${count} fields`);
  }
  console.log(`  Total: ${totalFields} fields across ${INCLUDED_ENTITIES.length} entities`);

  return spec;
}
