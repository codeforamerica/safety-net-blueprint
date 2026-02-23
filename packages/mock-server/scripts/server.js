#!/usr/bin/env node
/**
 * Mock API Server
 * Dynamic Express server that automatically discovers and serves OpenAPI specifications
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import { realpathSync } from 'fs';
import { resolve } from 'path';
import { performSetup } from '../src/setup.js';
import { registerAllRoutes } from '../src/route-generator.js';
import { closeAll } from '../src/database-manager.js';
import { validateJSON } from '../src/validator.js';

const HOST = process.env.MOCK_SERVER_HOST || 'localhost';
const PORT = parseInt(process.env.MOCK_SERVER_PORT || '1080', 10);

function parseSpecsDirs() {
  const args = process.argv.slice(2);
  const specsDirs = args
    .filter(a => a.startsWith('--specs='))
    .map(a => resolve(a.split('=')[1]));
  if (specsDirs.length === 0) {
    console.error('Error: --specs=<dir> is required (may be repeated).\n');
    console.error('Usage: node scripts/server.js --specs=<dir> [--specs=<dir2> ...]');
    process.exit(1);
  }
  return specsDirs;
}

let expressServer = null;

/**
 * Start the mock server
 */
async function startMockServer() {
  console.log('='.repeat(70));
  console.log('🚀 Starting Mock API Server');
  console.log('='.repeat(70));
  
  try {
    // Perform setup (load specs and seed databases) for each specs directory
    const specsDirs = parseSpecsDirs();
    let apiSpecs = [];
    for (const specsDir of specsDirs) {
      const result = await performSetup({ specsDir, verbose: true });
      apiSpecs = apiSpecs.concat(result.apiSpecs);
    }
    
    // Create Express app
    const app = express();
    
    // Middleware
    app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true
    }));
    
    app.use(express.json());
    
    // JSON parse error handler
    app.use(validateJSON);
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', apis: apiSpecs.map(a => a.name) });
    });

    // Manifest endpoint — returns full API metadata for dynamic discovery
    app.get('/_manifest', (req, res) => {
      res.json({ apis: apiSpecs });
    });
    
    // Register API routes dynamically
    const baseUrl = `http://${HOST}:${PORT}`;
    const allEndpoints = registerAllRoutes(app, apiSpecs, baseUrl);
    
    // 404 handler for undefined routes
    app.use((req, res) => {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'The requested endpoint does not exist'
      });
    });
    
    // Global error handler
    app.use((err, req, res, next) => {
      console.error('Unhandled error:', err);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: err.message }]
      });
    });
    
    // Start Express server
    expressServer = app.listen(PORT, HOST, () => {
      console.log('\n' + '='.repeat(70));
      console.log('✓ Mock API Server Started Successfully!');
      console.log('='.repeat(70));
      console.log(`\n📡 Mock Server:    http://${HOST}:${PORT}`);
      console.log(`❤️  Health Check:   http://${HOST}:${PORT}/health`);
    });
    
    // Display available endpoints
    console.log('\n' + '='.repeat(70));
    console.log('Available Endpoints:');
    console.log('='.repeat(70));
    
    for (const api of allEndpoints) {
      console.log(`\n${api.title}:`);
      
      // Group by method
      const byMethod = {};
      for (const endpoint of api.endpoints) {
        if (!byMethod[endpoint.method]) {
          byMethod[endpoint.method] = [];
        }
        byMethod[endpoint.method].push(endpoint);
      }
      
      // Display in order: GET, POST, PATCH, DELETE
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        if (byMethod[method]) {
          for (const endpoint of byMethod[method]) {
            console.log(`  ${endpoint.method.padEnd(6)} http://${HOST}:${PORT}${endpoint.path}`);
          }
        }
      }
    }
    
    // Example curl commands
    console.log('\n' + '='.repeat(70));
    console.log('Example Commands:');
    console.log('='.repeat(70));
    
    for (const api of allEndpoints) {
      const listEndpoint = api.endpoints.find(e => e.method === 'GET' && !e.path.includes('{'));
      if (listEndpoint) {
        console.log(`  curl http://${HOST}:${PORT}${listEndpoint.path}`);
      }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('\n✓ Server ready to accept requests!\n');
    
  } catch (error) {
    console.error('\n❌ Failed to start mock server:', error.message);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Stop the server gracefully
 */
async function stopServer(exitProcess = true) {
  console.log('\n\nStopping server...');
  
  try {
    // Close databases
    closeAll();
    console.log('✓ Databases closed');
    
    // Stop Express server
    if (expressServer) {
      return new Promise((resolve) => {
        expressServer.close(() => {
          console.log('✓ Mock server stopped');
          expressServer = null;
          resolve();
        });
      });
    }
  } catch (error) {
    console.error('Error stopping server:', error);
  }
  
  if (exitProcess) {
    process.exit(0);
  }
}

/**
 * Check if server is already running on the specified port
 */
async function isServerRunning(host = HOST, port = PORT) {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/`, (res) => {
      resolve(true);
    });
    req.on('error', () => {
      resolve(false);
    });
    req.end();
  });
}

// Export for programmatic use
export { startMockServer, stopServer, isServerRunning };

// Only auto-start if run directly (not imported)
// Note: On Windows, realpathSync returns backslashes while import.meta.url uses forward slashes,
// so we normalize both to forward slashes for comparison.
const entryPath = process.argv[1] ? `file:///${realpathSync(process.argv[1]).replace(/\\/g, '/')}` : '';
if (import.meta.url === entryPath) {
  // Handle graceful shutdown
  process.on('SIGINT', () => stopServer(true));
  process.on('SIGTERM', () => stopServer(true));
  
  // Start the server
  startMockServer();
}
