#!/usr/bin/env node
/**
 * build.js
 *
 * Consolidated explorer build. Resolves config + contracts annotations once
 * and passes the enriched config to all sub-tools that depend on it.
 *
 * Usage:
 *   node build.js                              # build everything
 *   node build.js --only=context-map
 *   node build.js --only=data-dictionaries
 *   node build.js --only=state-machine-docs
 *   node build.js --only=adoption-model
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';
import { resolveConfig } from './src/resolve-config.js';
import { scanGaps } from './src/scan-gaps.js';
import { renderContextMap } from './diagrams/context-map/src/render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

const args    = process.argv.slice(2);
const onlyArg = args.find(a => a.startsWith('--only='));
const only    = onlyArg ? onlyArg.slice('--only='.length) : null;

const doBuild = tool => !only || only === tool;

const buildContextMap  = doBuild('context-map');
const buildSeqDiagrams = doBuild('sequence-diagrams');

// ── Resolve config once — shared by tools that depend on config.yaml ──────────

let enrichedConfig;
if (buildContextMap) {
  enrichedConfig = resolveConfig();
}

// ── Context map ───────────────────────────────────────────────────────────────

if (buildContextMap) {
  const mapConfig = yaml.load(
    readFileSync(resolve(__dirname, 'diagrams', 'context-map', 'config', 'config.yaml'), 'utf8')
  );
  const distDir = resolve(__dirname, 'diagrams', 'context-map', 'dist');
  const outDir  = resolve(__dirname, 'diagrams', 'context-map');

  renderContextMap(enrichedConfig, mapConfig, distDir);
  execFileSync(node, [resolve(__dirname, 'diagrams', 'context-map', 'src', 'build-html.js'), distDir, outDir], { stdio: 'inherit' });
  scanGaps(enrichedConfig);
}

// ── Sequence diagrams ─────────────────────────────────────────────────────────

if (buildSeqDiagrams) {
  const seqSrcDir = resolve(__dirname, 'diagrams', 'sequence-diagrams', 'src');
  const seqOutDir = resolve(__dirname, 'diagrams', 'sequence-diagrams');
  execFileSync(node, [resolve(seqSrcDir, 'render-action-flow.js'), seqOutDir], { stdio: 'inherit' });
  execFileSync(node, [resolve(seqSrcDir, 'build-phases-html.js'), null, seqOutDir], { stdio: 'inherit' });
}

// ── Data explorer (reads contracts directly — subprocess) ─────────────────────

if (doBuild('data-dictionaries')) {
  const contractsDir = resolve(__dirname, '..', 'contracts');
  const domains = readdirSync(contractsDir)
    .filter(f => f.endsWith('-openapi.yaml'))
    .map(f => f.replace('-openapi.yaml', ''));
  const generateDataModel = resolve(__dirname, 'tools', 'data-dictionaries', 'generate-field-inventory.mjs');
  for (const domain of domains) {
    try {
      execFileSync(node, [generateDataModel, `--domain=${domain}`], { stdio: 'inherit' });
    } catch {
      // Domain doesn't have the right structure for data model generation — skip
    }
  }
  execFileSync(node, [resolve(__dirname, 'tools', 'data-dictionaries', 'build.js')], { stdio: 'inherit' });
}

// ── State machine docs (reads contracts directly — subprocess) ────────────────

if (doBuild('state-machine-docs')) {
  execFileSync(node, [resolve(__dirname, 'tools', 'state-machine-docs', 'build.js')], { stdio: 'inherit' });
}

if (doBuild('event-catalog')) {
  execFileSync(node, [resolve(__dirname, 'tools', 'event-catalog', 'build.js')], { stdio: 'inherit' });
}
