#!/usr/bin/env node
/**
 * Context map build.
 *
 * Resolves config, renders SVGs, builds the HTML page, and reports gaps.
 * Called by the main build.js as a subprocess.
 *
 * Usage:
 *   node build.js --content=<path> [--resolved=<path>]
 */

import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';
import { resolveConfig } from './resolve-config.js';
import { scanGaps } from './scan-gaps.js';
import { renderContextMap } from './render.js';
import { resolvedDir } from '../lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

const contentArg = process.argv.find(a => a.startsWith('--content='));
if (!contentArg) {
  console.error('Usage: node build.js --content=<path> [--resolved=<path>]');
  process.exit(1);
}
const contentDir = resolve(process.cwd(), contentArg.slice('--content='.length));

const mapConfigPath = resolve(contentDir, 'context-map', 'config', 'config.yaml');
const mapConfig = yaml.load(readFileSync(mapConfigPath, 'utf8'));
const outDir  = resolve(contentDir, 'context-map');

const enrichedConfig = resolveConfig(resolvedDir, contentDir);

// Render SVG fragments to a temp dir, then build HTML into outDir.
// Using a temp dir avoids writing intermediate fragments into the content tree.
const fragDir = mkdtempSync(join(tmpdir(), 'context-map-'));
try {
  renderContextMap(enrichedConfig, mapConfig, fragDir);
  execFileSync(node, [
    resolve(__dirname, 'build-html.js'),
    fragDir, outDir, `--config=${mapConfigPath}`, `--content=${contentDir}`,
  ], { stdio: 'inherit' });
} finally {
  rmSync(fragDir, { recursive: true, force: true });
}
const archDir = resolve(__dirname, '..', '..', '..', '..', '..', 'docs', 'architecture', 'domains');
scanGaps(enrichedConfig, resolvedDir, archDir);
