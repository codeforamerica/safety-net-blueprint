#!/usr/bin/env node
/**
 * Start both mock server and Swagger UI simultaneously
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('='.repeat(70));
console.log('Starting Mock Server & Swagger UI');
console.log('='.repeat(70));
console.log('\nPress Ctrl+C to stop both servers\n');

// Start mock server
console.log('Starting Mock Server on http://localhost:1080...');
const mockServer = spawn('node', [join(__dirname, 'mock-server/server.js')], {
  stdio: 'inherit',
  shell: true
});

// Wait a moment for mock server to start
await new Promise(resolve => setTimeout(resolve, 2000));

// Start Swagger UI
console.log('\nStarting Swagger UI on http://localhost:3000...');
const swaggerServer = spawn('node', [join(__dirname, 'swagger/server.js')], {
  stdio: 'inherit',
  shell: true
});

// Handle process termination
const cleanup = (signal) => {
  console.log(`\n\nReceived ${signal}, stopping servers...`);
  mockServer.kill();
  swaggerServer.kill();
  process.exit(0);
};

process.on('SIGINT', () => cleanup('SIGINT'));
process.on('SIGTERM', () => cleanup('SIGTERM'));

// Handle server errors
mockServer.on('error', (error) => {
  console.error('Mock server error:', error);
  swaggerServer.kill();
  process.exit(1);
});

swaggerServer.on('error', (error) => {
  console.error('Swagger server error:', error);
  mockServer.kill();
  process.exit(1);
});

// Handle server exits
mockServer.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Mock server exited with code ${code}`);
    swaggerServer.kill();
    process.exit(code);
  }
});

swaggerServer.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Swagger server exited with code ${code}`);
    mockServer.kill();
    process.exit(code);
  }
});
