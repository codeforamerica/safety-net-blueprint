#!/usr/bin/env node
/**
 * build.js
 *
 * Orchestrates the full context map build:
 *   1. render.js     → generates HTML fragments → dist/
 *   2. build-html.js → assembles output/context-map.html from dist/
 *   3. scan-gaps.js  → reports design gaps from config.yaml
 *   4. export-png.js → screenshots each view → dist/*.png, output/context-map-export.zip
 *
 * Usage:
 *   node build.js
 */

import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const node    = process.execPath;
const distDir = resolve(__dirname, 'dist');
const outDir  = resolve(__dirname, 'output');

function run(script, ...args) {
  execFileSync(node, [resolve(__dirname, script), ...args], { stdio: 'inherit' });
}

run('render.js',     distDir);
run('build-html.js', distDir, outDir);
run('scan-gaps.js');
run('export-png.js', outDir, distDir);
