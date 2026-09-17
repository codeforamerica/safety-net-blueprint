#!/usr/bin/env node
/**
 * build-explorer.js
 *
 * Builds the Blueprint Explorer static site by invoking each rendering tool
 * from the @codeforamerica/blueprint-explorer package.
 *
 * Usage:
 *   node scripts/build-explorer.js --spec=<resolved-dir> --out=<content-dir>
 *   node scripts/build-explorer.js --spec=<path> --out=<path> --only=rules-docs
 *
 *   --spec     Path to resolved contracts directory (output of blueprint-resolve)
 *   --out      Path to the content directory — contains config.yaml and receives HTML output
 *   --clients  Path to generated TypeScript clients (output of blueprint-generate-ts-clients)
 *   --only     Build one tool only: context-map, sequence-diagrams, data-dictionaries,
 *              state-machine-docs, rules-docs, event-catalog, api-reference, client-reference
 */

import { readdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const args       = process.argv.slice(2);
const onlyArg    = args.find(a => a.startsWith('--only='));
const only       = onlyArg ? onlyArg.slice('--only='.length) : null;
const specArg    = args.find(a => a.startsWith('--spec='));
const outArg     = args.find(a => a.startsWith('--out='));
const clientsArg = args.find(a => a.startsWith('--clients='));

if (!specArg || !outArg) {
  console.error('Usage: node build-explorer.js --spec=<resolved-dir> --out=<content-dir> [--clients=<path>] [--only=<tool>]');
  process.exit(1);
}

// Resolve blueprint-explorer's install directory — works both in the monorepo
// (via workspace symlinks) and when installed from npm.
const explorerDir = dirname(require.resolve('@codeforamerica/blueprint-explorer/package.json'));

const node       = process.execPath;
const specDir    = resolve(process.cwd(), specArg.slice('--spec='.length));
const contentDir = resolve(process.cwd(), outArg.slice('--out='.length));

// Forward args to tool subprocesses using their existing param names.
const fwdResolved = [`--resolved=${specDir}`];
const fwdContent  = [`--content=${contentDir}`];
const fwdClients  = clientsArg ? [clientsArg] : [];

const src      = (...parts) => resolve(explorerDir, 'src', ...parts);
const doBuild  = tool => !only || only === tool;

// ── Context map ───────────────────────────────────────────────────────────────

if (doBuild('context-map')) {
  execFileSync(node, [src('context-map', 'build.js'), ...fwdContent, ...fwdResolved], { stdio: 'inherit' });
}

// ── Sequence diagrams ─────────────────────────────────────────────────────────

if (doBuild('sequence-diagrams')) {
  const seqSrcDir    = src('sequence-diagrams');
  const seqConfigDir = resolve(contentDir, 'sequence-diagrams', 'config');
  const seqOutDir    = resolve(contentDir, 'sequence-diagrams');
  execFileSync(node, [resolve(seqSrcDir, 'validate-config.js'), `--config-dir=${seqConfigDir}`, ...fwdResolved], { stdio: 'inherit' });
  execFileSync(node, [resolve(seqSrcDir, 'render-action-flow.js'), seqOutDir, `--config-dir=${seqConfigDir}`, ...fwdContent, ...fwdResolved], { stdio: 'inherit' });
  execFileSync(node, [resolve(seqSrcDir, 'build-phases-html.js'), seqOutDir, seqOutDir, `--config-dir=${seqConfigDir}`, ...fwdContent, ...fwdResolved], { stdio: 'inherit' });
}

// ── Data dictionaries ─────────────────────────────────────────────────────────

if (doBuild('data-dictionaries')) {
  // Clean stale field inventories before regenerating — build.js reads these,
  // so they must be removed before the generator runs, not inside build.js itself.
  const ddOutDir = resolve(contentDir, 'data-dictionaries');
  try {
    readdirSync(ddOutDir)
      .filter(f => f.endsWith('-field-inventory.yaml'))
      .forEach(f => rmSync(resolve(ddOutDir, f)));
  } catch { /* dir may not exist yet */ }

  execFileSync(node, [src('data-dictionaries', 'generate-field-inventory.mjs'), `--spec=${specDir}`, `--out=${ddOutDir}`], { stdio: 'inherit' });
  execFileSync(node, [src('data-dictionaries', 'build.js'), ...fwdContent, ...fwdResolved], { stdio: 'inherit' });
}

// ── State machine docs ────────────────────────────────────────────────────────

if (doBuild('state-machine-docs')) {
  execFileSync(node, [src('state-machine-docs', 'build.js'), ...fwdContent, ...fwdResolved], { stdio: 'inherit' });
}

// ── Rules docs ────────────────────────────────────────────────────────────────

if (doBuild('rules-docs')) {
  execFileSync(node, [src('rules-docs', 'build.js'), ...fwdContent, ...fwdResolved], { stdio: 'inherit' });
}

// ── Event catalog ─────────────────────────────────────────────────────────────

if (doBuild('event-catalog')) {
  execFileSync(node, [src('event-catalog.js'), ...fwdContent, ...fwdResolved], { stdio: 'inherit' });
}

// ── API reference ─────────────────────────────────────────────────────────────

if (doBuild('api-reference')) {
  execFileSync(node, [src('api-reference.js'), ...fwdContent, ...fwdResolved], { stdio: 'inherit' });
}

// ── Client reference ──────────────────────────────────────────────────────────

if (doBuild('client-reference')) {
  execFileSync(node, [src('client-reference.js'), ...fwdContent, ...fwdResolved, ...fwdClients], { stdio: 'inherit' });
}

// ── Hub (always rebuilt last — scans all tool output directories) ─────────────

execFileSync(node, [src('hub.js'), ...fwdContent], { stdio: 'inherit' });
