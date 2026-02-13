#!/usr/bin/env node
/**
 * Export Design Reference
 * Generates a designer-friendly HTML reference from OpenAPI schemas
 * Uses OOUX/ORCA methodology for better designer usability
 * Includes state-specific variations via overlay system
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import yaml from 'js-yaml';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { discoverApiSpecs } from '../src/validation/openapi-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set of valid schema names (populated during main execution)
// Used to only create links for schemas that actually exist
let validSchemaNames = new Set();

// Map of inline object schemas discovered during processing
// Key: inferred type name, Value: { schema, parentSchema, propName }
const inlineObjectSchemas = new Map();

// Type translations for designers
const TYPE_TRANSLATIONS = {
  string: 'Text',
  integer: 'Number',
  number: 'Number',
  boolean: 'Yes/No',
  array: 'List of',
  object: 'Object',
};

// Format-specific translations
const FORMAT_TRANSLATIONS = {
  uuid: 'ID',
  email: 'Email',
  date: 'Date',
  'date-time': 'Date & Time',
  uri: 'URL',
};

// High-level domain hierarchy (architecture-level domains)
const DOMAIN_HIERARCHY = {
  intake: {
    name: 'Intake',
    description: 'The application as the client experiences it - what they report',
    color: '#3498db',
    bgColor: '#ebf5fb',
    schemas: ['Application', 'HouseholdMember', 'Household', 'Income', 'Expense',
              'Resource', 'LivingArrangement', 'Name', 'Address', 'DemographicInfo',
              'CitizenshipInfo', 'ImmigrationInfo', 'ContactInfo', 'EducationInfo',
              'EmploymentInfo', 'HealthInfo', 'DisabilityInfo', 'MilitaryInfo', 'TribalInfo',
              'UnearnedIncomeSource', 'LumpSumPayment', 'IncomeChangeInfo', 'StrikeInfo',
              'FinancialResource', 'Vehicle', 'InsurancePolicy', 'RealEstateProperty',
              'TransferredAsset', 'SelfEmployment', 'Job', 'HealthInsuranceEnrollment',
              'HealthCoverage', 'Medicare', 'FamilyPlanningInfo', 'InstitutionalizedInfo',
              'NonCitizenApplicationInfo', 'FinancialAidInfo', 'ResourceInfo', 'ExpenseInfo']
  },
  clientManagement: {
    name: 'Client Management',
    description: 'Persistent identity and relationships across programs',
    color: '#27ae60',
    bgColor: '#e8f8f0',
    schemas: ['Person', 'Client', 'Relationship', 'ClientContactInfo', 'ClientHistory']
  },
  eligibility: {
    name: 'Eligibility',
    description: 'Program-specific interpretation and determination',
    color: '#9b59b6',
    bgColor: '#f5eef8',
    schemas: ['EligibilityRequest', 'EligibilityUnit', 'Determination', 'EligibilityResult',
              'BenefitCalculation', 'EligibilityRule']
  },
  caseManagement: {
    name: 'Case Management',
    description: 'Ongoing client relationships and staff assignments',
    color: '#e67e22',
    bgColor: '#fdf2e9',
    schemas: ['Case', 'CaseWorker', 'Supervisor', 'Office', 'Assignment', 'CaseNote',
              'CaseAction', 'CaseStatus']
  },
  workflow: {
    name: 'Workflow',
    description: 'Work items, tasks, SLAs, and verification',
    color: '#1abc9c',
    bgColor: '#e8f6f3',
    schemas: ['Task', 'Queue', 'WorkflowRule', 'VerificationTask', 'VerificationItem',
              'SLA', 'Deadline', 'WorkItem']
  },
  scheduling: {
    name: 'Scheduling',
    description: 'Time-based coordination and appointments',
    color: '#f39c12',
    bgColor: '#fef9e7',
    schemas: ['Appointment', 'Interview', 'Reminder', 'TimeSlot', 'Calendar',
              'AvailabilitySlot']
  },
  documentManagement: {
    name: 'Document Management',
    description: 'Files, uploads, and document tracking',
    color: '#95a5a6',
    bgColor: '#f4f6f6',
    schemas: ['Document', 'Upload', 'DocumentType', 'DocumentRequest', 'Attachment']
  },
  crossCutting: {
    name: 'Cross-cutting',
    description: 'Concerns that span all domains',
    color: '#7f8c8d',
    bgColor: '#f8f9f9',
    subdomains: {
      communication: {
        name: 'Communication',
        schemas: ['Notice', 'Correspondence', 'Message', 'Notification', 'Template']
      },
      configuration: {
        name: 'Configuration',
        schemas: ['ConfigSetting', 'ProgramRules', 'SystemConfig']
      },
      reporting: {
        name: 'Reporting',
        schemas: ['Report', 'AuditLog', 'AuditEntry', 'Metric']
      }
    }
  }
};

// Attribute category mapping for property-level grouping (formerly DOMAIN_MAPPING)
// System fields that should be grouped separately
const SYSTEM_FIELDS = ['id', 'createdAt', 'updatedAt'];

// Domain display configuration for special domains
// Dynamic domains (schema names) use getDomainConfig() for consistent styling
const DOMAIN_CONFIG = {
  fields: { name: 'Fields', color: '#3498db', bgColor: '#ebf5fb' },
  system: { name: 'System', color: '#95a5a6', bgColor: '#f8f9f9' },
};

/**
 * Get domain config, generating consistent colors for dynamic domains
 */
function getDomainConfig(domainKey) {
  if (DOMAIN_CONFIG[domainKey]) {
    return DOMAIN_CONFIG[domainKey];
  }

  // For schema-derived domains, format the name nicely and use neutral styling
  // "ContactInfo" → "Contact Info"
  const name = domainKey.replace(/([a-z])([A-Z])/g, '$1 $2');
  return { name, color: '#566573', bgColor: '#f2f3f4' };
}

// Primary schemas that get full ORCA treatment
const PRIMARY_SCHEMAS = ['Person', 'Household', 'Application', 'Income', 'HouseholdMember'];

// Map of property refs: { "SchemaName.propertyName": "TargetSchemaName" }
// Populated before dereferencing to preserve type information
const PROPERTY_REFS = {};

/**
 * Extract property refs from raw schemas before dereferencing
 * Populates PROPERTY_REFS map with { "SchemaName.propName": "TargetSchemaName" }
 */
function extractPropertyRefs(rawSchemas) {
  // Helper to recursively extract refs from an object schema
  function extractFromObject(schemaName, props) {
    for (const [propName, propSchema] of Object.entries(props)) {
      if (!propSchema) continue;

      // Direct $ref
      if (propSchema.$ref) {
        const refTarget = propSchema.$ref.split('/').pop();
        PROPERTY_REFS[`${schemaName}.${propName}`] = refTarget;
      }

      // Array of $ref
      if (propSchema.type === 'array' && propSchema.items?.$ref) {
        const refTarget = propSchema.items.$ref.split('/').pop();
        PROPERTY_REFS[`${schemaName}.${propName}`] = refTarget;
      }

      // Inline object - recurse into its properties
      if (propSchema.type === 'object' && propSchema.properties) {
        // Infer schema name from property name (e.g., "household" -> "Household")
        const inferredName = propName.charAt(0).toUpperCase() + propName.slice(1);
        extractFromObject(inferredName, propSchema.properties);
      }

      // Array of inline objects - recurse into item properties
      if (propSchema.type === 'array' && propSchema.items?.type === 'object' && propSchema.items?.properties) {
        // Infer schema name from singular property name (e.g., "members" -> "Member")
        let itemName = propName.endsWith('s') ? propName.slice(0, -1) : propName;
        itemName = itemName.charAt(0).toUpperCase() + itemName.slice(1);
        extractFromObject(itemName, propSchema.items.properties);
      }
    }
  }

  for (const [schemaName, schema] of Object.entries(rawSchemas)) {
    if (!schema || typeof schema !== 'object') continue;

    // Handle allOf by merging properties
    let props = schema.properties || {};
    if (schema.allOf) {
      for (const part of schema.allOf) {
        if (part.properties) {
          props = { ...props, ...part.properties };
        }
      }
    }

    extractFromObject(schemaName, props);
  }
}

/**
 * Discover available state overlays
 */
/**
 * Capitalize first letter and convert camelCase to title case
 */
function inferTypeName(propName) {
  if (!propName) return null;
  // Capitalize first letter
  return propName.charAt(0).toUpperCase() + propName.slice(1);
}

/**
 * Translate a schema type to designer-friendly text
 * @param {object} schema - The schema to translate
 * @param {string} propName - Optional property name for inferring inline object types
 */
function translateType(schema, propName = null) {
  if (!schema) return 'Unknown';

  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop();
    return `→ ${refName}`;
  }

  if (schema.allOf) {
    return translateType(schema.allOf[0], propName);
  }

  if (schema.enum) {
    return 'Dropdown';
  }

  if (schema.type === 'array') {
    if (schema.items?.enum) {
      return 'Multi-select';
    }
    // For array items, derive singular name from property name (e.g., 'members' -> 'Member')
    let itemPropName = null;
    if (propName) {
      // Remove trailing 's' for simple plurals
      itemPropName = propName.endsWith('s') ? propName.slice(0, -1) : propName;
    }
    const itemType = translateType(schema.items, itemPropName);
    return `List of ${itemType}`;
  }

  if (schema.format && FORMAT_TRANSLATIONS[schema.format]) {
    return FORMAT_TRANSLATIONS[schema.format];
  }

  if (schema.pattern === '^\\d{3}-\\d{2}-\\d{4}$') {
    return 'SSN';
  }

  if (schema.pattern === '^\\+?[0-9 .\\-()]{7,20}$') {
    return 'Phone';
  }

  // For inline objects with properties, use the title or check if a real schema exists
  if (schema.type === 'object') {
    if (schema.title && validSchemaNames.has(schema.title)) {
      return `→ ${schema.title}`;
    }
    // For inline objects, check if the inferred name is a real schema
    if (propName) {
      const inferredName = inferTypeName(propName);
      if (validSchemaNames.has(inferredName)) {
        return `→ ${inferredName}`;
      }
    }
    // For inline objects, infer name from property - will be handled specially
    if (propName) {
      return `→ ${inferTypeName(propName)}`;
    }
    return 'Nested object';
  }

  return TYPE_TRANSLATIONS[schema.type] || schema.type || 'Unknown';
}

/**
 * Get enum values as a formatted string
 * Handles both direct enums and arrays of enums (multi-select)
 */
function formatEnumValues(schema) {
  // Direct enum
  if (schema.enum) {
    return schema.enum.map(v => String(v).replace(/_/g, ' ')).join(', ');
  }
  // Array of enums (multi-select)
  if (schema.type === 'array' && schema.items?.enum) {
    return schema.items.enum.map(v => String(v).replace(/_/g, ' ')).join(', ');
  }
  return null;
}

/**
 * Get attribute category derived from property type and name
 * - System fields: group as "System"
 * - Everything else (primitives and nested objects): group as "Fields"
 */
function getAttributeCategory(propName, propType) {
  // System fields
  if (SYSTEM_FIELDS.includes(propName)) {
    return 'system';
  }

  // All other fields (including nested objects) go into 'fields'
  return 'fields';
}

/**
 * Recursively collect properties and required fields from a schema with allOf
 */
