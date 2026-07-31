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

import { readFileSync, readdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';
import { resolveConfig } from './src/resolve-config.js';
import { scanGaps } from './src/scan-gaps.js';
import { renderContextMap } from './diagrams/context-map/src/render.js';
import { resolvedDir } from './lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

const args        = process.argv.slice(2);
const onlyArg     = args.find(a => a.startsWith('--only='));
const only        = onlyArg ? onlyArg.slice('--only='.length) : null;
const resolvedArg = args.find(a => a.startsWith('--resolved='));
const clientsArg  = args.find(a => a.startsWith('--clients='));

// Args forwarded to all subprocesses that respect them.
const fwdResolved = resolvedArg ? [resolvedArg] : [];
const fwdClients  = clientsArg  ? [clientsArg]  : [];

const doBuild = tool => !only || only === tool;

const buildContextMap  = doBuild('context-map');
const buildSeqDiagrams = doBuild('sequence-diagrams');

// ── Resolve config once — shared by tools that depend on config.yaml ──────────

let enrichedConfig;
if (buildContextMap) {
  enrichedConfig = resolveConfig(resolvedDir);
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
  execFileSync(node, [resolve(seqSrcDir, 'render-action-flow.js'), seqOutDir, ...fwdResolved], { stdio: 'inherit' });
  execFileSync(node, [resolve(seqSrcDir, 'build-phases-html.js'), null, seqOutDir, ...fwdResolved], { stdio: 'inherit' });
}

// ── Data explorer (reads contracts directly — subprocess) ─────────────────────

if (doBuild('data-dictionaries')) {
  // Clean stale field inventories before regenerating — build.js reads these,
  // so they must be cleaned before the generator runs, not inside build.js itself.
  const ddDir = resolve(__dirname, 'tools', 'data-dictionaries');
  readdirSync(ddDir)
    .filter(f => f.endsWith('-field-inventory.yaml'))
    .forEach(f => rmSync(resolve(ddDir, f)));

  const domains = readdirSync(resolvedDir)
    .filter(f => f.endsWith('-openapi.yaml'))
    .map(f => f.replace('-openapi.yaml', ''));
  const generateDataModel = resolve(__dirname, 'tools', 'data-dictionaries', 'generate-field-inventory.mjs');
  for (const domain of domains) {
    try {
      execFileSync(node, [generateDataModel, `--domain=${domain}`, `--spec=${resolvedDir}`], { stdio: 'inherit' });
    } catch {
      // Domain doesn't have the right structure for data model generation — skip
    }
  }
  execFileSync(node, [resolve(__dirname, 'tools', 'data-dictionaries', 'build.js'), ...fwdResolved], { stdio: 'inherit' });
}

// ── State machine docs (reads contracts directly — subprocess) ────────────────

if (doBuild('state-machine-docs')) {
  execFileSync(node, [resolve(__dirname, 'tools', 'state-machine-docs', 'build.js'), ...fwdResolved], { stdio: 'inherit' });
}

if (doBuild('event-catalog')) {
  execFileSync(node, [resolve(__dirname, 'tools', 'event-catalog', 'build.js'), ...fwdResolved], { stdio: 'inherit' });
}

if (doBuild('api-reference')) {
  execFileSync(node, [resolve(__dirname, 'tools', 'api-reference', 'build.js'), ...fwdResolved], { stdio: 'inherit' });
}

if (doBuild('client-reference')) {
  execFileSync(node, [resolve(__dirname, 'tools', 'client-reference', 'build.js'), ...fwdResolved, ...fwdClients], { stdio: 'inherit' });
}

// Hub is always rebuilt last so it can scan all tool output directories
execFileSync(node, [resolve(__dirname, 'build-hub.js')], { stdio: 'inherit' });
