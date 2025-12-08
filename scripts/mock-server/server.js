/**
 * Mock API Server
 * Dynamic Express server that automatically discovers and serves OpenAPI specifications
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import { performSetup } from '../../src/mock-server/setup.js';
import { registerAllRoutes } from '../../src/mock-server/route-generator.js';
import { closeAll } from '../../src/mock-server/database-manager.js';
import { validateJSON } from '../../src/mock-server/validator.js';

const HOST = process.env.MOCK_SERVER_HOST || 'localhost';
const PORT = parseInt(process.env.MOCK_SERVER_PORT || '1080', 10);

let expressServer = null;

/**
 * Start the mock server
 */
async function startMockServer() {
  console.log('='.repeat(70));
  console.log('🚀 Starting Mock API Server');
  console.log('='.repeat(70));
  
  try {
    // Perform setup (load specs and seed databases)
    const { apiSpecs } = await performSetup({ verbose: true });
    
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
if (import.meta.url === `file://${process.argv[1]}`) {
  // Handle graceful shutdown
  process.on('SIGINT', () => stopServer(true));
  process.on('SIGTERM', () => stopServer(true));
  
  // Start the server
  startMockServer();
}
