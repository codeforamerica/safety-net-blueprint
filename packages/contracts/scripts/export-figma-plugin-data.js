#!/usr/bin/env node
/**
 * Export data for Figma Plugin
 * Generates JSON with schema metadata (including enum options) and example data
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import yaml from 'js-yaml';
import $RefParser from '@apidevtools/json-schema-ref-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Convert camelCase to Title Case with spaces
 */
function toTitleCase(str) {
  return str
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

/**
 * Format enum value for display
 */
function formatEnumValue(value) {
  if (typeof value !== 'string') return String(value);
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Determine field type from schema
 */
function getFieldType(schema) {
  if (schema.enum) return 'dropdown';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.format === 'date' || schema.format === 'date-time') return 'date';
  return 'text';
}

/**
 * Extract metadata from a schema's properties
 */
function extractMetadata(schema, parentPath = '') {
  const metadata = {};

  const properties = schema.properties || {};
  if (schema.allOf) {
    for (const part of schema.allOf) {
      if (part.properties) {
        Object.assign(properties, part.properties);
      }
    }
  }

  for (const [propName, propSchema] of Object.entries(properties)) {
    const path = parentPath ? `${parentPath}.${propName}` : propName;
    const label = toTitleCase(propName);

    // Handle nested objects
    if (propSchema.type === 'object' && propSchema.properties) {
      const nestedMeta = extractMetadata(propSchema, path);
      Object.assign(metadata, nestedMeta);
      continue;
    }

    // Handle allOf references
    if (propSchema.allOf) {
      const merged = { properties: {} };
      for (const part of propSchema.allOf) {
        if (part.properties) {
          Object.assign(merged.properties, part.properties);
        }
      }
      if (Object.keys(merged.properties).length > 0) {
        const nestedMeta = extractMetadata(merged, path);
        Object.assign(metadata, nestedMeta);
        continue;
      }
    }

    const fieldMeta = {
      type: getFieldType(propSchema),
      label: label
    };

    // Add enum options for dropdowns
    if (propSchema.enum) {
      fieldMeta.options = propSchema.enum.map(formatEnumValue);
      fieldMeta.rawOptions = propSchema.enum; // Keep original values for matching
    }

    // Add description if available
    if (propSchema.description) {
      fieldMeta.description = propSchema.description;
    }

    metadata[path] = fieldMeta;
  }

  return metadata;
}

/**
 * Flatten nested object for easier use
 */
function flattenObject(obj, parentPath = '', result = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = parentPath ? `${parentPath}.${key}` : key;

    // Skip system fields
    if (key === 'id' && parentPath === '') continue;
    if (key === 'verificationSourceIds') continue;
    if (key === 'verifiedBy') continue;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, currentPath, result);
    } else if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] !== 'object') {
        result[currentPath] = value.map(v => formatEnumValue(v)).join(', ');
      } else if (value.length > 0 && typeof value[0] === 'object') {
        // For arrays like jobs, flatten first item
        if (key === 'jobs' && value[0]) {
          flattenObject(value[0], currentPath, result);
        }
      }
    } else {
      // Format the value
      let displayValue = value;
      if (typeof value === 'boolean') {
        displayValue = value ? 'Yes' : 'No';
      } else if (typeof value === 'string' && value.includes('_')) {
        displayValue = formatEnumValue(value);
      }
      result[currentPath] = displayValue;
    }
  }

  return result;
}

/**
 * Load and process schemas
 */
async function loadSchemas() {
  const componentsDir = join(__dirname, '../openapi/components');
  const componentFiles = ['person.yaml', 'household.yaml', 'application.yaml', 'income.yaml', 'common.yaml'];

  const allMetadata = {};

  for (const file of componentFiles) {
    const filePath = join(componentsDir, file);
    if (!existsSync(filePath)) continue;

    try {
      const dereferenced = await $RefParser.dereference(filePath, {
        dereference: { circular: 'ignore' }
      });

      for (const [schemaName, schema] of Object.entries(dereferenced)) {
        if (typeof schema !== 'object' || !schema) continue;

        const metadata = extractMetadata(schema);
        // Prefix with schema name for context
        for (const [key, value] of Object.entries(metadata)) {
          allMetadata[key] = value;
        }
      }
    } catch (err) {
      console.warn(`  Warning: Could not process ${file}: ${err.message}`);
    }
  }

  return allMetadata;
}

/**
 * Load example files
 */
function loadExamples() {
  const examplesDir = join(__dirname, '../openapi/examples');
  const examples = {};

  if (!existsSync(examplesDir)) {
    console.warn('Examples directory not found');
    return examples;
  }

  const exampleFiles = readdirSync(examplesDir).filter(f => f.endsWith('.yaml'));

  for (const file of exampleFiles) {
    const filePath = join(examplesDir, file);
    const resourceName = basename(file, '.yaml');

    try {
      const content = readFileSync(filePath, 'utf8');
      const data = yaml.load(content);

      examples[resourceName] = [];
      for (const [exampleName, exampleData] of Object.entries(data)) {
        const flattened = flattenObject(exampleData);
        flattened.__exampleName = exampleName;
        flattened.__resourceType = resourceName;
        examples[resourceName].push(flattened);
      }
    } catch (err) {
      console.warn(`  Warning: Could not load ${file}: ${err.message}`);
    }
  }

  return examples;
}

/**
 * Main function
 */
async function main() {
  console.log('Exporting Figma Plugin Data...\n');

  const outputDir = join(__dirname, '../design-export/figma-plugin');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Load schema metadata
  console.log('Loading schemas...');
  const metadata = await loadSchemas();
  console.log(`  Found ${Object.keys(metadata).length} fields\n`);

  // Load examples
  console.log('Loading examples...');
  const examples = loadExamples();

  // Generate per-resource files
  for (const [resourceName, resourceExamples] of Object.entries(examples)) {
    console.log(`  Processing: ${resourceName}`);

    const output = {
      resource: resourceName,
      metadata: metadata,
      examples: resourceExamples
    };

    const outputPath = join(outputDir, `${resourceName}.json`);
    writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`    Generated: ${outputPath}`);
  }

  // Generate combined file
  console.log('\nCreating combined file...');
  const allExamples = [];
  for (const resourceExamples of Object.values(examples)) {
    allExamples.push(...resourceExamples);
  }

  const combinedOutput = {
    metadata: metadata,
    examples: allExamples
  };

  const combinedPath = join(outputDir, 'all-data.json');
  writeFileSync(combinedPath, JSON.stringify(combinedOutput, null, 2), 'utf8');
  console.log(`Generated: ${combinedPath}`);

  // Also create a human-readable field list
  const fieldListPath = join(outputDir, 'field-list.txt');
  const fieldList = Object.entries(metadata)
    .map(([key, meta]) => {
      let line = `${meta.label} (${key}) - ${meta.type}`;
      if (meta.options) {
        line += `\n    Options: ${meta.options.join(', ')}`;
      }
      return line;
    })
    .join('\n');
  writeFileSync(fieldListPath, fieldList, 'utf8');
  console.log(`Generated: ${fieldListPath}`);

  console.log('\nDone! Copy the contents of all-data.json into the Figma plugin.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
