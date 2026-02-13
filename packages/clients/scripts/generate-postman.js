/**
 * Postman Collection Generator
 * Generates a Postman collection from OpenAPI specifications and examples
 */

import { loadAllSpecs, discoverApiSpecs, getExamplesPath } from '@safety-net/contracts/loader';
import { validateAll, getValidationStatus } from '@safety-net/contracts/validation';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const specsDir = join(__dirname, '../../contracts');

const BASE_URL = process.env.POSTMAN_BASE_URL || 'http://localhost:1080';

/**
 * Load examples from YAML file (uses state-specific if STATE env var set)
 */
function loadExamples(resourceName) {
  const examplesPath = getExamplesPath(resourceName, specsDir);

  if (!existsSync(examplesPath)) {
    return {};
  }

  const content = readFileSync(examplesPath, 'utf8');
  return yaml.load(content) || {};
}

/**
 * Extract individual resources from examples
 */
function extractIndividualResources(examples) {
  const resources = [];
  
  for (const [key, value] of Object.entries(examples)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    
    // Skip list examples
    if (value.items && Array.isArray(value.items)) {
      continue;
    }
    
    // Skip payload examples
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('payload') || lowerKey.includes('create') || lowerKey.includes('update')) {
      continue;
    }
    
    // Only include resources that have an 'id' field
    if (value.id) {
      resources.push({
        key,
        name: key,
        data: value
      });
    }
  }
  
  return resources;
}

/**
 * Generate basic test script for a request
 */
function generateTestScript(method, endpoint) {
  const tests = [];
  
  // Status code test based on method
  if (method === 'GET') {
    tests.push(`pm.test("Status code is 200", function () {`);
    tests.push(`    pm.response.to.have.status(200);`);
    tests.push(`});`);
    tests.push(``);
    tests.push(`pm.test("Response is JSON", function () {`);
    tests.push(`    pm.response.to.be.json;`);
    tests.push(`});`);
    
    // List endpoint tests
    if (!endpoint.path.includes('{')) {
      tests.push(``);
      tests.push(`pm.test("Response has required list properties", function () {`);
      tests.push(`    const jsonData = pm.response.json();`);
      tests.push(`    pm.expect(jsonData).to.have.property('items');`);
      tests.push(`    pm.expect(jsonData).to.have.property('total');`);
      tests.push(`    pm.expect(jsonData).to.have.property('limit');`);
      tests.push(`    pm.expect(jsonData).to.have.property('offset');`);
      tests.push(`    pm.expect(jsonData.items).to.be.an('array');`);
      tests.push(`});`);
    } else {
      // Get by ID tests
      tests.push(``);
      tests.push(`pm.test("Response has id property", function () {`);
      tests.push(`    const jsonData = pm.response.json();`);
      tests.push(`    pm.expect(jsonData).to.have.property('id');`);
      tests.push(`});`);
    }
  } else if (method === 'POST') {
    tests.push(`pm.test("Status code is 201", function () {`);
    tests.push(`    pm.response.to.have.status(201);`);
    tests.push(`});`);
    tests.push(``);
    tests.push(`pm.test("Response has id and timestamps", function () {`);
    tests.push(`    const jsonData = pm.response.json();`);
    tests.push(`    pm.expect(jsonData).to.have.property('id');`);
    tests.push(`    pm.expect(jsonData).to.have.property('createdAt');`);
    tests.push(`    pm.expect(jsonData).to.have.property('updatedAt');`);
    tests.push(`});`);
    tests.push(``);
    tests.push(`pm.test("Location header is present", function () {`);
    tests.push(`    pm.response.to.have.header("Location");`);
    tests.push(`});`);
  } else if (method === 'PATCH') {
    tests.push(`pm.test("Status code is 200", function () {`);
    tests.push(`    pm.response.to.have.status(200);`);
    tests.push(`});`);
    tests.push(``);
    tests.push(`pm.test("Response has updatedAt timestamp", function () {`);
    tests.push(`    const jsonData = pm.response.json();`);
    tests.push(`    pm.expect(jsonData).to.have.property('updatedAt');`);
    tests.push(`});`);
  } else if (method === 'DELETE') {
    tests.push(`pm.test("Status code is 204", function () {`);
    tests.push(`    pm.response.to.have.status(204);`);
    tests.push(`});`);
  }
  
  return tests.join('\n');
}

