#!/usr/bin/env node
/**
 * Start both mock API server (backend + forms) and Vite dev server together.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packagesDir = join(__dirname, '..', '..');

console.log('='.repeat(70));
console.log('Starting Safety Harness (Mock API + Vite Dev Server)');
console.log('='.repeat(70));
console.log('\nPress Ctrl+C to stop both servers\n');

// Start mock server with backend contracts and forms specs
// --specs paths are resolved by path.resolve() inside the mock server,
// so they are relative to the mock server's CWD.
const mockServerScript = join(packagesDir, 'mock-server', 'scripts', 'server.js');
const mockServerCwd = join(packagesDir, 'mock-server');
console.log('Starting Mock Server on http://localhost:1080...');
const mockServer = spawn('node', [
  mockServerScript,
  '--specs=../contracts',
], {
  stdio: 'inherit',
  shell: true,
  cwd: mockServerCwd
});

// Wait for mock server to initialize before starting Vite
await new Promise(resolve => setTimeout(resolve, 2000));

// Start Vite dev server
console.log('\nStarting Vite dev server...');
const viteServer = spawn('npx', ['vite'], {
  stdio: 'inherit',
  shell: true,
  cwd: join(__dirname, '..')
});

// Handle process termination
const cleanup = (signal) => {
  console.log(`\n\nReceived ${signal}, stopping servers...`);
  mockServer.kill();
  viteServer.kill();
  process.exit(0);
};

process.on('SIGINT', () => cleanup('SIGINT'));
process.on('SIGTERM', () => cleanup('SIGTERM'));

// Handle server errors
mockServer.on('error', (error) => {
  console.error('Mock server error:', error);
  viteServer.kill();
  process.exit(1);
});

viteServer.on('error', (error) => {
  console.error('Vite server error:', error);
  mockServer.kill();
  process.exit(1);
});

// Handle server exits
mockServer.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Mock server exited with code ${code}`);
    viteServer.kill();
    process.exit(code);
  }
});

viteServer.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Vite server exited with code ${code}`);
    mockServer.kill();
    process.exit(code);
  }
});
