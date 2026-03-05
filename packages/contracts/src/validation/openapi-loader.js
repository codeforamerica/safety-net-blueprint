/**
 * OpenAPI specification loader and parser
 * Discovers and loads all API specifications from the openapi directory
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import yaml from 'js-yaml';
import $RefParser from '@apidevtools/json-schema-ref-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load and parse a YAML file
 */
function loadYaml(filePath) {
  const content = readFileSync(filePath, 'utf8');
  return yaml.load(content);
}

/**
 * Discover all API specification files in the given specs directory.
 * Matches files ending in -openapi.yaml (the naming convention for OpenAPI specs).
 * @param {Object} options
 * @param {string} options.specsDir - Path to the specs file or directory (required)
 */
export function discoverApiSpecs({ specsDir } = {}) {
  if (!specsDir) {
    throw new Error('specsDir is required — pass --spec <path> to specify the specs file or directory');
  }

  const openapiDir = specsDir;
  const files = readdirSync(openapiDir);

  return files
    .filter(file => {
      const fullPath = join(openapiDir, file);
      const stat = statSync(fullPath);
      return stat.isFile() && file.endsWith('-openapi.yaml');
    })
    .map(file => {
      const resourceName = basename(file, '-openapi.yaml');
      return {
        name: resourceName,
        specPath: join(openapiDir, file)
      };
    });
}

/**
 * Load and dereference (resolve all $refs) an OpenAPI specification
 * @param {string} specPath - Path to the OpenAPI spec file
 * @returns {Promise<Object>} Dereferenced OpenAPI specification
 */
export async function loadSpec(specPath) {
  try {
    // Use $RefParser to dereference all $refs (including external file refs)
    const spec = await $RefParser.dereference(specPath, {
      dereference: {
        circular: 'ignore'
      }
    });
    return spec;
  } catch (error) {
    console.error(`Error loading spec ${specPath}:`, error.message);
    throw error;
  }
}

/**
 * Extract metadata from a dereferenced OpenAPI spec
 * @param {Object} spec - Dereferenced OpenAPI specification
 * @param {string} resourceName - Name of the resource (e.g., 'persons')
 * @returns {Object} Metadata about the API
 */
export function extractMetadata(spec, resourceName) {
  const paths = spec.paths || {};
  const metadata = {
    name: resourceName,
    title: spec.info?.title || resourceName,
    version: spec.info?.version || '1.0.0',
    baseResource: Object.keys(paths).find(p => !p.includes('{')) || `/${resourceName}`,
    endpoints: [],
    schemas: {},
    errorResponses: {},
    pagination: {
      limitDefault: 25,
      limitMax: 100,
      offsetDefault: 0
    }
  };
  
  // Extract pagination defaults from spec
  const limitParam = spec.components?.parameters?.LimitParam;
  if (limitParam?.schema) {
    metadata.pagination.limitDefault = limitParam.schema.default || 25;
    metadata.pagination.limitMax = limitParam.schema.maximum || 100;
  }
  
  const offsetParam = spec.components?.parameters?.OffsetParam;
  if (offsetParam?.schema) {
    metadata.pagination.offsetDefault = offsetParam.schema.default || 0;
  }
  
  // Extract schemas
  if (spec.components?.schemas) {
    for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
      metadata.schemas[schemaName] = schema;
    }
  }
  
  // Extract error responses
  if (spec.components?.responses) {
    for (const [responseName, response] of Object.entries(spec.components.responses)) {
      if (responseName.includes('Error') || responseName === 'NotFound' || 
          responseName === 'BadRequest' || responseName === 'UnprocessableEntity') {
        metadata.errorResponses[responseName] = response;
      }
    }
  }
  
  // Extract endpoints
  for (const [path, pathItem] of Object.entries(paths)) {
    // Get path-level parameters
    const pathParameters = pathItem.parameters || [];
    
    for (const [method, operation] of Object.entries(pathItem)) {
      // Skip parameters object and unsupported methods
      if (method === 'parameters' || !['get', 'post', 'patch', 'delete', 'put'].includes(method)) {
        continue;
      }
      
      // Skip action endpoints (like /submit)
      if (path.includes('/submit')) {
        continue;
      }
      
      // Merge path-level and operation-level parameters
      const operationParameters = operation.parameters || [];
      const allParameters = [...pathParameters, ...operationParameters];
      
      const endpoint = {
        path,
        method: method.toUpperCase(),
        operationId: operation.operationId,
        summary: operation.summary,
        parameters: allParameters,
        requestSchema: null,
        responseSchema: null,
        errorSchemas: {}
      };
      
      // Extract request schema
      if (operation.requestBody?.content?.['application/json']?.schema) {
        endpoint.requestSchema = operation.requestBody.content['application/json'].schema;
      }
      
      // Extract response schema (200/201)
      const successStatus = method === 'post' ? '201' : '200';
      if (operation.responses?.[successStatus]?.content?.['application/json']?.schema) {
        endpoint.responseSchema = operation.responses[successStatus].content['application/json'].schema;
      }
      
      // Extract error schemas
      for (const [statusCode, response] of Object.entries(operation.responses || {})) {
        if (statusCode >= 400 && response.content?.['application/json']?.schema) {
          endpoint.errorSchemas[statusCode] = response.content['application/json'].schema;
        }
      }
      
      metadata.endpoints.push(endpoint);
    }
  }
  
  return metadata;
}