/**
 * Create a Postman request object
 */
function createRequest(method, url, body = null, description = '') {
  const request = {
    method,
    header: [],
    url
  };
  
  if (body) {
    request.header.push({
      key: 'Content-Type',
      value: 'application/json',
      type: 'text'
    });
    request.body = {
      mode: 'raw',
      raw: JSON.stringify(body, null, 2),
      options: {
        raw: {
          language: 'json'
        }
      }
    };
  }
  
  if (description) {
    request.description = description;
  }
  
  return request;
}

/**
 * Parse URL with Postman variable syntax
 */
function createPostmanUrl(path, baseUrl = '{{baseUrl}}') {
  const segments = path.split('/').filter(s => s);
  const pathSegments = [];
  const variables = [];
  
  for (const segment of segments) {
    if (segment.startsWith('{') && segment.endsWith('}')) {
      const varName = segment.slice(1, -1);
      pathSegments.push(`{{${varName}}}`);
      variables.push(varName);
    } else {
      pathSegments.push(segment);
    }
  }
  
  return {
    raw: `${baseUrl}/${pathSegments.join('/')}`,
    host: [baseUrl],
    path: pathSegments,
    variables
  };
}

/**
 * Generate requests for a GET list endpoint
 */
function generateListRequests(apiMetadata, endpoint, examples) {
  const requests = [];
  const url = createPostmanUrl(endpoint.path);
  
  // 1. List all (default pagination)
  requests.push({
    name: `List All ${capitalize(apiMetadata.name)}`,
    request: createRequest('GET', {
      ...url,
      query: [
        { key: 'limit', value: '25', description: 'Maximum number of items' },
        { key: 'offset', value: '0', description: 'Number of items to skip' }
      ]
    }),
    event: [{
      listen: 'test',
      script: {
        exec: generateTestScript('GET', endpoint).split('\n')
      }
    }]
  });
  
  // 2. List with custom pagination
  requests.push({
    name: `List ${capitalize(apiMetadata.name)} (Paginated)`,
    request: createRequest('GET', {
      ...url,
      query: [
        { key: 'limit', value: '2', description: 'Get only 2 items' },
        { key: 'offset', value: '0', description: 'Start from beginning' }
      ]
    }),
    event: [{
      listen: 'test',
      script: {
        exec: generateTestScript('GET', endpoint).split('\n')
      }
    }]
  });
  
  // 3. Search examples (if search parameter exists)
  const hasSearch = endpoint.parameters.some(p => p.name === 'search');
  if (hasSearch && examples.length > 0) {
    // Get searchable field value from first example
    const searchValue = examples[0].data.name?.firstName || 
                        examples[0].data.email?.split('@')[0] ||
                        'test';
    
    requests.push({
      name: `Search ${capitalize(apiMetadata.name)}`,
      request: createRequest('GET', {
        ...url,
        query: [
          { key: 'search', value: searchValue, description: 'Search query' },
          { key: 'limit', value: '10', description: 'Maximum results' }
        ]
      }),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('GET', endpoint).split('\n')
        }
      }]
    });
  }
  
  // 4. Filter examples (if other query params exist)
  for (const param of endpoint.parameters) {
    if (['search', 'limit', 'offset'].includes(param.name)) {
      continue;
    }
    
    // Add filter example
    const filterValue = param.schema?.enum?.[0] || 'example';
    requests.push({
      name: `Filter by ${param.name}`,
      request: createRequest('GET', {
        ...url,
        query: [
          { key: param.name, value: filterValue, description: param.description || `Filter by ${param.name}` }
        ]
      }),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('GET', endpoint).split('\n')
        }
      }]
    });
  }
  
  return requests;
}

/**
 * Generate requests for a GET by ID endpoint
 */
