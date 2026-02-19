#!/usr/bin/env node
/**
 * Swagger UI Server
 * Auto-discovers and serves OpenAPI specifications with Swagger UI
 */

import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { discoverApiSpecs } from '@codeforamerica/safety-net-blueprint-contracts/loader';

function parseSpecsDir() {
  const args = process.argv.slice(2);
  const specsArg = args.find(a => a.startsWith('--specs='));
  if (!specsArg) {
    console.error('Error: --specs=<dir> is required.\n');
    console.error('Usage: node scripts/swagger/server.js --specs=<dir>');
    process.exit(1);
  }
  return resolve(specsArg.split('=')[1]);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HOST = process.env.SWAGGER_HOST || 'localhost';
const PORT = parseInt(process.env.SWAGGER_PORT || '3000', 10);
const MOCK_SERVER_URL = process.env.MOCK_SERVER_URL || 'http://localhost:1080';

/**
 * Load and prepare an OpenAPI spec for Swagger UI
 * @param {string} specPath - Path to the OpenAPI spec file
 * @param {string} apiName - Name of the API
 * @returns {Promise<Object>} Dereferenced and modified OpenAPI spec
 */
async function loadAndPrepareSpec(specPath, apiName) {
  try {
    // Dereference all $refs
    const spec = await $RefParser.dereference(specPath, {
      dereference: {
        circular: 'ignore'
      }
    });
    
    // Override servers array to point to mock server (in-memory only)
    spec.servers = [
      {
        url: MOCK_SERVER_URL,
        description: 'Mock Server'
      },
      ...(spec.servers || [])
    ];
    
    return spec;
  } catch (error) {
    console.error(`Error loading spec for ${apiName}:`, error.message);
    throw error;
  }
}

/**
 * Create a landing page HTML with links to all APIs
 * @param {Array} apis - Array of API info objects
 * @returns {string} HTML content
 */
function createLandingPage(apis) {
  const apiLinks = apis.map(api => 
    `<li><a href="/${api.name}">${api.title}</a></li>`
  ).join('\n          ');
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Documentation</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
      background: #fafafa;
    }
    h1 {
      color: #333;
      border-bottom: 2px solid #49cc90;
      padding-bottom: 10px;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    ul {
      list-style: none;
      padding: 0;
    }
    li {
      margin: 15px 0;
    }
    a {
      color: #49cc90;
      text-decoration: none;
      font-size: 18px;
      padding: 10px 15px;
      display: block;
      background: #f5f5f5;
      border-radius: 4px;
      transition: all 0.3s;
    }
    a:hover {
      background: #49cc90;
      color: white;
      transform: translateX(5px);
    }
    .info {
      background: #e3f2fd;
      padding: 15px;
      border-radius: 4px;
      margin-top: 20px;
      border-left: 4px solid #2196f3;
    }
    .info strong {
      color: #1976d2;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📚 API Documentation</h1>
    <p>Select an API to view its documentation and try out endpoints:</p>
    <ul>
${apiLinks}
    </ul>
    <div class="info">
      <strong>Mock Server:</strong> ${MOCK_SERVER_URL}<br>
      <strong>Note:</strong> Make sure the mock server is running before using "Try it out" buttons.
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Start the Swagger UI server
 */
async function startSwaggerServer() {
  console.log('='.repeat(70));
  console.log('📚 Starting Swagger UI Server');
  console.log('='.repeat(70));
  
  try {
    // Discover all API specs
    const specsDir = parseSpecsDir();
    const apiSpecs = discoverApiSpecs({ specsDir });
    
    if (apiSpecs.length === 0) {
      console.error('\n❌ No API specifications found in specs directory');
      process.exit(1);
    }
    
    console.log(`\nFound ${apiSpecs.length} API specification(s):`);
    apiSpecs.forEach(api => console.log(`  - ${api.name}`));
    
    // Load all specs
    const loadedApis = [];
    for (const apiSpec of apiSpecs) {
      try {
        const spec = await loadAndPrepareSpec(apiSpec.specPath, apiSpec.name);
        loadedApis.push({
          name: apiSpec.name,
          title: spec.info?.title || apiSpec.name,
          spec: spec
        });
        console.log(`  ✓ Loaded ${apiSpec.name}`);
      } catch (error) {
        console.error(`  ✗ Failed to load ${apiSpec.name}:`, error.message);
      }
    }
    
    if (loadedApis.length === 0) {
      console.error('\n❌ Failed to load any API specifications');
      process.exit(1);
    }
    
    // Create Express app
    const app = express();
    
    // Serve landing page at root
    app.get('/', (req, res) => {
      res.send(createLandingPage(loadedApis));
    });
    
    // Serve Swagger UI for each API
    for (const api of loadedApis) {
      const swaggerOptions = {
        swaggerOptions: {
          url: `/${api.name}/spec.json`,
          displayRequestDuration: true,
          persistAuthorization: true,
          tryItOutEnabled: true
        }
      };
      
      // Serve the spec as JSON
      app.get(`/${api.name}/spec.json`, (req, res) => {
        res.json(api.spec);
      });
      
      // Serve Swagger UI
      app.use(`/${api.name}`, swaggerUi.serveFiles(api.spec, swaggerOptions), swaggerUi.setup(api.spec, swaggerOptions));
    }
    
    // Start server
    app.listen(PORT, HOST, () => {
      console.log('\n' + '='.repeat(70));
      console.log('✓ Swagger UI Server Started Successfully!');
      console.log('='.repeat(70));
      console.log(`\n📚 Documentation:  http://${HOST}:${PORT}`);
      console.log(`📡 Mock Server:    ${MOCK_SERVER_URL}`);
      console.log('\n' + '='.repeat(70));
      console.log('API Documentation URLs:');
      console.log('='.repeat(70));
      
      for (const api of loadedApis) {
        console.log(`  ${api.title.padEnd(30)} http://${HOST}:${PORT}/${api.name}`);
      }
      
      console.log('\n' + '='.repeat(70));
      console.log('\n💡 Tip: Start the mock server first with: npm run mock:start');
      console.log('    Then use "Try it out" buttons in Swagger UI to test endpoints.\n');
    });
    
  } catch (error) {
    console.error('\n❌ Failed to start Swagger UI server:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nStopping Swagger UI server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\nStopping Swagger UI server...');
  process.exit(0);
});

// Start the server
startSwaggerServer();


