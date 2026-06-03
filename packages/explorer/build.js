#!/usr/bin/env node
/**
 * build.js
 *
 * Consolidated explorer build. Resolves config + contracts annotations once
 * and passes the enriched config to all sub-tools that depend on it. Shares a
 * single Puppeteer browser across all PNG exports.
 *
 * Usage:
 *   node build.js                              # build everything
 *   node build.js --only=context-map
 *   node build.js --only=scenarios             # service blueprints + sequence diagrams
 *   node build.js --only=data-explorer
 *   node build.js --only=state-machine-docs
 *   node build.js --only=adoption-model
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';
import { resolveConfig } from './src/resolve-config.js';
import { scanGaps } from './src/scan-gaps.js';
import { renderContextMap } from './context-map/src/render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

const args    = process.argv.slice(2);
const onlyArg = args.find(a => a.startsWith('--only='));
const only    = onlyArg ? onlyArg.slice('--only='.length) : null;

const doBuild = tool => !only || only === tool;

const buildContextMap    = doBuild('context-map');
const buildAdoptionModel = doBuild('adoption-model');

// ── Resolve config once — shared by tools that depend on config.yaml ──────────

let enrichedConfig;
if (buildContextMap) {
  enrichedConfig = resolveConfig();
}

// ── Launch Puppeteer browser once — shared across all PNG exports ─────────────

let browser = null;
if (!process.env.CI && (buildContextMap || buildAdoptionModel)) {
  try {
    const puppeteer = (await import('puppeteer')).default;
    browser = await puppeteer.launch({ headless: 'new' });
  } catch {
    console.warn('puppeteer not installed — skipping PNG exports. Run: npm install puppeteer');
  }
}

// ── Context map ───────────────────────────────────────────────────────────────

if (buildContextMap) {
  const mapConfig = yaml.load(
    readFileSync(resolve(__dirname, 'context-map', 'config', 'config.yaml'), 'utf8')
  );
  const distDir = resolve(__dirname, 'context-map', 'dist');
  const outDir  = resolve(__dirname, 'context-map', 'output');

  renderContextMap(enrichedConfig, mapConfig, distDir);
  execFileSync(node, [resolve(__dirname, 'context-map', 'src', 'build-html.js'), distDir, outDir], { stdio: 'inherit' });
  scanGaps(enrichedConfig);

  if (browser) {
    const { exportContextMapPngs } = await import('./context-map/src/export-png.js');
    await exportContextMapPngs(browser, outDir, distDir);
  }
}

// ── Data explorer (reads contracts directly — subprocess) ─────────────────────

if (doBuild('data-explorer')) {
  execFileSync(node, [resolve(__dirname, 'data-explorer', 'build.js')], { stdio: 'inherit' });
}

// ── State machine docs (reads contracts directly — subprocess) ────────────────

if (doBuild('state-machine-docs')) {
  execFileSync(node, [resolve(__dirname, 'state-machine-docs', 'build.js')], { stdio: 'inherit' });
}

// ── Scenario diagrams (reads contracts directly — subprocess) ─────────────────

if (doBuild('scenarios')) {
  execFileSync(node, [resolve(__dirname, 'scenarios', 'build.js')], { stdio: 'inherit' });
}

// ── Adoption model PNG export ─────────────────────────────────────────────────

if (buildAdoptionModel && browser) {
  const { exportAdoptionModelPngs } = await import('./adoption-model/src/export-png.js');
  await exportAdoptionModelPngs(browser);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

if (browser) {
  await browser.close();
}
