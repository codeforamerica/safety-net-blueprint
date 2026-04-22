#!/usr/bin/env node
/**
 * build.js
 *
 * Orchestrates the full context map build:
 *   1. render.js  → generates output/*.svg
 *   2. build-html.js → assembles output/context-map.html
 *
 * Usage:
 *   node build.js
 */

import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

function run(script, ...args) {
  execFileSync(node, [resolve(__dirname, script), ...args], { stdio: 'inherit' });
}

run('render.js');
run('build-html.js');