function generateGetByIdRequests(apiMetadata, endpoint, examples) {
  const requests = [];
  
  // Create one request per example
  for (const example of examples) {
    const url = createPostmanUrl(endpoint.path);
    const urlWithId = {
      ...url,
      raw: url.raw.replace(/\{\{[^}]+\}\}/, example.data.id),
      path: url.path.map(seg => seg.includes('{{') ? example.data.id : seg)
    };
    
    requests.push({
      name: `Get ${example.name}`,
      request: createRequest('GET', urlWithId),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('GET', endpoint).split('\n')
        }
      }]
    });
  }
  
  // Add 404 test example
  const url = createPostmanUrl(endpoint.path);
  const notFoundUrl = {
    ...url,
    raw: url.raw.replace(/\{\{[^}]+\}\}/, '00000000-0000-0000-0000-000000000000'),
    path: url.path.map(seg => seg.includes('{{') ? '00000000-0000-0000-0000-000000000000' : seg)
  };
  
  requests.push({
    name: `Get Non-Existent ${capitalize(singularize(apiMetadata.name))} (404)`,
    request: createRequest('GET', notFoundUrl),
    event: [{
      listen: 'test',
      script: {
        exec: [
          'pm.test("Status code is 404", function () {',
          '    pm.response.to.have.status(404);',
          '});',
          '',
          'pm.test("Error response has code and message", function () {',
          '    const jsonData = pm.response.json();',
          '    pm.expect(jsonData).to.have.property(\'code\');',
          '    pm.expect(jsonData).to.have.property(\'message\');',
          '});'
        ]
      }
    }]
  });
  
  return requests;
}

/**
 * Generate requests for a POST endpoint
 */
function generateCreateRequests(apiMetadata, endpoint, examples) {
  const requests = [];
  const url = createPostmanUrl(endpoint.path);
  
  if (examples.length === 0) {
    return requests;
  }
  
  // 1. Create with minimal required fields
  const minimalData = { ...examples[0].data };
  delete minimalData.id;
  delete minimalData.createdAt;
  delete minimalData.updatedAt;
  
  requests.push({
    name: `Create ${capitalize(singularize(apiMetadata.name))}`,
    request: createRequest('POST', url, minimalData,
      `Create a new ${singularize(apiMetadata.name)} with example data`),
    event: [{
      listen: 'test',
      script: {
        exec: generateTestScript('POST', endpoint).split('\n')
      }
    }]
  });
  
  // 2. Create with different data (if we have multiple examples)
  if (examples.length > 1) {
    const altData = { ...examples[1].data };
    delete altData.id;
    delete altData.createdAt;
    delete altData.updatedAt;
    
    requests.push({
      name: `Create ${capitalize(singularize(apiMetadata.name))} (Alternative)`,
      request: createRequest('POST', url, altData,
        `Create another ${singularize(apiMetadata.name)} with different data`),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('POST', endpoint).split('\n')
        }
      }]
    });
  }
  
  return requests;
}

/**
 * Generate requests for a PATCH endpoint
 */
