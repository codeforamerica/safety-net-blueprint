#!/usr/bin/env node
/**
 * Export Figma Data
 * Generates flattened JSON files from OpenAPI examples for use with Figma plugins
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Convert camelCase or snake_case to Title Case
 */
function toTitleCase(str) {
  return str
    // Insert space before uppercase letters
    .replace(/([A-Z])/g, ' $1')
    // Replace underscores with spaces
    .replace(/_/g, ' ')
    // Capitalize first letter of each word
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

/**
 * Format a field name to be designer-friendly
 */
function formatFieldName(path) {
  const parts = path.split('.');
  const lastPart = parts[parts.length - 1];

  // Special case mappings
  const specialMappings = {
    'firstName': 'First Name',
    'lastName': 'Last Name',
    'middleName': 'Middle Name',
    'middleInitial': 'Middle Initial',
    'dateOfBirth': 'Date of Birth',
    'socialSecurityNumber': 'SSN',
    'phoneNumber': 'Phone',
    'email': 'Email',
    'addressLine1': 'Street Address',
    'addressLine2': 'Apt/Unit',
    'stateProvince': 'State',
    'postalCode': 'ZIP',
    'isHispanicOrLatino': 'Hispanic/Latino',
    'createdAt': 'Created',
    'updatedAt': 'Updated',
    'otherPhoneNumber': 'Other Phone',
    'preferredContactMethod': 'Preferred Contact',
    'preferredNoticeMethod': 'Notice Method',
    'maritalStatus': 'Marital Status',
    'veteranStatus': 'Veteran',
    'isMilitaryServiceMember': 'Military Member',
    'hasDisability': 'Has Disability',
    'personId': 'Person ID',
    'employerId': 'Employer ID',
    'incomeBasis': 'Income Basis',
  };

  // Check for special mapping
  if (specialMappings[lastPart]) {
    return specialMappings[lastPart];
  }

  // Handle nested paths with context
  if (parts.length > 1) {
    const parent = toTitleCase(parts[parts.length - 2]);
    const field = toTitleCase(lastPart);

    // Skip redundant parent prefixes
    if (field.toLowerCase().includes(parent.toLowerCase().split(' ')[0].toLowerCase())) {
      return field;
    }

    return `${parent} ${field}`;
  }

  return toTitleCase(lastPart);
}

/**
 * Flatten a nested object into dot-notation keys with friendly names
 */
function flattenObject(obj, parentPath = '', result = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = parentPath ? `${parentPath}.${key}` : key;

    // Skip certain fields that aren't useful for designers
    if (key === 'id' && parentPath === '') continue; // Keep nested IDs but skip top-level
    if (key === 'verificationSourceIds') continue;
    if (key === 'verifiedBy') continue;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, currentPath, result);
    } else if (Array.isArray(value)) {
      // For arrays of primitives (like race), join them
      if (value.length > 0 && typeof value[0] !== 'object') {
        const fieldName = formatFieldName(currentPath);
        result[fieldName] = value.map(v => formatEnumValue(v)).join(', ');
      }
      // For arrays of objects, we could expand them, but for simplicity we skip
      // or take first item only for certain fields
      else if (value.length > 0 && typeof value[0] === 'object') {
        // For jobs/employment, flatten first job
        if (key === 'jobs' && value[0]) {
          flattenObject(value[0], currentPath, result);
        }
      }
    } else {
      const fieldName = formatFieldName(currentPath);
      result[fieldName] = formatValue(key, value);
    }
  }

  return result;
}

/**
 * Format enum values to be more readable
 */
function formatEnumValue(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format a value based on its field name
 */
function formatValue(fieldName, value) {
  if (value === null || value === undefined) return '';

  // Boolean to Yes/No
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  // Format enum-like strings
  if (typeof value === 'string' && value.includes('_')) {
    return formatEnumValue(value);
  }

  return value;
}

/**
 * Process example files and generate Figma-ready JSON
 */
function processExamples() {
  const examplesDir = join(__dirname, '../openapi/examples');
  const outputDir = join(__dirname, '../design-export/figma-data');

  // Create output directory
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Get all example files
  const exampleFiles = readdirSync(examplesDir).filter(f => f.endsWith('.yaml'));

  console.log('Processing example files...\n');

  for (const file of exampleFiles) {
    const filePath = join(examplesDir, file);
    const resourceName = basename(file, '.yaml');

    console.log(`Processing: ${file}`);

    try {
      const content = readFileSync(filePath, 'utf8');
      const examples = yaml.load(content);

      const flattenedExamples = [];

      // Process each example
      for (const [exampleName, exampleData] of Object.entries(examples)) {
        console.log(`  - ${exampleName}`);
        const flattened = flattenObject(exampleData);
        flattenedExamples.push(flattened);
      }

      // Write JSON file
      const outputPath = join(outputDir, `${resourceName}.json`);
      writeFileSync(outputPath, JSON.stringify(flattenedExamples, null, 2), 'utf8');

      console.log(`  Generated: ${outputPath}`);

    } catch (err) {
      console.error(`  Error processing ${file}: ${err.message}`);
    }
  }

  // Also create a combined file with all examples
  console.log('\nCreating combined examples file...');

  const combined = {};
  for (const file of exampleFiles) {
    const resourceName = basename(file, '.yaml');
    const outputPath = join(outputDir, `${resourceName}.json`);
    if (existsSync(outputPath)) {
      combined[resourceName] = JSON.parse(readFileSync(outputPath, 'utf8'));
    }
  }

  const combinedPath = join(outputDir, 'all-examples.json');
  writeFileSync(combinedPath, JSON.stringify(combined, null, 2), 'utf8');
  console.log(`Generated: ${combinedPath}`);
}

/**
 * Main function
 */
function main() {
  console.log('Exporting Figma Data...\n');

  try {
    processExamples();
    console.log('\nDone!');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
