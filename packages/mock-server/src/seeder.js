/**
 * Data seeder - loads example data from YAML files into SQLite
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import { insertResource, count } from './database-manager.js';
import { getExamplesPath } from '@codeforamerica/safety-net-blueprint-contracts/loader';

/**
 * Load examples from YAML file
 * @param {string} examplesPath - Path to examples YAML file
 * @returns {Object} Examples object
 */
function loadExamples(examplesPath) {
  if (!existsSync(examplesPath)) {
    return {};
  }
  
  const content = readFileSync(examplesPath, 'utf8');
  return yaml.load(content) || {};
}

/**
 * Extract individual resources from examples
 * Filters out list examples and payload examples
 * Returns resources sorted by example name (Example1, Example2, etc.)
 * @param {Object} examples - Examples object from YAML
 * @returns {Array} Array of individual resource objects in sorted order
 */
function extractIndividualResources(examples) {
  const resources = [];
  
  // First, collect all valid examples with their keys
  const validExamples = [];
  
  for (const [key, value] of Object.entries(examples)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    
    // Skip list examples (have 'items' array property)
    if (value.items && Array.isArray(value.items)) {
      continue;
    }
    
    // Skip payload examples (typically used for Create/Update requests)
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('payload') || lowerKey.includes('create') || lowerKey.includes('update')) {
      continue;
    }
    
    // Only include resources that have an 'id' field
    if (value.id) {
      validExamples.push({ key, value });
    }
  }
  
  // Sort by key name to ensure consistent order (Example1, Example2, Example3)
  validExamples.sort((a, b) => a.key.localeCompare(b.key));
  
  // Extract just the values in sorted order
  return validExamples.map(ex => ex.value);
}

/**
 * Seed database with examples from YAML file
 * @param {string} resourceName - Name of the resource (e.g., 'persons')
 * @param {string} specsDir - Path to specs directory
 * @returns {number} Number of resources seeded
 */
export function seedDatabase(resourceName, specsDir) {
  try {
    // Check if database already has data
    const existingCount = count(resourceName);
    if (existingCount > 0) {
      console.log(`  Database ${resourceName}.db already has ${existingCount} records, skipping seed`);
      return existingCount;
    }

    const examplesPath = getExamplesPath(resourceName, specsDir);
    
    if (!existsSync(examplesPath)) {
      console.log(`  No examples file found for ${resourceName}, database will be empty`);
      return 0;
    }
    
    const examples = loadExamples(examplesPath);
    
    if (!examples || Object.keys(examples).length === 0) {
      console.log(`  No examples found in ${resourceName}.yaml, database will be empty`);
      return 0;
    }
    
    const resources = extractIndividualResources(examples);
    
    if (resources.length === 0) {
      console.log(`  No valid resources found in ${resourceName}.yaml examples`);
      return 0;
    }
    
    // Insert each resource with timestamps ensuring proper list order
    // Query orders by createdAt DESC, so Example1 needs the NEWEST timestamp to appear first
    let seededCount = 0;
    const baseTimestamp = new Date('2024-01-01T00:00:00Z').getTime();
    
    for (let i = 0; i < resources.length; i++) {
      try {
        // Create a copy to avoid mutating the original
        const resource = { ...resources[i] };
        
        // Override createdAt/updatedAt to ensure proper ordering
        // Example1 (i=0) gets newest timestamp, Example2 (i=1) gets older, etc.
        // This way when sorted DESC, Example1 appears first
        const minutesOffset = (resources.length - 1 - i) * 60000; // Reverse order: Example1=newest
        const timestamp = new Date(baseTimestamp + minutesOffset).toISOString();
        resource.createdAt = timestamp;
        resource.updatedAt = timestamp;
        
        insertResource(resourceName, resource);
        seededCount++;
      } catch (error) {
        console.warn(`  Warning: Could not seed resource ${resources[i].id}:`, error.message);
      }
    }
    
    console.log(`  Seeded ${seededCount} ${resourceName} from examples`);
    return seededCount;
  } catch (error) {
    console.error(`  Error seeding ${resourceName}:`, error.message);
    return 0;
  }
}

/**
 * Seed all databases for all discovered APIs
 * @param {Array} apiSpecs - Array of API specification objects
 * @param {string} specsDir - Path to specs directory
 * @returns {Object} Summary of seeded data
 */
export function seedAllDatabases(apiSpecs, specsDir) {
  console.log('\nSeeding databases from example files...');

  const summary = {};

  for (const api of apiSpecs) {
    try {
      const count = seedDatabase(api.name, specsDir);
      summary[api.name] = count;
    } catch (error) {
      console.warn(`  Warning: Could not seed ${api.name}:`, error.message);
      summary[api.name] = 0;
    }
  }
  
  console.log('✓ Database seeding complete\n');
  return summary;
}
