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
 *   node build.js --only=event-catalog
 *   node build.js --only=api-reference
 *
 * State customization (overlay-aware build):
 *   node build.js --resolved=/path/to/state/resolved
 *
 *   --content   Path to the content package directory (safety-net-explorer or equivalent).
 *               Contains diagram configs and output HTML. Defaults to ../safety-net-explorer.
 *   --resolved  Path to a directory of resolved OpenAPI + state machine files
 *               (output of the contracts resolve pipeline with state overlays applied).
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './src/lib/config.js';

import { build as buildAnnotationsExplorer } from './src/annotations-explorer/build.js';
import { build as buildContextMap }       from './src/context-map/build.js';
import { build as buildDataDictionaries } from './src/data-dictionaries/build.js';
import { build as buildStateMachineDocs } from './src/state-machine-docs/build.js';
import { build as buildRulesDocs }        from './src/rules-docs/build.js';
import { build as buildEventCatalog }     from './src/event-catalog.js';
import { build as buildApiReference }     from './src/api-reference.js';
import { build as buildTryIt }            from './src/try-it/build.js';
import { build as buildHub }              from './src/hub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args        = process.argv.slice(2);
const onlyArg     = args.find(a => a.startsWith('--only='));
const only        = onlyArg ? onlyArg.slice('--only='.length) : null;
const contentArg  = args.find(a => a.startsWith('--content='));
const resolvedArg = args.find(a => a.startsWith('--resolved='));

if (!contentArg || !resolvedArg) {
  console.error('Usage: node build.js --content=<path> --resolved=<path> [--only=<tool>]');
  process.exit(1);
}

const contentDir = resolve(process.cwd(), contentArg.slice('--content='.length));
const resolvedDir = resolve(process.cwd(), resolvedArg.slice('--resolved='.length));

// Validate config early — fails fast before any tools run.
loadConfig(contentDir);

const doBuild = tool => !only || only === tool;

// ── Annotations explorer ──────────────────────────────────────────────────────

if (doBuild('annotations-explorer')) {
  buildAnnotationsExplorer({ contentDir, resolvedDir });
}

// ── Context map ───────────────────────────────────────────────────────────────

if (doBuild('context-map')) {
  buildContextMap({ contentDir, resolvedDir });
}

// ── Data dictionaries ─────────────────────────────────────────────────────────

if (doBuild('data-dictionaries')) {
  await buildDataDictionaries({ contentDir, resolvedDir });
}

// ── State machine docs ────────────────────────────────────────────────────────

if (doBuild('state-machine-docs')) {
  buildStateMachineDocs({ contentDir, resolvedDir });
}

// ── Rules docs ────────────────────────────────────────────────────────────────

if (doBuild('rules-docs')) {
  buildRulesDocs({ contentDir, resolvedDir });
}

// ── Event catalog ─────────────────────────────────────────────────────────────

if (doBuild('event-catalog')) {
  buildEventCatalog({ contentDir, resolvedDir });
}

// ── API reference ─────────────────────────────────────────────────────────────

if (doBuild('api-reference')) {
  await buildApiReference({ contentDir, resolvedDir });
}

// ── Try it out ────────────────────────────────────────────────────────────────

if (doBuild('try-it')) {
  buildTryIt({ contentDir, resolvedDir });
}

// Hub is always rebuilt last so it can scan all tool output directories
buildHub({ contentDir });
