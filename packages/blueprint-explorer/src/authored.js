#!/usr/bin/env node
/**
 * Authored pages build.
 *
 * Copies blueprint-explorer/authored/ into <contentDir>/authored/.
 * These are universal pages (adoption model, executive summary) that apply
 * to any state deployment.
 *
 * Usage:
 *   node authored.js --content=<path>
 */

import { cpSync, rmSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const authoredDir = resolve(__dirname, '..', 'authored');

const contentArg = process.argv.find(a => a.startsWith('--content='));
if (!contentArg) {
  console.error('Usage: node authored.js --content=<path>');
  process.exit(1);
}
const contentDir = resolve(process.cwd(), contentArg.slice('--content='.length));

const outDir = join(contentDir, 'authored');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(authoredDir, outDir, { recursive: true });
console.log('  wrote authored/');
