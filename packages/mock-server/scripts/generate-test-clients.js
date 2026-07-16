#!/usr/bin/env node
/**
 * Generate TypeScript API clients from the resolved specs for use in integration tests.
 *
 * Output goes to tests/generated/ (gitignored). Integration tests import from there
 * to get typed SDK functions with built-in zod response validation.
 *
 * Run via: npm run clients:generate
 * Called automatically by: npm run test:integration, npm run test:all
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..', '..');
const specDir = join(__dirname, '..', '..', 'resolved');
const outDir = join(__dirname, '..', 'tests', 'generated');
const generatorScript = join(__dirname, '..', '..', 'clients', 'scripts', 'generate-clients-typescript.js');

const child = spawn(
  process.execPath,
  [generatorScript, `--spec=${specDir}`, `--out=${outDir}`],
  { stdio: 'inherit' }
);

child.on('close', code => process.exit(code ?? 0));
child.on('error', err => { console.error(err.message); process.exit(1); });