/**
 * Get the path to examples file for an API
 * @param {string} apiName - Name of the API (e.g., 'persons')
 * @param {string} specsDir - Path to the specs directory
 * @returns {string} Path to the examples file
 */
export function getExamplesPath(apiName, specsDir) {
  if (!specsDir) {
    throw new Error('specsDir is required');
  }
  // Examples are colocated with specs as {name}-openapi-examples.yaml
  return join(specsDir, `${apiName}-openapi-examples.yaml`);
}

/**
 * Convert a kebab-case collection name to its PascalCase singular schema prefix.
 * Used to match example keys to collections (e.g., "queues" → "Queue",
 * "task-audit-events" → "TaskAuditEvent").
 * @param {string} collectionName - Database collection name
 * @returns {string} PascalCase schema prefix
 */
export function collectionToSchemaPrefix(collectionName) {
  const segments = collectionName.split('-');
  return segments.map((seg, i) => {
    let s = seg;
    if (i === segments.length - 1) {
      if (s.endsWith('ies')) s = s.slice(0, -3) + 'y';
      else if (s.endsWith('ses')) s = s.slice(0, -2);
      else if (s.endsWith('s')) s = s.slice(0, -1);
    }
    return s.charAt(0).toUpperCase() + s.slice(1);
  }).join('');
}

/**
 * Extract individual resources from an examples object.
 * Filters out list examples, payload examples, and non-object entries.
 * Returns resources sorted by key name for consistent ordering.
 * @param {Object} examples - Examples object from YAML (key → value)
 * @returns {Array<{key: string, name: string, data: Object}>} Sorted array of resources
 */
export function extractIndividualResources(examples) {
  const resources = [];

  for (const [key, value] of Object.entries(examples)) {
    if (!value || typeof value !== 'object') continue;
    if (value.items && Array.isArray(value.items)) continue;

    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('payload') || lowerKey.includes('create') || lowerKey.includes('update')) continue;

    if (value.id) {
      resources.push({ key, name: key, data: value });
    }
  }

  resources.sort((a, b) => a.key.localeCompare(b.key));
  return resources;
}

/**
 * Load all API specifications
 * @param {Object} options
 * @param {string} options.specsDir - Path to the specs directory (required)
 * @returns {Promise<Array>} Array of API metadata objects
 */
export async function loadAllSpecs({ specsDir } = {}) {
  const apiSpecs = discoverApiSpecs({ specsDir });
  const loadedSpecs = [];
  
  for (const apiSpec of apiSpecs) {
    try {
      const spec = await loadSpec(apiSpec.specPath);
      const metadata = extractMetadata(spec, apiSpec.name);
      loadedSpecs.push(metadata);
    } catch (error) {
      console.warn(`Warning: Could not load ${apiSpec.name}:`, error.message);
    }
  }
  
  return loadedSpecs;
}