function collectSchemaProperties(schema, collected = { properties: {}, required: [] }) {
  if (!schema) return collected;

  // If this schema has allOf, recursively collect from each part
  if (schema.allOf) {
    for (const part of schema.allOf) {
      collectSchemaProperties(part, collected);
    }
  }

  // Collect direct properties
  if (schema.properties) {
    Object.assign(collected.properties, schema.properties);
  }

  // Collect required fields
  if (schema.required) {
    collected.required = [...collected.required, ...schema.required];
  }

  return collected;
}

/**
 * Process a schema and extract property information
 */
function processSchema(schema, schemaName, stateSchemas = null) {
  const properties = [];

  // Recursively flatten allOf structures to get all properties
  const effectiveSchema = collectSchemaProperties(schema);

  const schemaProperties = effectiveSchema.properties || {};
  const required = effectiveSchema.required || [];

  for (const [propName, propSchema] of Object.entries(schemaProperties)) {
    const isRequired = required.includes(propName);

    // Check if we have a known reference for this property (preserved from pre-dereference)
    const refKey = `${schemaName}.${propName}`;
    const knownRef = PROPERTY_REFS[refKey];

    // For state processing, look up enum values from the referenced schema if available
    let stateEnumValues = null;
    if (stateSchemas && knownRef) {
      if (stateSchemas[knownRef]?.enum) {
        stateEnumValues = stateSchemas[knownRef].enum;
      }
    }

    // Check if this is an array of enums (multi-select)
    const isArrayOfEnums = propSchema.type === 'array' && propSchema.items?.enum;

    let type;
    if (isArrayOfEnums) {
      // Array of enums = Multi-select, regardless of whether it was a $ref
      type = 'Multi-select';
    } else if (knownRef) {
      // Use the known reference from before dereferencing
      const isArray = propSchema.type === 'array';
      // Check if the dereferenced items are just an enum (not an object)
      if (isArray && propSchema.items?.type === 'string' && propSchema.items?.enum) {
        type = 'Multi-select';
      } else {
        type = isArray ? `List of → ${knownRef}` : `→ ${knownRef}`;
      }
    } else {
      // Fall back to type inference
      type = translateType(propSchema, propName);
    }

    // Use state-specific enum values if available, otherwise use values from schema
    let enumValues;
    if (stateEnumValues) {
      enumValues = stateEnumValues.map(v => String(v).replace(/_/g, ' ')).join(', ');
    } else {
      enumValues = formatEnumValues(propSchema);
    }
    const isInlineObject = propSchema.type === 'object' && propSchema.properties && !knownRef;
    const isNested = propSchema.type === 'object' || propSchema.allOf ||
                     (propSchema.$ref && !['string', 'integer', 'number', 'boolean'].includes(propSchema.type)) ||
                     (knownRef !== undefined && !isArrayOfEnums);
    const isArrayOfObjects = propSchema.type === 'array' &&
                             !isArrayOfEnums &&
                             (propSchema.items?.type === 'object' || propSchema.items?.$ref || knownRef !== undefined);
    const isReadOnly = propSchema.readOnly === true;

    // Track inline objects so we can generate sections for them
    if (isInlineObject) {
      const inferredName = inferTypeName(propName);
      if (!inlineObjectSchemas.has(inferredName)) {
        inlineObjectSchemas.set(inferredName, {
          schema: propSchema,
          parentSchema: schemaName,
          propName: propName
        });
      }
    }

    // Also track array items that are inline objects
    if (propSchema.type === 'array' && propSchema.items?.type === 'object' && propSchema.items?.properties && !knownRef) {
      // Derive singular name from plural property name
      let itemName = propName.endsWith('s') ? propName.slice(0, -1) : propName;
      itemName = inferTypeName(itemName);
      if (!inlineObjectSchemas.has(itemName)) {
        inlineObjectSchemas.set(itemName, {
          schema: propSchema.items,
          parentSchema: schemaName,
          propName: `${propName} (array item)`
        });
      }
    }

    // Build description
    let description = propSchema.description || '';

    properties.push({
      name: propName,
      type,
      required: isRequired,
      readOnly: isReadOnly,
      description,
      enumValues,
      isNested: isNested || isArrayOfObjects,
      schema: propSchema,
      domain: getAttributeCategory(propName, type),
    });
  }

  return { properties };
}

/**
 * Group properties by domain
 */
function groupPropertiesByDomain(properties) {
  const grouped = {};

  for (const prop of properties) {
    const domain = prop.domain;
    if (!grouped[domain]) {
      grouped[domain] = [];
    }
    grouped[domain].push(prop);
  }

  // Sort domains: 'fields' first, then schema-derived domains alphabetically, 'system' last
  const sorted = {};
  const domains = Object.keys(grouped);

  // Fields first
  if (grouped.fields && grouped.fields.length > 0) {
    sorted.fields = grouped.fields;
  }

  // Schema-derived domains (alphabetically)
  const schemaDomains = domains.filter(d => d !== 'fields' && d !== 'system').sort();
  for (const domain of schemaDomains) {
    if (grouped[domain] && grouped[domain].length > 0) {
      sorted[domain] = grouped[domain];
    }
  }

  // System last
  if (grouped.system && grouped.system.length > 0) {
    sorted.system = grouped.system;
  }

  return sorted;
}

/**
 * Extract relationships from schemas
 */
function extractRelationships(schemas) {
  const relationships = {};

  for (const [schemaName, schema] of Object.entries(schemas)) {
    relationships[schemaName] = {
      extends: [],
      contains: [],
      referencedBy: [],
      belongsTo: [],
    };

    // Check allOf for inheritance
    if (schema.allOf) {
      for (const part of schema.allOf) {
        if (part.$ref) {
          const refName = part.$ref.split('/').pop();
          relationships[schemaName].extends.push(refName);
        }
      }
    }

    // Check properties for contained objects using PROPERTY_REFS (populated before dereferencing)
    const effectiveSchema = schema.allOf ?
      schema.allOf.reduce((acc, part) => ({
        ...acc,
        properties: { ...acc.properties, ...(part.properties || {}) }
      }), { properties: {} }) : schema;

    const props = effectiveSchema.properties || {};

    for (const [propName, propSchema] of Object.entries(props)) {
      // Use PROPERTY_REFS to find the target schema (works after dereferencing)
      const refKey = `${schemaName}.${propName}`;
      const refTarget = PROPERTY_REFS[refKey];

      if (refTarget) {
        const isArray = propSchema.type === 'array';
        relationships[schemaName].contains.push({
          name: refTarget,
          via: isArray ? `${propName}[]` : propName,
          isArray
        });
      }
      // Check for foreign keys within inline array objects (e.g., members[].personId)
      if (propSchema.type === 'array' && propSchema.items?.properties) {
        for (const [itemPropName, itemPropSchema] of Object.entries(propSchema.items.properties)) {
          if (itemPropName.endsWith('Id') && itemPropSchema.format === 'uuid') {
            const refName = itemPropName.slice(0, -2); // Remove 'Id' suffix
            const capitalized = refName.charAt(0).toUpperCase() + refName.slice(1);
            if (schemas[capitalized]) {
              relationships[schemaName].belongsTo.push({
                name: capitalized,
                via: `${propName}[].${itemPropName}`
              });
            }
          }
        }
      }
      // Check for foreign key patterns (personId, householdId, etc.)
      if (propName.endsWith('Id') && propSchema.format === 'uuid') {
        const refName = propName.replace(/Id$/, '');
        const capitalized = refName.charAt(0).toUpperCase() + refName.slice(1);
        if (schemas[capitalized]) {
          relationships[schemaName].belongsTo.push({ name: capitalized, via: propName });
        }
      }
    }
  }

  // Build referencedBy from belongsTo
  for (const [schemaName, rels] of Object.entries(relationships)) {
    for (const belongs of rels.belongsTo) {
      if (relationships[belongs.name]) {
        relationships[belongs.name].referencedBy.push({
          name: schemaName,
          via: belongs.via
        });
      }
    }
  }

  return relationships;
}

/**
 * Extract API operations for schemas
 */
function extractOperations(apiSpecs) {
  const operations = {};

  for (const spec of apiSpecs) {
    try {
      const content = readFileSync(spec.specPath, 'utf8');
      const parsed = yaml.load(content);

      if (!parsed.paths) continue;

      for (const [path, methods] of Object.entries(parsed.paths)) {
        for (const [method, operation] of Object.entries(methods)) {
          if (method === 'parameters') continue;

          // Extract schema name from response or request body
          let schemaName = null;

          // Try to get from 200/201 response
          const successResponse = operation.responses?.['200'] || operation.responses?.['201'];
          if (successResponse?.content?.['application/json']?.schema?.$ref) {
            schemaName = successResponse.content['application/json'].schema.$ref.split('/').pop();
          }

          // Try to get from request body
          if (!schemaName && operation.requestBody?.content?.['application/json']?.schema?.$ref) {
            schemaName = operation.requestBody.content['application/json'].schema.$ref.split('/').pop();
          }

          // Normalize schema names (PersonCreate -> Person, etc.)
          if (schemaName) {
            schemaName = schemaName.replace(/Create$|Update$|List$/, '');
          }

          if (!schemaName) continue;

          if (!operations[schemaName]) {
            operations[schemaName] = {};
          }

          const operationType = getOperationType(method, path, operation);
          if (operationType) {
            operations[schemaName][operationType] = {
              method: method.toUpperCase(),
              path,
              operationId: operation.operationId,
              summary: operation.summary,
              description: operation.description,
            };
          }
        }
      }
    } catch (err) {
      // Skip specs that can't be parsed
    }
  }

  return operations;
}

/**
 * Determine operation type from HTTP method and path
 */
function getOperationType(method, path, operation) {
  method = method.toLowerCase();
  const hasPathParam = path.includes('{');

  if (method === 'get' && !hasPathParam) return 'list';
  if (method === 'get' && hasPathParam) return 'get';
  if (method === 'post') return 'create';
  if (method === 'patch' || method === 'put') return 'update';
  if (method === 'delete') return 'delete';

  return null;
}

/**
 * Compare two schemas and find differences
 */
function findDifferences(baseSchema, stateSchema, schemaName) {
  const differences = {
    added: [],
    modified: [],
    removed: [],
  };

  const baseProps = getEffectiveProperties(baseSchema);
  const stateProps = getEffectiveProperties(stateSchema);

  for (const [propName, stateProp] of Object.entries(stateProps)) {
    if (!baseProps[propName]) {
      differences.added.push({
        name: propName,
        schema: stateProp,
        type: translateType(stateProp, propName),
        description: stateProp.description || '',
        enumValues: formatEnumValues(stateProp),
        domain: getAttributeCategory(propName),
      });
    } else {
      const baseProp = baseProps[propName];
      // Check for direct enum differences
      const baseEnum = baseProp.enum || baseProp.items?.enum;
      const stateEnum = stateProp.enum || stateProp.items?.enum;
      if (JSON.stringify(baseEnum) !== JSON.stringify(stateEnum)) {
        differences.modified.push({
          name: propName,
          baseEnum: baseEnum,
          stateEnum: stateEnum,
          description: stateProp.description || baseProp.description || '',
        });
      }
    }
  }

  for (const propName of Object.keys(baseProps)) {
    if (!stateProps[propName]) {
      differences.removed.push(propName);
    }
  }

  return differences;
}

/**
 * Get effective properties from schema (handling allOf)
 */
function getEffectiveProperties(schema) {
  if (!schema) return {};

  if (schema.allOf) {
    let props = {};
    for (const part of schema.allOf) {
      if (part.properties) {
        props = { ...props, ...part.properties };
      }
    }
    return props;
  }

  return schema.properties || {};
}