function generateUpdateRequests(apiMetadata, endpoint, examples) {
  const requests = [];
  
  if (examples.length === 0) {
    return requests;
  }
  
  const example = examples[0];
  const url = createPostmanUrl(endpoint.path);
  const urlWithId = {
    ...url,
    raw: url.raw.replace(/\{\{[^}]+\}\}/, example.data.id),
    path: url.path.map(seg => seg.includes('{{') ? example.data.id : seg)
  };
  
  // 1. Update single field
  const singleFieldUpdate = {};
  const numericField = Object.keys(example.data).find(key => 
    typeof example.data[key] === 'number' && !['id'].includes(key)
  );
  if (numericField) {
    singleFieldUpdate[numericField] = example.data[numericField] + 100;
  }
  
  if (Object.keys(singleFieldUpdate).length > 0) {
    requests.push({
      name: `Update ${capitalize(singularize(apiMetadata.name))} - Single Field`,
      request: createRequest('PATCH', urlWithId, singleFieldUpdate,
        `Update a single field of ${example.name}`),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('PATCH', endpoint).split('\n')
        }
      }]
    });
  }
  
  // 2. Update nested object (if exists)
  const nestedField = Object.keys(example.data).find(key => 
    example.data[key] && typeof example.data[key] === 'object' && 
    !Array.isArray(example.data[key]) &&
    !['id', 'createdAt', 'updatedAt'].includes(key)
  );
  
  if (nestedField) {
    const nestedUpdate = { [nestedField]: example.data[nestedField] };
    requests.push({
      name: `Update ${capitalize(singularize(apiMetadata.name))} - ${capitalize(nestedField)}`,
      request: createRequest('PATCH', urlWithId, nestedUpdate,
        `Update ${nestedField} of ${example.name}`),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('PATCH', endpoint).split('\n')
        }
      }]
    });
  }
  
  // 3. Update multiple fields
  const multiFieldUpdate = {};
  let fieldCount = 0;
  for (const [key, value] of Object.entries(example.data)) {
    if (['id', 'createdAt', 'updatedAt'].includes(key) || fieldCount >= 3) {
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      multiFieldUpdate[key] = value;
      fieldCount++;
    }
  }
  
  if (Object.keys(multiFieldUpdate).length > 1) {
    requests.push({
      name: `Update ${capitalize(singularize(apiMetadata.name))} - Multiple Fields`,
      request: createRequest('PATCH', urlWithId, multiFieldUpdate,
        `Update multiple fields of ${example.name}`),
      event: [{
        listen: 'test',
        script: {
          exec: generateTestScript('PATCH', endpoint).split('\n')
        }
      }]
    });
  }
  
  return requests;
}

/**
 * Generate requests for a DELETE endpoint
 */
function generateDeleteRequests(apiMetadata, endpoint, examples) {
  const requests = [];
  
  if (examples.length === 0) {
    return requests;
  }
  
  const example = examples[examples.length - 1]; // Use last example for delete
  const url = createPostmanUrl(endpoint.path);
  const urlWithId = {
    ...url,
    raw: url.raw.replace(/\{\{[^}]+\}\}/, example.data.id),
    path: url.path.map(seg => seg.includes('{{') ? example.data.id : seg)
  };
  
  requests.push({
    name: `Delete ${capitalize(singularize(apiMetadata.name))}`,
    request: createRequest('DELETE', urlWithId,
      null,
      `Delete ${example.name}`),
    event: [{
      listen: 'test',
      script: {
        exec: generateTestScript('DELETE', endpoint).split('\n')
      }
    }]
  });
  
  return requests;
}

/**
 * Generate all requests for an API
 */
function generateApiRequests(apiMetadata) {
  const examples = extractIndividualResources(loadExamples(apiMetadata.name));
  const items = [];
  
  // Sort endpoints: GET (list), GET (id), POST, PATCH, DELETE
  const sortedEndpoints = [...apiMetadata.endpoints].sort((a, b) => {
    const order = { GET: 0, POST: 1, PATCH: 2, DELETE: 3 };
    const aOrder = order[a.method] || 999;
    const bOrder = order[b.method] || 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    
    // GET list before GET by ID
    if (a.method === 'GET' && b.method === 'GET') {
      return a.path.includes('{') ? 1 : -1;
    }
    return 0;
  });
  
  for (const endpoint of sortedEndpoints) {
    const isCollection = !endpoint.path.includes('{');
    const isItem = endpoint.path.includes('{');
    
    let requests = [];
    
    if (endpoint.method === 'GET' && isCollection) {
      requests = generateListRequests(apiMetadata, endpoint, examples);
    } else if (endpoint.method === 'GET' && isItem) {
      requests = generateGetByIdRequests(apiMetadata, endpoint, examples);
    } else if (endpoint.method === 'POST' && isCollection) {
      requests = generateCreateRequests(apiMetadata, endpoint, examples);
    } else if (endpoint.method === 'PATCH' && isItem) {
      requests = generateUpdateRequests(apiMetadata, endpoint, examples);
    } else if (endpoint.method === 'DELETE' && isItem) {
      requests = generateDeleteRequests(apiMetadata, endpoint, examples);
    }
    
    items.push(...requests);
  }
  
  return items;
}

/**
 * Capitalize first letter
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert plural to singular (simple)
 */
function singularize(str) {
  return str.endsWith('s') ? str.slice(0, -1) : str;
}

/**
 * Generate Postman collection
 */
async function generatePostmanCollection() {
  console.log('='.repeat(70));
  console.log('Postman Collection Generator');
  console.log('='.repeat(70));
  
  // Load API specs
  console.log('\nLoading OpenAPI specifications...');
  const apiSpecs = await loadAllSpecs({ specsDir });
  console.log(`✓ Loaded ${apiSpecs.length} API(s)`);
  
  // Validate specs and examples
  console.log('\nValidating specifications and examples...');
  const discoveredSpecs = discoverApiSpecs({ specsDir });
  const specsWithExamples = discoveredSpecs.map(spec => ({
    ...spec,
    examplesPath: getExamplesPath(spec.name, specsDir)
  }));
  
  const validationResults = await validateAll(specsWithExamples);
  
  // Check for validation errors
  const hasErrors = Object.values(validationResults).some(r => !r.valid);
  
  for (const [apiName, result] of Object.entries(validationResults)) {
    const status = getValidationStatus(result.spec);
    const examplesStatus = getValidationStatus(result.examples);
    
    console.log(`  ${status.emoji} ${apiName}: ${status.message}`);
    if (result.examples.warnings.length > 0 || result.examples.errors.length > 0) {
      console.log(`    Examples: ${examplesStatus.message}`);
    }
  }
  
  if (hasErrors) {
    throw new Error('Validation failed. Run "npm run validate" for detailed errors.');
  }
  
  console.log('✓ Validation passed');
  
  // Check for existing collection to preserve _postman_id
  const outputDir = join(__dirname, '../generated');
  const outputPath = join(outputDir, 'postman-collection.json');
  let existingPostmanId = null;
  
  if (existsSync(outputPath)) {
    try {
      const existingCollection = JSON.parse(readFileSync(outputPath, 'utf8'));
      existingPostmanId = existingCollection?.info?._postman_id;
      if (existingPostmanId) {
        console.log('✓ Preserving existing Postman collection ID');
      }
    } catch (error) {
      // If we can't read/parse the existing file, just generate a new ID
      console.log('⚠ Could not read existing collection, will generate new ID');
    }
  }
  
  // Generate collection
  const collection = {
    info: {
      name: 'Safety Net API Collection',
      description: 'Auto-generated from OpenAPI specifications',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      _postman_id: existingPostmanId || generateUUID()
    },
    item: [],
    variable: [
      {
        key: 'baseUrl',
        value: BASE_URL,
        type: 'string'
      }
    ]
  };
  
  // Add folder for each API
  console.log('\nGenerating requests...');
  for (const api of apiSpecs) {
    console.log(`  Processing ${api.title}...`);
    const requests = generateApiRequests(api);
    console.log(`    Generated ${requests.length} requests`);
    
    collection.item.push({
      name: api.title,
      item: requests,
      description: api.title
    });
    
    // Add resource ID variables
    const examples = extractIndividualResources(loadExamples(api.name));
    if (examples.length > 0) {
      const varName = `${singularize(api.name)}Id`;
      collection.variable.push({
        key: varName,
        value: examples[0].data.id,
        type: 'string'
      });
    }
  }
  
  // Write output
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  
  writeFileSync(outputPath, JSON.stringify(collection, null, 2));
  
  console.log('\n' + '='.repeat(70));
  console.log('✓ Postman collection generated successfully!');
  console.log('='.repeat(70));
  console.log(`\nOutput: ${outputPath}`);
  console.log(`\nTotal APIs: ${apiSpecs.length}`);
  console.log(`Total Requests: ${collection.item.reduce((sum, api) => sum + api.item.length, 0)}`);
  console.log(`\nTo import:`);
  console.log(`1. Open Postman`);
  console.log(`2. Click Import`);
  console.log(`3. Select the file: ${outputPath}`);
  console.log(`4. Click Import`);
  console.log(`\nBase URL variable: ${BASE_URL}`);
  console.log('');
}

/**
 * Generate a simple UUID for Postman collection
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Run generator
generatePostmanCollection().catch(error => {
  console.error('\n❌ Generation failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});