/**
 * Make type references clickable by wrapping schema names in links
 * Only creates links for schemas that actually exist (uses global validSchemaNames)
 * @param {string} typeString - The type string to process
 */
function makeTypeClickable(typeString) {
  // Match patterns like "→ SchemaName" or "List of → SchemaName"
  return typeString.replace(/→ (\w+)/g, (match, schemaName) => {
    if (validSchemaNames.has(schemaName)) {
      return `→ <a href="#${schemaName}" class="type-link">${schemaName}</a>`;
    }
    // No link for schemas that don't exist
    return `→ ${schemaName}`;
  });
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format field name to Title Case
 */
function formatFieldName(name) {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Generate relationship diagram SVG
 */
function generateRelationshipDiagram(relationships, schemas) {
  const primarySchemas = PRIMARY_SCHEMAS.filter(s => schemas[s]);

  let svg = `<svg class="relationship-diagram" viewBox="0 0 800 200" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#666"/>
      </marker>
    </defs>
    <style>
      .entity { fill: white; stroke: #3498db; stroke-width: 2; cursor: pointer; transition: all 0.2s; }
      .entity:hover { fill: #ebf5fb; stroke-width: 3; }
      .entity-label { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; font-weight: 600; pointer-events: none; }
      .relation-line { stroke: #666; stroke-width: 1.5; fill: none; marker-end: url(#arrowhead); }
      .relation-label { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 10px; fill: #666; }
      .entity-link { cursor: pointer; }
    </style>`;

  // Position entities
  const positions = {
    Person: { x: 50, y: 80 },
    Household: { x: 250, y: 80 },
    Application: { x: 500, y: 80 },
    Income: { x: 700, y: 80 },
    HouseholdMember: { x: 375, y: 160 },
  };

  // Draw entities (clickable)
  for (const name of primarySchemas) {
    const pos = positions[name];
    if (!pos) continue;

    svg += `
    <a class="entity-link" href="#${name}">
      <rect class="entity" x="${pos.x}" y="${pos.y}" width="120" height="40" rx="5"/>
      <text class="entity-label" x="${pos.x + 60}" y="${pos.y + 25}" text-anchor="middle">${name}</text>
    </a>`;
  }

  // Draw relationships
  // Person -> Household (members)
  if (positions.Person && positions.Household) {
    svg += `
    <path class="relation-line" d="M 170 100 L 245 100"/>
    <text class="relation-label" x="207" y="92">.members[]</text>`;
  }

  // Household -> Application
  if (positions.Household && positions.Application) {
    svg += `
    <path class="relation-line" d="M 370 100 L 495 100"/>
    <text class="relation-label" x="432" y="92">.household</text>`;
  }

  // Application -> Income
  if (positions.Application && positions.Income) {
    svg += `
    <path class="relation-line" d="M 620 100 L 695 100"/>
    <text class="relation-label" x="657" y="92">.personId</text>`;
  }

  // HouseholdMember extends Person
  if (positions.HouseholdMember && positions.Person) {
    svg += `
    <path class="relation-line" d="M 375 160 L 110 125" style="stroke-dasharray: 5,5"/>
    <text class="relation-label" x="230" y="148">extends</text>`;
  }

  svg += `</svg>`;

  return svg;
}

/**
 * Build domain-to-schemas mapping
 */
function buildDomainSchemaMap(schemas) {
  const domainMap = {};

  for (const [schemaName, schema] of Object.entries(schemas)) {
    const { properties } = processSchema(schema, schemaName);

    for (const prop of properties) {
      const domain = prop.domain;
      if (!domainMap[domain]) {
        domainMap[domain] = new Set();
      }
      domainMap[domain].add(schemaName);
    }
  }

  // Convert Sets to sorted Arrays
  for (const domain of Object.keys(domainMap)) {
    domainMap[domain] = [...domainMap[domain]].sort();
  }

  return domainMap;
}

/**
 * Generate domain browser section
 */
function generateDomainBrowser(domainSchemaMap) {
  const domainOrder = ['identity', 'contact', 'demographics', 'citizenship', 'employment',
                       'income', 'health', 'housing', 'resources', 'education',
                       'military', 'tribal', 'program', 'system', 'other'];

  let html = `<div class="domain-browser">\n`;
  html += `  <h3>Browse by Domain</h3>\n`;
  html += `  <p class="domain-browser-intro">Click a domain to see all objects containing fields in that category.</p>\n`;
  html += `  <div class="domain-cards">\n`;

  for (const domain of domainOrder) {
    const schemas = domainSchemaMap[domain];
    if (!schemas || schemas.length === 0) continue;

    const config = getDomainConfig(domain);
    const primaryCount = schemas.filter(s => PRIMARY_SCHEMAS.includes(s)).length;

    html += `    <div class="domain-card" style="--domain-color: ${config.color}; --domain-bg: ${config.bgColor};" data-domain="${domain}">\n`;
    html += `      <div class="domain-card-header">\n`;
    html += `        <span class="domain-card-indicator"></span>\n`;
    html += `        <span class="domain-card-name">${config.name}</span>\n`;
    html += `        <span class="domain-card-count">${schemas.length}</span>\n`;
    html += `      </div>\n`;
    html += `      <div class="domain-card-schemas" style="display: none;">\n`;

    // Primary schemas first
    const primarySchemas = schemas.filter(s => PRIMARY_SCHEMAS.includes(s));
    const otherSchemas = schemas.filter(s => !PRIMARY_SCHEMAS.includes(s));

    for (const schemaName of primarySchemas) {
      html += `        <a href="#${schemaName}" class="domain-schema-link primary">${schemaName}</a>\n`;
    }
    for (const schemaName of otherSchemas) {
      html += `        <a href="#${schemaName}" class="domain-schema-link">${schemaName}</a>\n`;
    }

    html += `      </div>\n`;
    html += `    </div>\n`;
  }

  html += `  </div>\n`;
  html += `</div>\n`;

  return html;
}

/**
 * Generate HTML for domain-grouped property tables
 */
function generateDomainGroupedTables(groupedProps) {
  let html = '';

  for (const [domain, props] of Object.entries(groupedProps)) {
    const config = getDomainConfig(domain);

    html += `<div class="domain-group" style="--domain-color: ${config.color}; --domain-bg: ${config.bgColor};">\n`;
    html += `  <h5 class="domain-header"><span class="domain-indicator"></span>${config.name}</h5>\n`;
    html += `  <table class="property-table">\n`;
    html += `    <thead>\n`;
    html += `      <tr>\n`;
    html += `        <th>Field</th>\n`;
    html += `        <th>Type</th>\n`;
    html += `        <th>Req</th>\n`;
    html += `        <th>Notes</th>\n`;
    html += `      </tr>\n`;
    html += `    </thead>\n`;
    html += `    <tbody>\n`;

    for (const prop of props) {
      const reqMark = prop.required ? '&#10003;' : '';
      const readOnlyMark = prop.readOnly ? ' <span class="read-only-badge">read-only</span>' : '';
      let notes = prop.description || '';
      if (prop.enumValues) {
        notes = `Options: ${prop.enumValues}`;
      }
      if (prop.isNested) {
        notes = notes ? `${notes} [Nested]` : '[Nested object]';
      }

      html += `      <tr data-field="${prop.name}"${prop.isNested ? ' class="expandable"' : ''}>\n`;
      html += `        <td class="field-name">${prop.name}${readOnlyMark}</td>\n`;
      html += `        <td class="field-type">${makeTypeClickable(prop.type)}</td>\n`;
      html += `        <td class="field-required">${reqMark}</td>\n`;
      html += `        <td class="field-notes">${escapeHtml(notes)}</td>\n`;
      html += `      </tr>\n`;
    }

    html += `    </tbody>\n`;
    html += `  </table>\n`;
    html += `</div>\n`;
  }

  return html;
}

/**
 * Generate relationships tab content
 */
function generateRelationshipsTab(schemaName, relationships, schemas) {
  const rels = relationships[schemaName];
  if (!rels) return '<p>No relationships found.</p>';

  let html = '';

  if (rels.extends.length > 0) {
    html += `<div class="rel-section">\n`;
    html += `  <h5>Extends</h5>\n`;
    html += `  <ul class="rel-list">\n`;
    for (const ext of rels.extends) {
      html += `    <li><a href="#${ext}">${ext}</a></li>\n`;
    }
    html += `  </ul>\n`;
    html += `</div>\n`;
  }

  if (rels.contains.length > 0) {
    html += `<div class="rel-section">\n`;
    html += `  <h5>Contains</h5>\n`;
    html += `  <ul class="rel-list">\n`;
    for (const cont of rels.contains) {
      const arrayIndicator = cont.isArray ? ' (array)' : '';
      html += `    <li><a href="#${cont.name}">${cont.name}</a> via <code>${cont.via}</code>${arrayIndicator}</li>\n`;
    }
    html += `  </ul>\n`;
    html += `</div>\n`;
  }

  if (rels.belongsTo.length > 0) {
    html += `<div class="rel-section">\n`;
    html += `  <h5>Belongs To</h5>\n`;
    html += `  <ul class="rel-list">\n`;
    for (const bel of rels.belongsTo) {
      html += `    <li><a href="#${bel.name}">${bel.name}</a> via <code>${bel.via}</code></li>\n`;
    }
    html += `  </ul>\n`;
    html += `</div>\n`;
  }

  if (rels.referencedBy.length > 0) {
    html += `<div class="rel-section">\n`;
    html += `  <h5>Referenced By</h5>\n`;
    html += `  <ul class="rel-list">\n`;
    for (const ref of rels.referencedBy) {
      html += `    <li><a href="#${ref.name}">${ref.name}</a> via <code>${ref.via}</code></li>\n`;
    }
    html += `  </ul>\n`;
    html += `</div>\n`;
  }

  if (html === '') {
    html = '<p class="no-rels">No relationships found for this object.</p>';
  }

  return html;
}

/**
 * Generate actions tab content
 */
function generateActionsTab(schemaName, operations, properties) {
  const ops = operations[schemaName];

  let html = '';

  if (ops && Object.keys(ops).length > 0) {
    html += `<table class="actions-table">\n`;
    html += `  <thead>\n`;
    html += `    <tr>\n`;
    html += `      <th>Action</th>\n`;
    html += `      <th>Method</th>\n`;
    html += `      <th>Path</th>\n`;
    html += `      <th>Notes</th>\n`;
    html += `    </tr>\n`;
    html += `  </thead>\n`;
    html += `  <tbody>\n`;

    const actionOrder = ['list', 'create', 'get', 'update', 'delete'];
    const actionLabels = {
      list: 'List',
      create: 'Create',
      get: 'Get',
      update: 'Update',
      delete: 'Delete',
    };
    const actionNotes = {
      list: 'Paginated, searchable',
      create: '',
      get: 'By ID',
      update: 'Partial updates',
      delete: 'Permanent',
    };

    for (const action of actionOrder) {
      if (ops[action]) {
        const op = ops[action];
        let notes = actionNotes[action] || '';
        if (action === 'create') {
          const reqFields = properties.filter(p => p.required && !p.readOnly).map(p => p.name);
          if (reqFields.length > 0) {
            notes = `Required: ${reqFields.slice(0, 3).join(', ')}${reqFields.length > 3 ? '...' : ''}`;
          }
        }

        html += `    <tr>\n`;
        html += `      <td class="action-name">${actionLabels[action]}</td>\n`;
        html += `      <td class="action-method method-${op.method.toLowerCase()}">${op.method}</td>\n`;
        html += `      <td class="action-path"><code>${op.path}</code></td>\n`;
        html += `      <td class="action-notes">${notes}</td>\n`;
        html += `    </tr>\n`;
      }
    }

    html += `  </tbody>\n`;
    html += `</table>\n`;
  } else {
    html += '<p class="no-actions">No CRUD operations defined for this object.</p>\n';
  }

  // Read-only fields section
  const readOnlyFields = properties.filter(p => p.readOnly);
  if (readOnlyFields.length > 0) {
    html += `<div class="read-only-section">\n`;
    html += `  <h5>Read-Only Fields</h5>\n`;
    html += `  <p>These fields are managed by the system and cannot be modified:</p>\n`;
    html += `  <ul class="read-only-list">\n`;
    for (const field of readOnlyFields) {
      html += `    <li><code>${field.name}</code> - ${field.type}</li>\n`;
    }
    html += `  </ul>\n`;
    html += `</div>\n`;
  }

  return html;
}
/**
 * Generate ORCA-structured HTML for a primary schema
 */
function generateOrcaSection(schemaName, schema, relationships, operations, stateSchemas, states, domainKey) {
  const { properties } = processSchema(schema, schemaName);
  const description = schema.description || '';
  const domain = DOMAIN_HIERARCHY[domainKey];

  let html = `<section id="${schemaName}" class="schema-section primary orca-section" data-domain="${domainKey}">\n`;
  html += `  <div class="section-header">\n`;
  if (domain) {
    html += `    <a href="#domain-${domainKey}" class="entity-domain-badge" style="--domain-color: ${domain.color}; --domain-bg: ${domain.bgColor};">${domain.name}</a>\n`;
  }
  html += `    <h2>${schemaName}</h2>\n`;
  html += `  </div>\n`;

  // ORCA Tabs
  html += `  <div class="orca-tabs">\n`;
  html += `    <button class="orca-tab active" data-tab="overview">Overview</button>\n`;
  html += `    <button class="orca-tab" data-tab="relationships">Relationships</button>\n`;
  html += `    <button class="orca-tab" data-tab="actions">Actions</button>\n`;
  html += `    <button class="orca-tab" data-tab="attributes">Attributes</button>\n`;
  html += `  </div>\n`;

  // Tab Panels
  html += `  <div class="orca-panels">\n`;

  // Overview Panel
  html += `    <div class="orca-panel active" data-tab="overview">\n`;
  html += `      <div class="overview-content">\n`;
  html += `        <h4>What is ${schemaName}?</h4>\n`;
  html += `        <p class="description">${escapeHtml(description)}</p>\n`;
  html += `        <h4>Key Characteristics</h4>\n`;
  html += `        <ul class="characteristics">\n`;
  html += `          <li><strong>Total fields:</strong> ${properties.length}</li>\n`;
  html += `          <li><strong>Required fields:</strong> ${properties.filter(p => p.required).length}</li>\n`;
  html += `          <li><strong>Read-only fields:</strong> ${properties.filter(p => p.readOnly).length}</li>\n`;
  html += `          <li><strong>Nested objects:</strong> ${properties.filter(p => p.isNested).length}</li>\n`;
  html += `        </ul>\n`;
  html += `      </div>\n`;
  html += `    </div>\n`;

  // Relationships Panel
  html += `    <div class="orca-panel" data-tab="relationships">\n`;
  html += generateRelationshipsTab(schemaName, relationships, {});
  html += `    </div>\n`;

  // Actions Panel
  html += `    <div class="orca-panel" data-tab="actions">\n`;
  html += generateActionsTab(schemaName, operations, properties);
  html += `    </div>\n`;

  // Attributes Panel - with state variants
  html += `    <div class="orca-panel" data-tab="attributes">\n`;
  html += generateAttributesWithStateVariants(schemaName, schema, stateSchemas, states);
  html += `    </div>\n`;

  html += `  </div>\n`; // End orca-panels
  html += `</section>\n\n`;

  return html;
}

/**
 * Generate simple section for non-primary schemas
 */
function generateSimpleSection(schemaName, schema, relationships, stateSchemas, states, domainKey) {
  let effectiveDomainKey = domainKey;
  let domain = DOMAIN_HIERARCHY[domainKey];
  const rels = relationships[schemaName] || {};

  // Find schemas that contain/reference this one
  const usedBy = [];
  for (const [otherSchema, otherRels] of Object.entries(relationships)) {
    if (otherSchema === schemaName) continue;
    for (const cont of otherRels.contains || []) {
      if (cont.name === schemaName) {
        usedBy.push({ schema: otherSchema, via: cont.via });
      }
    }
  }

  // If unclassified, inherit domain from parent schema(s)
  if (domainKey === 'unclassified' && usedBy.length > 0) {
    // Use the first parent's domain
    const { domain: parentDomainKey } = classifySchemaIntoDomain(usedBy[0].schema);
    if (parentDomainKey !== 'unclassified') {
      effectiveDomainKey = parentDomainKey;
      domain = DOMAIN_HIERARCHY[parentDomainKey];
    }
  }

  let html = `<section id="${schemaName}" class="schema-section" data-domain="${effectiveDomainKey}">\n`;
  html += `  <div class="section-header simple">\n`;
  if (domain) {
    html += `    <a href="#domain-${effectiveDomainKey}" class="entity-domain-badge" style="--domain-color: ${domain.color}; --domain-bg: ${domain.bgColor};">${domain.name}</a>\n`;
  }
  html += `    <h2>${schemaName}</h2>\n`;
  if (usedBy.length > 0) {
    html += `    <div class="used-by-links">`;
    html += `Used by: `;
    html += usedBy.map(u => `<a href="#${u.schema}">${u.schema}</a><code>.${u.via}</code>`).join(', ');
    html += `</div>\n`;
  }
  html += `  </div>\n`;
  html += `  <p class="description">${escapeHtml(schema.description || '')}</p>\n`;
  html += generateAttributesWithStateVariants(schemaName, schema, stateSchemas, states);
  html += `</section>\n\n`;

  return html;
}

/**
 * Generate a section for an inline nested object
 */
function generateInlineObjectSection(inlineName, inlineInfo) {
  const { schema, parentSchema, propName } = inlineInfo;

  // Inherit domain from parent schema
  const { domain: domainKey } = classifySchemaIntoDomain(parentSchema);
  const domain = DOMAIN_HIERARCHY[domainKey];

  let html = `<section id="${inlineName}" class="schema-section inline-object" data-domain="${domainKey}">\n`;
  html += `  <div class="section-header simple">\n`;
  if (domain) {
    html += `    <a href="#domain-${domainKey}" class="entity-domain-badge" style="--domain-color: ${domain.color}; --domain-bg: ${domain.bgColor};">${domain.name}</a>\n`;
  }
  html += `    <span class="inline-object-badge">Nested in <a href="#${parentSchema}">${parentSchema}</a></span>\n`;
  html += `    <h2>${inlineName}</h2>\n`;
  html += `  </div>\n`;
  html += `  <p class="description">${escapeHtml(schema.description || `Nested object within ${parentSchema}.${propName}`)}</p>\n`;

  // Generate property table for this inline object
  const { properties } = processSchema(schema, inlineName);
  if (properties.length > 0) {
    const grouped = groupPropertiesByDomain(properties);
    html += generateDomainGroupedTables(grouped);
  }

  html += `</section>\n\n`;
  return html;
}

/**
 * Generate attributes content with state variants
 * Each state's content is wrapped in a div with data-state-content attribute
 */
function generateAttributesWithStateVariants(schemaName, baseSchema, stateSchemas, states) {
  let html = '';

  // Generate base content (always visible by default)
  const { properties: baseProps } = processSchema(baseSchema, schemaName);
  const baseGrouped = groupPropertiesByDomain(baseProps);

  html += `<div class="attributes-content" data-state-content="base">\n`;
  html += generateDomainGroupedTables(baseGrouped);
  html += `</div>\n`;

  // Generate state-specific content
  for (const state of states) {
    const stateSchema = stateSchemas[state.state]?.[schemaName];
    if (!stateSchema) continue;

    const diffs = findDifferences(baseSchema, stateSchema, schemaName);
    const hasChanges = diffs.added.length > 0 || diffs.modified.length > 0;

    // Always process with state schemas to pick up state-specific enum values for referenced schemas
    // (e.g., Program enum values differ by state even when HouseholdMember structure is the same)
    const { properties: stateProps } = processSchema(stateSchema, schemaName, stateSchemas[state.state]);

    // Mark state-specific (added) fields
    if (hasChanges) {
      const stateFieldNames = new Set(diffs.added.map(p => p.name));
      for (const prop of stateProps) {
        if (stateFieldNames.has(prop.name)) {
          prop.isStateSpecific = true;
          prop.stateName = state.state;
        }
      }
    }

    const stateGrouped = groupPropertiesByDomain(stateProps);

    html += `<div class="attributes-content" data-state-content="${state.state}" style="display: none;">\n`;
    if (hasChanges) {
      html += generateDomainGroupedTablesWithStateMarkers(stateGrouped, state.state);
    } else {
      html += generateDomainGroupedTables(stateGrouped);
    }
    html += `</div>\n`;
  }

  return html;
}

/**
 * Generate domain-grouped tables with state-specific field markers
 */
function generateDomainGroupedTablesWithStateMarkers(groupedProps, stateName) {
  let html = '';

  for (const [domain, props] of Object.entries(groupedProps)) {
    const config = getDomainConfig(domain);

    html += `<div class="domain-group" style="--domain-color: ${config.color}; --domain-bg: ${config.bgColor};">\n`;
    html += `  <h5 class="domain-header"><span class="domain-indicator"></span>${config.name}</h5>\n`;
    html += `  <table class="property-table">\n`;
    html += `    <thead>\n`;
    html += `      <tr>\n`;
    html += `        <th>Field</th>\n`;
    html += `        <th>Type</th>\n`;
    html += `        <th>Req</th>\n`;
    html += `        <th>Notes</th>\n`;
    html += `      </tr>\n`;
    html += `    </thead>\n`;
    html += `    <tbody>\n`;

    for (const prop of props) {
      const reqMark = prop.required ? '&#10003;' : '';
      const readOnlyMark = prop.readOnly ? ' <span class="read-only-badge">read-only</span>' : '';
      const stateMarker = prop.isStateSpecific ? ` data-state-field="${stateName}"` : '';
      const stateClass = prop.isStateSpecific ? ' state-added-field' : '';

      let notes = prop.description || '';
      if (prop.enumValues) {
        notes = `Options: ${prop.enumValues}`;
      }
      if (prop.isNested) {
        notes = notes ? `${notes} [Nested]` : '[Nested object]';
      }

      html += `      <tr data-field="${prop.name}"${stateMarker} class="${prop.isNested ? 'expandable' : ''}${stateClass}">\n`;
      html += `        <td class="field-name">${prop.name}${readOnlyMark}</td>\n`;
      html += `        <td class="field-type">${makeTypeClickable(prop.type)}</td>\n`;
      html += `        <td class="field-required">${reqMark}</td>\n`;
      html += `        <td class="field-notes">${escapeHtml(notes)}</td>\n`;
      html += `      </tr>\n`;
    }

    html += `    </tbody>\n`;
    html += `  </table>\n`;
    html += `</div>\n`;
  }

  return html;
}

/**
 * Classify a schema into its high-level domain
 */
function classifySchemaIntoDomain(schemaName) {
  // Check main domains
  for (const [domainKey, domain] of Object.entries(DOMAIN_HIERARCHY)) {
    if (domain.schemas?.includes(schemaName)) {
      return { domain: domainKey, subdomain: null };
    }
    // Check subdomains
    if (domain.subdomains) {
      for (const [subKey, sub] of Object.entries(domain.subdomains)) {
        if (sub.schemas?.includes(schemaName)) {
          return { domain: domainKey, subdomain: subKey };
        }
      }
    }
  }
  return { domain: 'unclassified', subdomain: null };
}

/**
 * Group schemas by high-level domain
 */
function groupSchemasByDomain(schemas) {
  const grouped = {};

  // Initialize all domains (even empty ones)
  for (const [domainKey, domain] of Object.entries(DOMAIN_HIERARCHY)) {
    if (domain.subdomains) {
      grouped[domainKey] = { subdomains: {} };
      for (const subKey of Object.keys(domain.subdomains)) {
        grouped[domainKey].subdomains[subKey] = [];
      }
    } else {
      grouped[domainKey] = [];
    }
  }
  grouped.unclassified = [];

  // Classify each schema
  for (const schemaName of Object.keys(schemas)) {
    const { domain, subdomain } = classifySchemaIntoDomain(schemaName);

    if (subdomain && grouped[domain]?.subdomains) {
      grouped[domain].subdomains[subdomain].push(schemaName);
    } else if (Array.isArray(grouped[domain])) {
      grouped[domain].push(schemaName);
    } else {
      grouped.unclassified.push(schemaName);
    }
  }

  // Sort schemas within each domain
  for (const [domainKey, content] of Object.entries(grouped)) {
    if (Array.isArray(content)) {
      content.sort((a, b) => {
        const aIsPrimary = PRIMARY_SCHEMAS.includes(a);
        const bIsPrimary = PRIMARY_SCHEMAS.includes(b);
        if (aIsPrimary && !bIsPrimary) return -1;
        if (!aIsPrimary && bIsPrimary) return 1;
        return a.localeCompare(b);
      });
    } else if (content.subdomains) {
      for (const arr of Object.values(content.subdomains)) {
        arr.sort();
      }
    }
  }

  return grouped;
}

/**
 * Generate domain overview page content
 */
function generateDomainOverview(domainKey, domain, schemas, relationships) {
  const domainSchemas = Array.isArray(schemas) ? schemas : [];
  const hasSchemas = domainSchemas.length > 0;

  let html = `<section id="domain-${domainKey}" class="domain-overview-section">\n`;
  html += `  <div class="domain-overview-header" style="--domain-color: ${domain.color}; --domain-bg: ${domain.bgColor};">\n`;
  html += `    <div class="domain-title-row">\n`;
  html += `      <span class="domain-indicator"></span>\n`;
  html += `      <h2>${domain.name} Domain</h2>\n`;
  html += `    </div>\n`;
  html += `    <p class="domain-description">${escapeHtml(domain.description)}</p>\n`;
  html += `  </div>\n`;

  if (!hasSchemas) {
    html += `  <div class="coming-soon-notice">\n`;
    html += `    <h4>Coming Soon</h4>\n`;
    html += `    <p>This domain is part of the architectural vision but hasn't been implemented yet in the OpenAPI specifications.</p>\n`;
    html += `  </div>\n`;
  } else {
    // Entity list
    html += `  <div class="domain-entities-section">\n`;
    html += `    <h3>Entities in this domain</h3>\n`;
    html += `    <div class="entity-grid">\n`;

    for (const schemaName of domainSchemas) {
      const isPrimary = PRIMARY_SCHEMAS.includes(schemaName);
      html += `      <a href="#${schemaName}" class="entity-card${isPrimary ? ' primary' : ''}">\n`;
      html += `        <span class="entity-name">${schemaName}</span>\n`;
      if (isPrimary) {
        html += `        <span class="entity-badge">Primary</span>\n`;
      }
      html += `      </a>\n`;
    }

    html += `    </div>\n`;
    html += `  </div>\n`;

    // Cross-domain relationships
    const crossDomainRels = findCrossDomainRelationships(domainKey, domainSchemas, relationships);
    if (crossDomainRels.length > 0) {
      html += `  <div class="cross-domain-section">\n`;
      html += `    <h3>Cross-domain relationships</h3>\n`;
      html += `    <ul class="cross-domain-list">\n`;
      for (const rel of crossDomainRels) {
        html += `      <li>${rel.direction} <strong>${rel.targetDomain}</strong> (${rel.description})</li>\n`;
      }
      html += `    </ul>\n`;
      html += `  </div>\n`;
    }
  }

  html += `</section>\n\n`;
  return html;
}

/**
 * Find relationships that cross domain boundaries
 */
function findCrossDomainRelationships(domainKey, domainSchemas, relationships) {
  const crossRels = [];
  const domainSchemaSet = new Set(domainSchemas);

  for (const schemaName of domainSchemas) {
    const rels = relationships[schemaName];
    if (!rels) continue;

    // Check contains
    for (const cont of rels.contains || []) {
      const { domain: targetDomain } = classifySchemaIntoDomain(cont.name);
      if (targetDomain !== domainKey && targetDomain !== 'unclassified') {
        const targetDomainConfig = DOMAIN_HIERARCHY[targetDomain];
        if (targetDomainConfig) {
          crossRels.push({
            direction: 'Contains →',
            targetDomain: targetDomainConfig.name,
            description: `${schemaName} contains ${cont.name}`
          });
        }
      }
    }

    // Check belongsTo
    for (const bel of rels.belongsTo || []) {
      const { domain: targetDomain } = classifySchemaIntoDomain(bel.name);
      if (targetDomain !== domainKey && targetDomain !== 'unclassified') {
        const targetDomainConfig = DOMAIN_HIERARCHY[targetDomain];
        if (targetDomainConfig) {
          crossRels.push({
            direction: 'References →',
            targetDomain: targetDomainConfig.name,
            description: `${schemaName} references ${bel.name}`
          });
        }
      }
    }
  }

  // Deduplicate by targetDomain
  const seen = new Set();
  return crossRels.filter(rel => {
    const key = `${rel.direction}-${rel.targetDomain}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Generate hierarchical sidebar HTML
 */
function generateHierarchicalSidebar(schemasByDomain, schemas, stateSchemas, states) {
  let html = '';

  const domainOrder = ['intake', 'clientManagement', 'eligibility', 'caseManagement',
                       'workflow', 'scheduling', 'documentManagement', 'crossCutting'];

  for (const domainKey of domainOrder) {
    const domain = DOMAIN_HIERARCHY[domainKey];
    if (!domain) continue;

    const domainSchemas = schemasByDomain[domainKey];
    const schemaList = Array.isArray(domainSchemas) ? domainSchemas :
                       (domainSchemas?.subdomains ? Object.values(domainSchemas.subdomains).flat() : []);
    const schemaCount = schemaList.length;

    html += `    <div class="sidebar-domain" data-domain="${domainKey}" style="--domain-color: ${domain.color};">\n`;
    html += `      <div class="sidebar-domain-header">\n`;
    html += `        <span class="sidebar-domain-indicator"></span>\n`;
    html += `        <a href="#domain-${domainKey}" class="sidebar-domain-name">${domain.name}</a>\n`;
    if (schemaCount > 0) {
      html += `        <span class="sidebar-domain-count">${schemaCount}</span>\n`;
      html += `        <span class="sidebar-domain-toggle">▶</span>\n`;
    }
    html += `      </div>\n`;

    if (schemaCount > 0) {
      html += `      <div class="sidebar-domain-entities" style="display: none;">\n`;

      // Handle subdomains (for cross-cutting)
      if (domainSchemas?.subdomains) {
        for (const [subKey, subSchemas] of Object.entries(domainSchemas.subdomains)) {
          if (subSchemas.length === 0) continue;
          const subConfig = domain.subdomains[subKey];
          html += `        <div class="sidebar-subdomain">\n`;
          html += `          <span class="sidebar-subdomain-name">${subConfig.name}</span>\n`;
          for (const schemaName of subSchemas) {
            const isPrimary = PRIMARY_SCHEMAS.includes(schemaName);
            const hasVariations = checkForVariations(schemaName, schemas, stateSchemas, states);
            html += `          <a href="#${schemaName}" class="${isPrimary ? 'primary' : 'secondary'}${hasVariations ? ' has-variations' : ''}">${schemaName}${hasVariations ? ' *' : ''}</a>\n`;
          }
          html += `        </div>\n`;
        }
      } else {
        // Regular domain with flat schema list
        for (const schemaName of schemaList) {
          const isPrimary = PRIMARY_SCHEMAS.includes(schemaName);
          const hasVariations = checkForVariations(schemaName, schemas, stateSchemas, states);
          html += `        <a href="#${schemaName}" class="${isPrimary ? 'primary' : 'secondary'}${hasVariations ? ' has-variations' : ''}">${schemaName}${hasVariations ? ' *' : ''}</a>\n`;
        }
      }

      html += `      </div>\n`;
    }

    html += `    </div>\n`;
  }

  // Note: Unclassified schemas are not shown in sidebar - they're accessible via links from other schemas

  return html;
}

/**
 * Check if a schema has state variations
 */
function checkForVariations(schemaName, schemas, stateSchemas, states) {
  const baseSchema = schemas[schemaName];
  if (!baseSchema) return false;

  for (const state of states) {
    const stateSchema = stateSchemas[state.state]?.[schemaName];
    if (stateSchema) {
      const diffs = findDifferences(baseSchema, stateSchema, schemaName);
      if (diffs.added.length > 0 || diffs.modified.length > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Generate the full HTML document
 */
function generateHtml(schemas, stateSchemas, states, relationships, operations) {
  let contentHtml = '';

  // Group schemas by high-level domain
  const schemasByDomain = groupSchemasByDomain(schemas);

  // Generate hierarchical sidebar
  const sidebarHtml = generateHierarchicalSidebar(schemasByDomain, schemas, stateSchemas, states);

  // Build search index of all fields
  const searchIndex = [];
  for (const [schemaName, schema] of Object.entries(schemas)) {
    const { properties } = processSchema(schema, schemaName);
    const { domain: domainKey } = classifySchemaIntoDomain(schemaName);
    const domainInfo = DOMAIN_HIERARCHY[domainKey];
    const domainName = domainInfo?.name || 'Other';

    for (const prop of properties) {
      searchIndex.push({
        field: prop.name,
        schema: schemaName,
        type: prop.type,
        domain: domainName,
        description: prop.description || ''
      });
    }
  }

  // Domain order for organizing schema sections
  const domainOrder = ['intake', 'clientManagement', 'eligibility', 'caseManagement',
                       'workflow', 'scheduling', 'documentManagement', 'crossCutting'];

  // Generate entity detail sections (grouped by domain)
  for (const domainKey of domainOrder) {
    const domain = DOMAIN_HIERARCHY[domainKey];
    const domainSchemaList = schemasByDomain[domainKey];
    const schemaList = Array.isArray(domainSchemaList) ? domainSchemaList :
                       (domainSchemaList?.subdomains ? Object.values(domainSchemaList.subdomains).flat() : []);

    // Add domain header for all domains (with entity list or "coming soon")
    if (domain) {
      contentHtml += `<div id="domain-${domainKey}" class="domain-header-anchor" style="--domain-color: ${domain.color}; --domain-bg: ${domain.bgColor};">\n`;
      contentHtml += `  <h2 class="domain-header-title"><span class="domain-indicator"></span>${domain.name}</h2>\n`;
      contentHtml += `  <p class="domain-description">${domain.description}</p>\n`;

      if (schemaList.length > 0) {
        contentHtml += `  <div class="domain-entity-list">\n`;

        // Primary schemas first
        const primarySchemas = schemaList.filter(s => PRIMARY_SCHEMAS.includes(s));
        const otherSchemas = schemaList.filter(s => !PRIMARY_SCHEMAS.includes(s));

        for (const schemaName of primarySchemas) {
          contentHtml += `    <a href="#${schemaName}" class="domain-entity-link primary">${schemaName}</a>\n`;
        }
        for (const schemaName of otherSchemas) {
          contentHtml += `    <a href="#${schemaName}" class="domain-entity-link">${schemaName}</a>\n`;
        }

        contentHtml += `  </div>\n`;
      } else {
        contentHtml += `  <p class="domain-coming-soon">Coming soon - this domain is part of the architecture but not yet implemented.</p>\n`;
      }

      contentHtml += `</div>\n`;
    }

    for (const schemaName of schemaList) {
      const schema = schemas[schemaName];
      if (!schema) continue;

      const isPrimary = PRIMARY_SCHEMAS.includes(schemaName);
      const { domain: schemaDomain } = classifySchemaIntoDomain(schemaName);

      if (isPrimary) {
        contentHtml += generateOrcaSection(schemaName, schema, relationships, operations, stateSchemas, states, schemaDomain);
      } else {
        contentHtml += generateSimpleSection(schemaName, schema, relationships, stateSchemas, states, schemaDomain);
      }
    }
  }

  // Generate unclassified schemas
  for (const schemaName of schemasByDomain.unclassified || []) {
    const schema = schemas[schemaName];
    if (!schema) continue;

    const isPrimary = PRIMARY_SCHEMAS.includes(schemaName);
    if (isPrimary) {
      contentHtml += generateOrcaSection(schemaName, schema, relationships, operations, stateSchemas, states, 'unclassified');
    } else {
      contentHtml += generateSimpleSection(schemaName, schema, relationships, stateSchemas, states, 'unclassified');
    }
  }

  // Generate sections for inline nested objects
  for (const [inlineName, inlineInfo] of inlineObjectSchemas) {
    contentHtml += generateInlineObjectSection(inlineName, inlineInfo);
  }

  const stateListHtml = states.map(s => `<span class="state-badge">${s.name}</span>`).join(' ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Safety Net API - ORCA Design Reference</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
    }

    .container {
      display: flex;
      min-height: 100vh;
    }

    /* Sidebar */
    .sidebar {
      width: 260px;
      background: #2c3e50;
      color: white;
      position: fixed;
      height: 100vh;
      display: flex;
      flex-direction: column;
      z-index: 100;
    }

    .sidebar-header {
      padding: 20px 20px 0 20px;
      flex-shrink: 0;
    }

    .sidebar-nav {
      flex: 1;
      overflow-y: auto;
      padding: 0 20px 20px 20px;
    }

    .sidebar h1 {
      font-size: 1.2rem;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid #456;
    }

    .sidebar-title {
      text-decoration: none;
      color: inherit;
    }

    .sidebar-title:hover h1 {
      color: #8ab4f8;
    }

    .intro-section {
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      border-radius: 12px;
      padding: 2rem;
      margin-bottom: 2rem;
      border: 1px solid #dee2e6;
    }

    .intro-section h1 {
      font-size: 1.8rem;
      color: #2c3e50;
      margin-bottom: 1rem;
    }

    .intro-description {
      font-size: 1.1rem;
      line-height: 1.6;
      color: #495057;
      margin-bottom: 1.5rem;
    }

    .intro-domains h3 {
      font-size: 1.1rem;
      color: #2c3e50;
      margin-bottom: 0.5rem;
    }

    .intro-domains p {
      color: #6c757d;
      margin-bottom: 0.75rem;
    }

    .intro-domains ul {
      list-style: none;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 0.75rem;
    }

    .intro-domains li {
      background: white;
      padding: 0;
      border-radius: 8px;
      border-left: 4px solid #3498db;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      transition: transform 0.15s, box-shadow 0.15s;
    }

    .intro-domains li:hover {
      transform: translateY(-2px);
      box-shadow: 0 3px 8px rgba(0,0,0,0.15);
    }

    .intro-domains li a {
      display: block;
      padding: 0.75rem 1rem;
      text-decoration: none;
      color: inherit;
    }

    .intro-domains li:nth-child(1) { border-left-color: #3498db; } /* Intake */
    .intro-domains li:nth-child(2) { border-left-color: #27ae60; } /* Client Management */
    .intro-domains li:nth-child(3) { border-left-color: #9b59b6; } /* Eligibility */
    .intro-domains li:nth-child(4) { border-left-color: #e67e22; } /* Case Management */
    .intro-domains li:nth-child(5) { border-left-color: #1abc9c; } /* Workflow */
    .intro-domains li:nth-child(6) { border-left-color: #f39c12; } /* Scheduling */
    .intro-domains li:nth-child(7) { border-left-color: #95a5a6; } /* Document Management */
    .intro-domains li:nth-child(8) { border-left-color: #7f8c8d; } /* Cross-cutting */

    .sidebar-state-selector {
      margin-bottom: 15px;
    }

    .sidebar-state-buttons {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .sidebar-state-buttons .state-selector-btn {
      padding: 6px 12px;
      font-size: 0.8rem;
      border: 1px solid #456;
      background: transparent;
      color: #bdc3c7;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .sidebar-state-buttons .state-selector-btn:hover {
      border-color: #3498db;
      color: #3498db;
    }

    .sidebar-state-buttons .state-selector-btn.active {
      background: #3498db;
      border-color: #3498db;
      color: white;
    }

    .search-container {
      position: relative;
      margin-bottom: 15px;
    }

    .sidebar input {
      width: 100%;
      padding: 8px;
      border: none;
      border-radius: 4px;
    }

    .search-results {
      position: absolute;
      top: 100%;
      left: 0;
      width: 400px;
      background: #fff;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      max-height: 400px;
      overflow-y: auto;
      z-index: 1000;
      display: none;
    }

    .search-results.visible {
      display: block;
    }

    .search-result-item {
      padding: 10px 12px;
      cursor: pointer;
      border-bottom: 1px solid #eee;
      color: #333;
    }

    .search-result-item:last-child {
      border-bottom: none;
    }

    .search-result-item:hover {
      background: #f0f7ff;
    }

    .search-result-field {
      font-weight: 600;
      color: #2c3e50;
    }

    .search-result-schema {
      font-size: 0.85em;
      color: #7f8c8d;
      margin-left: 8px;
    }

    .search-result-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 4px;
    }

    .search-result-type {
      font-size: 0.8em;
      color: #3498db;
    }

    .search-result-domain {
      font-size: 0.75em;
      color: #fff;
      background: #7f8c8d;
      padding: 2px 6px;
      border-radius: 3px;
    }

    .search-no-results {
      padding: 12px;
      color: #7f8c8d;
      text-align: center;
      font-style: italic;
    }

    .field-highlight {
      background: #fff3cd !important;
      animation: highlight-fade 2s ease-out forwards;
    }

    @keyframes highlight-fade {
      0% { background: #fff3cd; }
      100% { background: transparent; }
    }

    .sidebar nav {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .sidebar a {
      color: #bdc3c7;
      text-decoration: none;
      padding: 6px 10px;
      border-radius: 4px;
      transition: all 0.2s;
    }

    .sidebar a:hover {
      background: #34495e;
      color: white;
    }

    .sidebar a.primary {
      color: white;
      font-weight: 600;
    }

    .sidebar a.secondary {
      font-size: 0.9rem;
      padding-left: 20px;
    }

    .sidebar a.has-variations {
      border-left: 3px solid #f39c12;
      padding-left: 7px;
    }

    /* Hierarchical sidebar domains */
    .sidebar-domain {
      margin-bottom: 8px;
    }

    .sidebar-domain-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .sidebar-domain-header:hover {
      background: #34495e;
    }

    .sidebar-domain-indicator {
      width: 10px;
      height: 10px;
      background: var(--domain-color);
      border-radius: 2px;
      flex-shrink: 0;
    }

    .sidebar-domain-name {
      flex: 1;
      color: #ecf0f1;
      font-weight: 600;
      font-size: 0.9rem;
      text-decoration: none;
    }

    .sidebar-domain-name:hover {
      color: white;
    }

    .sidebar-domain-count {
      background: rgba(255,255,255,0.2);
      color: #bdc3c7;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.75rem;
    }

    .sidebar-domain-toggle {
      color: #7f8c8d;
      font-size: 0.7rem;
      transition: transform 0.2s;
    }

    .sidebar-domain.expanded .sidebar-domain-toggle {
      transform: rotate(90deg);
    }

    .sidebar-domain-entities {
      padding-left: 18px;
      margin-top: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .sidebar-domain-entities a {
      padding: 5px 10px;
      font-size: 0.85rem;
    }

    .sidebar-subdomain {
      margin-top: 8px;
    }

    .sidebar-subdomain-name {
      display: block;
      color: #7f8c8d;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 4px 10px;
      margin-bottom: 4px;
    }

    /* Main content */
    .main {
      flex: 1;
      margin-left: 260px;
      padding: 30px 40px;
    }

    /* Relationship Diagram */
    .relationship-diagram-container {
      background: white;
      border-radius: 8px;
      padding: 25px;
      margin-bottom: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .relationship-diagram-container h3 {
      margin-bottom: 20px;
      color: #2c3e50;
    }

    .relationship-diagram {
      width: 100%;
      max-width: 800px;
      height: auto;
    }

    /* Domain Overview Sections */
    .domain-overview-section {
      background: white;
      border-radius: 8px;
      margin-bottom: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    .domain-overview-header {
      background: var(--domain-bg);
      border-left: 4px solid var(--domain-color);
      padding: 25px;
    }

    .domain-title-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }

    .domain-overview-header .domain-indicator {
      width: 16px;
      height: 16px;
      background: var(--domain-color);
      border-radius: 4px;
    }

    .domain-overview-header h2 {
      color: var(--domain-color);
      margin: 0;
      font-size: 1.5rem;
    }

    .domain-description {
      color: #555;
      margin: 0;
      font-size: 1.05rem;
    }

    .domain-entities-section {
      padding: 25px;
    }

    .domain-entities-section h3 {
      color: #2c3e50;
      margin-bottom: 15px;
      font-size: 1.1rem;
    }

    .entity-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
    }

    .entity-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: #f8f9fa;
      border-radius: 6px;
      text-decoration: none;
      color: #2c3e50;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .entity-card:hover {
      background: #ebf5fb;
      border-color: #3498db;
      transform: translateY(-2px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .entity-card.primary {
      background: #ebf5fb;
      border-color: #3498db;
    }

    .entity-name {
      font-weight: 500;
    }

    .entity-badge {
      background: #3498db;
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 600;
    }

    .cross-domain-section {
      padding: 0 25px 25px;
    }

    .cross-domain-section h3 {
      color: #2c3e50;
      margin-bottom: 12px;
      font-size: 1.1rem;
    }

    .cross-domain-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .cross-domain-list li {
      padding: 8px 12px;
      background: #f8f9fa;
      border-radius: 4px;
      margin-bottom: 6px;
      color: #555;
    }

    .cross-domain-list strong {
      color: #2c3e50;
    }

    .coming-soon-notice {
      padding: 30px 25px;
      text-align: center;
      color: #7f8c8d;
    }

    .coming-soon-notice h4 {
      color: #95a5a6;
      margin-bottom: 10px;
    }

    /* Entity domain badge */
    .entity-domain-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      background: var(--domain-bg);
      color: var(--domain-color);
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s;
    }

    .entity-domain-badge:hover {
      filter: brightness(0.95);
    }

    /* Inline object badge */
    .inline-object-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 12px;
      background: #f0f0f0;
      color: #666;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 500;
    }

    .schema-section.inline-object {
      border-left: 3px solid #ddd;
      margin-left: 20px;
    }

    .section-header.simple {
      margin-bottom: 10px;
    }

    .used-by-links {
      font-size: 0.85rem;
      color: #7f8c8d;
      margin-top: 4px;
    }

    .used-by-links a {
      color: #3498db;
      text-decoration: none;
    }

    .used-by-links a:hover {
      text-decoration: underline;
    }

    .used-by-links code {
      font-size: 0.85em;
      color: #95a5a6;
      background: none;
      padding: 0;
    }

    /* Domain header anchors */
    .domain-header-anchor {
      margin-bottom: 25px;
      padding: 20px;
      background: var(--domain-bg);
      border-left: 4px solid var(--domain-color);
      border-radius: 0 8px 8px 0;
    }

    .domain-header-title {
      margin: 0 0 8px 0;
      font-size: 1.4rem;
      color: var(--domain-color);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .domain-header-title .domain-indicator {
      width: 12px;
      height: 12px;
      background: var(--domain-color);
      border-radius: 3px;
    }

    .domain-header-anchor .domain-description {
      color: #666;
      margin: 0 0 15px 0;
      font-size: 0.95rem;
    }

    .domain-entity-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .domain-entity-link {
      padding: 6px 12px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      color: #333;
      text-decoration: none;
      font-size: 0.9rem;
      transition: all 0.2s;
    }

    .domain-entity-link:hover {
      border-color: var(--domain-color);
      color: var(--domain-color);
    }

    .domain-entity-link.primary {
      font-weight: 600;
      border-color: var(--domain-color);
      background: white;
    }

    .domain-coming-soon {
      color: #7f8c8d;
      font-style: italic;
      margin: 0;
    }

    /* Schema sections */
    .schema-section {
      background: white;
      border-radius: 8px;
      padding: 25px;
      margin-bottom: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .schema-section.primary {
      border-left: 4px solid #3498db;
    }

    .schema-section h2 {
      color: #2c3e50;
      margin-bottom: 10px;
      font-size: 1.5rem;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 15px;
      margin-bottom: 15px;
    }

    .section-header h2 {
      margin-bottom: 0;
    }

    .variation-badge {
      font-size: 0.7rem;
      background: #f39c12;
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: normal;
    }

    .schema-section .description {
      color: #666;
      margin-bottom: 20px;
    }

    /* ORCA Tabs */
    .orca-tabs {
      display: flex;
      gap: 5px;
      border-bottom: 2px solid #ecf0f1;
      margin-bottom: 20px;
    }

    .orca-tab {
      padding: 10px 20px;
      border: none;
      background: #ecf0f1;
      color: #7f8c8d;
      border-radius: 4px 4px 0 0;
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: 500;
      transition: all 0.2s;
    }

    .orca-tab:hover {
      background: #bdc3c7;
      color: #2c3e50;
    }

    .orca-tab.active {
      background: #3498db;
      color: white;
    }

    .orca-panel {
      display: none;
    }

    .orca-panel.active {
      display: block;
    }

    /* Overview panel */
    .overview-content h4 {
      color: #2c3e50;
      margin: 15px 0 10px;
    }

    .overview-content h4:first-child {
      margin-top: 0;
    }

    .characteristics {
      list-style: none;
      padding: 0;
    }

    .characteristics li {
      padding: 5px 0;
      border-bottom: 1px solid #ecf0f1;
    }

    /* Relationships panel */
    .rel-section {
      margin-bottom: 20px;
    }

    .rel-section h5 {
      color: #2c3e50;
      margin-bottom: 10px;
      font-size: 1rem;
    }

    .rel-list {
      list-style: none;
      padding: 0;
    }

    .rel-list li {
      padding: 8px 12px;
      background: #f8f9fa;
      border-radius: 4px;
      margin-bottom: 5px;
    }

    .rel-list a {
      color: #3498db;
      text-decoration: none;
    }

    .rel-list a:hover {
      text-decoration: underline;
    }

    .rel-list code {
      background: #ecf0f1;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.85rem;
    }

    .no-rels {
      color: #95a5a6;
      font-style: italic;
    }

    /* Actions panel */
    .actions-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }

    .actions-table th {
      text-align: left;
      padding: 12px;
      background: #ecf0f1;
      border-bottom: 2px solid #bdc3c7;
      font-weight: 600;
      color: #2c3e50;
    }

    .actions-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #ecf0f1;
    }

    .action-name {
      font-weight: 500;
    }

    .action-method {
      font-family: monospace;
      font-weight: bold;
      padding: 3px 8px;
      border-radius: 3px;
    }

    .method-get { background: #d4edda; color: #155724; }
    .method-post { background: #cce5ff; color: #004085; }
    .method-patch, .method-put { background: #fff3cd; color: #856404; }
    .method-delete { background: #f8d7da; color: #721c24; }

    .action-path code {
      background: #f8f9fa;
      padding: 3px 8px;
      border-radius: 3px;
    }

    .action-notes {
      color: #7f8c8d;
      font-size: 0.9rem;
    }

    .no-actions {
      color: #95a5a6;
      font-style: italic;
    }

    .read-only-section {
      margin-top: 25px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 8px;
    }

    .read-only-section h5 {
      color: #2c3e50;
      margin-bottom: 10px;
    }

    .read-only-list {
      list-style: none;
      padding: 0;
      margin-top: 10px;
    }

    .read-only-list li {
      padding: 5px 0;
    }

    .read-only-list code {
      background: #ecf0f1;
      padding: 2px 6px;
      border-radius: 3px;
    }

    /* Domain groups */
    .domain-group {
      margin-bottom: 25px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--domain-color, #ddd);
    }

    .domain-header {
      background: var(--domain-bg, #f5f5f5);
      color: var(--domain-color, #333);
      padding: 10px 15px;
      font-size: 0.95rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .domain-indicator {
      width: 12px;
      height: 12px;
      background: var(--domain-color, #666);
      border-radius: 3px;
    }

    .domain-group .property-table {
      margin: 0;
      border-radius: 0;
    }

    /* Tables */
    .property-table {
      width: 100%;
      border-collapse: collapse;
    }

    .property-table th {
      text-align: left;
      padding: 12px;
      background: #f8f9fa;
      border-bottom: 2px solid #ecf0f1;
      font-weight: 600;
      color: #2c3e50;
    }

    .property-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #ecf0f1;
    }

    .property-table tr:hover {
      background: #f9f9f9;
    }

    .field-name {
      font-family: 'Monaco', 'Consolas', monospace;
      font-size: 0.9rem;
      color: #2980b9;
    }

    .field-type {
      color: #27ae60;
      font-weight: 500;
    }

    .type-link {
      color: #27ae60;
      text-decoration: none;
    }

    .type-link:hover {
      text-decoration: underline;
    }

    .field-required {
      color: #e74c3c;
      text-align: center;
      font-weight: bold;
    }

    .field-notes {
      color: #7f8c8d;
      font-size: 0.9rem;
    }

    .read-only-badge {
      font-size: 0.7rem;
      background: #95a5a6;
      color: white;
      padding: 1px 5px;
      border-radius: 3px;
      margin-left: 5px;
    }


    .base-enum {
      color: #95a5a6;
    }

    .state-enum {
      color: #27ae60;
    }

    /* Legend */
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
      margin-bottom: 25px;
      padding: 15px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
    }

    .legend-item .badge {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 500;
    }

    .badge.type { background: #d5f5e3; color: #27ae60; }
    .badge.required { background: #fadbd8; color: #e74c3c; }
    .badge.link { background: #d4e6f1; color: #2980b9; }
    .badge.state-var { background: #fef5e7; color: #e67e22; }

    .state-badge {
      display: inline-block;
      background: #34495e;
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      margin: 2px;
    }

    .hidden {
      display: none;
    }

    /* Domain color legend */
    .domain-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 25px;
      padding: 15px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .domain-legend h4 {
      width: 100%;
      margin-bottom: 10px;
      color: #2c3e50;
    }

    .domain-legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
    }

    .domain-legend-item .swatch {
      width: 16px;
      height: 16px;
      border-radius: 3px;
    }

    /* Diagram hint */
    .diagram-hint {
      color: #7f8c8d;
      font-size: 0.85rem;
      margin-bottom: 15px;
    }

    /* Domain Browser */
    .domain-browser {
      background: white;
      border-radius: 8px;
      padding: 25px;
      margin-bottom: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .domain-browser h3 {
      color: #2c3e50;
      margin-bottom: 10px;
    }

    .domain-browser-intro {
      color: #7f8c8d;
      font-size: 0.9rem;
      margin-bottom: 20px;
    }

    .domain-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 15px;
    }

    .domain-card {
      border: 2px solid var(--domain-color);
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.2s;
    }

    .domain-card:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transform: translateY(-2px);
    }

    .domain-card.expanded {
      grid-column: span 2;
    }

    .domain-card-header {
      background: var(--domain-bg);
      padding: 12px 15px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .domain-card-indicator {
      width: 12px;
      height: 12px;
      background: var(--domain-color);
      border-radius: 3px;
    }

    .domain-card-name {
      flex: 1;
      font-weight: 600;
      color: var(--domain-color);
    }

    .domain-card-count {
      background: var(--domain-color);
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.8rem;
    }

    .domain-card-schemas {
      padding: 15px;
      background: white;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .domain-schema-link {
      display: inline-block;
      padding: 4px 10px;
      background: #f8f9fa;
      border-radius: 4px;
      color: #2980b9;
      text-decoration: none;
      font-size: 0.85rem;
      transition: all 0.2s;
    }

    .domain-schema-link:hover {
      background: #3498db;
      color: white;
    }

    .domain-schema-link.primary {
      font-weight: 600;
      background: #ebf5fb;
    }

    /* Global State Selector */
    .state-selector {
      background: white;
      border-radius: 8px;
      padding: 20px 25px;
      margin-bottom: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      display: flex;
      align-items: center;
      gap: 20px;
    }

    .state-selector-label {
      font-weight: 600;
      color: #2c3e50;
    }

    .state-selector-buttons {
      display: flex;
      gap: 8px;
    }

    .state-selector-btn {
      padding: 8px 16px;
      border: 2px solid #ecf0f1;
      background: white;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 500;
      transition: all 0.2s;
    }

    .state-selector-btn:hover {
      border-color: #3498db;
      color: #3498db;
    }

    .state-selector-btn.active {
      background: #3498db;
      border-color: #3498db;
      color: white;
    }

    .state-selector-note {
      color: #7f8c8d;
      font-size: 0.85rem;
      margin-left: auto;
    }

    /* State-specific field highlighting */
    .state-added-field {
      background: #e8f8f0 !important;
    }

    .state-added-field td:first-child::after {
      content: ' (state-specific)';
      color: #27ae60;
      font-size: 0.75rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <aside class="sidebar">
      <div class="sidebar-header">
        <a href="#orca-intro" class="sidebar-title"><h1>ORCA Design Reference</h1></a>
        <div class="sidebar-state-selector">
          <div class="sidebar-state-buttons">
            <button class="state-selector-btn active" data-state="base">Base</button>
            ${states.map(s => `<button class="state-selector-btn" data-state="${s.state}">${s.name}</button>`).join('\n            ')}
          </div>
        </div>
        <div class="search-container">
          <input type="text" id="search" placeholder="Search fields..." autocomplete="off">
          <div id="search-results" class="search-results"></div>
        </div>
      </div>
      <div class="sidebar-nav">
        <nav id="nav">
${sidebarHtml}
        </nav>
      </div>
    </aside>

    <main class="main">
      <section id="orca-intro" class="intro-section">
        <h1>ORCA: Object-Relationship Content Attributes</h1>
        <p class="intro-description">
          ORCA is a methodology for organizing and presenting data models in a way that's intuitive for designers.
          This reference documents the Safety Net API data model—the standardized fields, types, and relationships
          used across benefit program applications. Use this reference to understand what data exists, how it's
          structured, and what values are valid for each field.
        </p>
        <div class="intro-domains">
          <h3>Data Domains</h3>
          <p>The data model is organized into these domains:</p>
          <ul>
            <li><a href="#domain-intake"><strong>Intake</strong> — The application as the client experiences it - what they report</a></li>
            <li><a href="#domain-clientManagement"><strong>Client Management</strong> — Persistent identity and relationships across programs</a></li>
            <li><a href="#domain-eligibility"><strong>Eligibility</strong> — Program-specific interpretation and determination</a></li>
            <li><a href="#domain-caseManagement"><strong>Case Management</strong> — Ongoing client relationships and staff assignments</a></li>
            <li><a href="#domain-workflow"><strong>Workflow</strong> — Work items, tasks, SLAs, and verification</a></li>
            <li><a href="#domain-scheduling"><strong>Scheduling</strong> — Time-based coordination and appointments</a></li>
            <li><a href="#domain-documentManagement"><strong>Document Management</strong> — Files, uploads, and document tracking</a></li>
            <li><a href="#domain-crossCutting"><strong>Cross-cutting</strong> — Communication, configuration, and reporting concerns</a></li>
          </ul>
        </div>
      </section>

      <div class="legend">
        <div class="legend-item"><span class="badge type">Text</span> Type indicator</div>
        <div class="legend-item"><span class="badge required">&#10003;</span> Required field</div>
        <div class="legend-item"><span class="badge link">→</span> Links to another object</div>
      </div>

${contentHtml}
    </main>
  </div>

  <script>
    // ORCA tabs - with persistence across all schemas
    let activeTab = localStorage.getItem('orcaActiveTab') || 'overview';

    // Function to set active tab across all sections
    function setActiveTabGlobally(tabName) {
      activeTab = tabName;
      localStorage.setItem('orcaActiveTab', tabName);

      document.querySelectorAll('.orca-tabs').forEach(tabGroup => {
        const tabs = tabGroup.querySelectorAll('.orca-tab');
        const panels = tabGroup.parentElement.querySelectorAll('.orca-panel');

        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        panels.forEach(p => p.classList.toggle('active', p.dataset.tab === tabName));
      });
    }

    // Initialize tabs to saved state
    setActiveTabGlobally(activeTab);

    // Add click handlers for tabs
    document.querySelectorAll('.orca-tabs').forEach(tabGroup => {
      const tabs = tabGroup.querySelectorAll('.orca-tab');

      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          setActiveTabGlobally(tab.dataset.tab);
        });
      });
    });

    // Search index
    const searchIndex = ${JSON.stringify(searchIndex)};

    // Search functionality with dropdown
    const searchInput = document.getElementById('search');
    const searchResults = document.getElementById('search-results');
    const navLinks = document.querySelectorAll('.sidebar nav a');

    function renderSearchResults(results) {
      if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-no-results">No matching fields found</div>';
        return;
      }

      searchResults.innerHTML = results.slice(0, 20).map(r => \`
        <div class="search-result-item" data-schema="\${r.schema}" data-field="\${r.field}">
          <span class="search-result-field">\${r.field}</span>
          <span class="search-result-schema">→ \${r.schema}</span>
          <span class="search-result-meta">
            <span class="search-result-type">\${r.type}</span>
            <span class="search-result-domain">\${r.domain}</span>
          </span>
        </div>
      \`).join('');

      if (results.length > 20) {
        searchResults.innerHTML += \`<div class="search-no-results">\${results.length - 20} more results...</div>\`;
      }
    }

    function navigateToField(schemaName, fieldName) {
      // Navigate to schema section
      const section = document.getElementById(schemaName);
      if (!section) return;

      // Make sure Attributes tab is active
      setActiveTabGlobally('attributes');

      // Find and highlight the field row
      const fieldRow = section.querySelector(\`tr[data-field="\${fieldName}"]\`);
      if (fieldRow) {
        fieldRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        fieldRow.classList.add('field-highlight');
        setTimeout(() => fieldRow.classList.remove('field-highlight'), 2000);
      } else {
        section.scrollIntoView({ behavior: 'smooth' });
      }

      // Clear search
      searchInput.value = '';
      searchResults.classList.remove('visible');
    }

    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();

      if (query.length < 2) {
        searchResults.classList.remove('visible');
        return;
      }

      const results = searchIndex.filter(item =>
        item.field.toLowerCase().includes(query) ||
        item.schema.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query)
      );

      renderSearchResults(results);
      searchResults.classList.add('visible');
    });

    searchResults.addEventListener('click', (e) => {
      const item = e.target.closest('.search-result-item');
      if (item) {
        navigateToField(item.dataset.schema, item.dataset.field);
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-container')) {
        searchResults.classList.remove('visible');
      }
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchResults.classList.remove('visible');
        searchInput.blur();
      }
      if (e.key === 'Enter') {
        const firstResult = searchResults.querySelector('.search-result-item');
        if (firstResult) {
          navigateToField(firstResult.dataset.schema, firstResult.dataset.field);
        }
      }
    });

    // Smooth scrolling
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        target?.scrollIntoView({ behavior: 'smooth' });
      });
    });

    // Domain browser cards
    document.querySelectorAll('.domain-card').forEach(card => {
      const header = card.querySelector('.domain-card-header');
      const schemas = card.querySelector('.domain-card-schemas');

      header.addEventListener('click', () => {
        const isExpanded = schemas.style.display !== 'none';
        schemas.style.display = isExpanded ? 'none' : 'flex';
        card.classList.toggle('expanded', !isExpanded);
      });
    });

    // Hierarchical sidebar domain toggle
    document.querySelectorAll('.sidebar-domain').forEach(domain => {
      const header = domain.querySelector('.sidebar-domain-header');
      const entities = domain.querySelector('.sidebar-domain-entities');
      const toggle = domain.querySelector('.sidebar-domain-toggle');

      if (header && entities && toggle) {
        // Allow clicking on header (but not the domain name link) to toggle
        header.addEventListener('click', (e) => {
          // If clicking the domain name link, let it navigate
          if (e.target.classList.contains('sidebar-domain-name')) {
            return;
          }
          e.preventDefault();
          const isExpanded = entities.style.display !== 'none';
          entities.style.display = isExpanded ? 'none' : 'flex';
          domain.classList.toggle('expanded', !isExpanded);
        });
      }
    });

    // Smooth scroll for sidebar domain links too
    document.querySelectorAll('.sidebar-domain-name').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const href = link.getAttribute('href');
        if (href) {
          const target = document.querySelector(href);
          target?.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });

    // Global state selector
    const stateBtns = document.querySelectorAll('.state-selector-btn');
    const stateContents = document.querySelectorAll('[data-state-content]');

    stateBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const selectedState = btn.dataset.state;

        // Update active button
        stateBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Show/hide state-specific content
        stateContents.forEach(content => {
          const contentState = content.dataset.stateContent;
          content.style.display = (contentState === selectedState) ? '' : 'none';
        });

        // Highlight state-specific fields
        document.querySelectorAll('.state-added-field').forEach(row => {
          row.classList.remove('state-added-field');
        });

        if (selectedState !== 'base') {
          document.querySelectorAll(\`[data-state-field="\${selectedState}"]\`).forEach(row => {
            row.classList.add('state-added-field');
          });
        }
      });
    });
  </script>
</body>
</html>`;
}

/**
 * Main function
 */
async function main() {
  // Parse --specs flag
  const args = process.argv.slice(2);
  const specsArg = args.find(a => a.startsWith('--specs='));
  if (!specsArg) {
    console.error('Error: --specs=<dir> is required.\n');
    console.error('Usage: node scripts/export-design-reference.js --specs=<dir>');
    process.exit(1);
  }
  const specsDir = resolve(specsArg.split('=')[1]);

  console.log('Generating ORCA Design Reference...\n');
  console.log(`Specs: ${specsDir}\n`);

  try {
    const apiSpecs = discoverApiSpecs({ specsDir });
    console.log(`Found ${apiSpecs.length} API specifications`);

    const baseSchemas = {};

    // Patterns for CRUD operation schemas that should be excluded from design reference
    const CRUD_SCHEMA_PATTERNS = [/Create$/, /Update$/, /List$/, /^Conflict$/];
    const isCrudSchema = (name) => CRUD_SCHEMA_PATTERNS.some(pattern => pattern.test(name));

    for (const apiSpec of apiSpecs) {
      console.log(`Processing: ${apiSpec.name}`);
      try {
        const spec = await $RefParser.dereference(apiSpec.specPath, {
          dereference: { circular: 'ignore' }
        });
        if (spec.components?.schemas) {
          for (const [name, schema] of Object.entries(spec.components.schemas)) {
            if (isCrudSchema(name)) continue;
            baseSchemas[name] = schema;
          }
        }
      } catch (err) {
        console.warn(`  Warning: Could not process ${apiSpec.name}: ${err.message}`);
      }
    }

    console.log(`\nCollected ${Object.keys(baseSchemas).length} base schemas`);

    // Populate valid schema names for link generation
    validSchemaNames = new Set(Object.keys(baseSchemas));

    // Pre-scan schemas to discover inline objects (so links work)
    inlineObjectSchemas.clear();
    for (const [schemaName, schema] of Object.entries(baseSchemas)) {
      processSchema(schema, schemaName);
    }
    for (const inlineName of inlineObjectSchemas.keys()) {
      validSchemaNames.add(inlineName);
    }
    console.log(`Discovered ${inlineObjectSchemas.size} inline nested objects`);

    // Extract relationships
    console.log('Extracting relationships...');
    const relationships = extractRelationships(baseSchemas);

    // Extract operations
    console.log('Extracting API operations...');
    const operations = extractOperations(apiSpecs);

    // Generate HTML (no state overlays — states use resolve-overlay.js separately)
    const stateSchemas = {};
    const states = [];
    const html = generateHtml(baseSchemas, stateSchemas, states, relationships, operations);

    // Write output to root docs/ folder (for GitHub Pages)
    const outputDir = join(__dirname, '../../../docs');
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = join(outputDir, 'schema-reference.html');
    writeFileSync(outputPath, html, 'utf8');

    console.log(`\nGenerated: ${outputPath}`);
    console.log('This file is version controlled and published with the npm package.');
    console.log('Done!');

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
