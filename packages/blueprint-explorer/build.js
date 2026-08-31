#!/usr/bin/env node
/**
 * build.js
 *
 * Consolidated explorer build. Resolves config + contracts annotations once
 * and passes the enriched config to all sub-tools that depend on it.
 *
 * If packages/generated is missing or empty, the resolve step runs automatically.
 *
 * Usage:
 *   node build.js                              # build everything
 *   node build.js --only=context-map
 *   node build.js --only=data-dictionaries
 *   node build.js --only=state-machine-docs
 *   node build.js --only=event-catalog
 *   node build.js --only=api-reference
 *   node build.js --only=client-reference
 *   node build.js --only=sequence-diagrams
 *
 * State customization (overlay-aware build):
 *   node build.js --resolved=/path/to/state/resolved
 *                 --clients=/path/to/state/clients
 *
 *   --content   Path to the content package directory (safety-net-explorer or equivalent).
 *               Contains diagram configs and output HTML. Defaults to ../safety-net-explorer.
 *   --resolved  Path to a directory of resolved OpenAPI + state machine files
 *               (output of the contracts resolve pipeline with state overlays applied).
 *   --clients   Path to the generated clients directory (output of clients:generate).
 */

import { readdirSync, rmSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

const args        = process.argv.slice(2);
const onlyArg     = args.find(a => a.startsWith('--only='));
const only        = onlyArg ? onlyArg.slice('--only='.length) : null;
const contentArg  = args.find(a => a.startsWith('--content='));
const resolvedArg = args.find(a => a.startsWith('--resolved='));
const clientsArg  = args.find(a => a.startsWith('--clients='));

const contentDir = contentArg
  ? resolve(process.cwd(), contentArg.slice('--content='.length))
  : resolve(__dirname, '..', 'safety-net-explorer');

const resolvedDir = resolvedArg ? resolve(process.cwd(), resolvedArg.slice('--resolved='.length)) : null;

// Args forwarded to all subprocesses that respect them.
const fwdContent  = [`--content=${contentDir}`];
const fwdResolved = resolvedArg ? [resolvedArg] : [];
const fwdClients  = clientsArg  ? [clientsArg]  : [];

const doBuild = tool => !only || only === tool;

const buildContextMap  = doBuild('context-map');
const buildSeqDiagrams = doBuild('sequence-diagrams');

// ── Context map ───────────────────────────────────────────────────────────────

if (buildContextMap) {
  execFileSync(node, [
    resolve(__dirname, 'src', 'context-map', 'build.js'),
    ...fwdContent, ...fwdResolved,
  ], { stdio: 'inherit' });
}

// ── Sequence diagrams ─────────────────────────────────────────────────────────

if (buildSeqDiagrams) {
  const seqSrcDir    = resolve(__dirname, 'src', 'sequence-diagrams');
  const seqConfigDir = resolve(contentDir, 'sequence-diagrams', 'config');
  const seqOutDir    = resolve(contentDir, 'sequence-diagrams');
  execFileSync(node, [resolve(seqSrcDir, 'validate-config.js'), `--config-dir=${seqConfigDir}`, ...fwdResolved], { stdio: 'inherit' });
  execFileSync(node, [resolve(seqSrcDir, 'render-action-flow.js'), seqOutDir, `--config-dir=${seqConfigDir}`, ...fwdResolved], { stdio: 'inherit' });
  execFileSync(node, [resolve(seqSrcDir, 'build-phases-html.js'), seqOutDir, `--config-dir=${seqConfigDir}`, ...fwdResolved], { stdio: 'inherit' });
}

// ── Data dictionaries (reads contracts directly — subprocess) ─────────────────

if (doBuild('data-dictionaries')) {
  // Clean stale field inventories before regenerating — build.js reads these,
  // so they must be cleaned before the generator runs, not inside build.js itself.
  const ddOutDir = resolve(contentDir, 'data-dictionaries');
  try {
    readdirSync(ddOutDir)
      .filter(f => f.endsWith('-field-inventory.yaml'))
      .forEach(f => rmSync(resolve(ddOutDir, f)));
  } catch { /* dir may not exist yet */ }

  const domains = readdirSync(resolvedDir, { recursive: true })
    .filter(f => typeof f === 'string' && f.endsWith('-openapi.yaml'))
    .map(f => basename(f).replace('-openapi.yaml', ''));
  const generateDataModel = resolve(__dirname, 'src', 'data-dictionaries', 'generate-field-inventory.mjs');
  for (const domain of domains) {
    try {
      execFileSync(node, [generateDataModel, `--domain=${domain}`, `--spec=${resolvedDir}`, `--out=${ddOutDir}`], { stdio: 'inherit' });
    } catch {
      // Domain doesn't have the right structure for data model generation — skip
    }
  }
  execFileSync(node, [resolve(__dirname, 'src', 'data-dictionaries', 'build.js'), ...fwdContent, ...fwdResolved], { stdio: 'inherit' });
}

// ── State machine docs (reads contracts directly — subprocess) ────────────────

if (doBuild('state-machine-docs')) {
  execFileSync(node, [resolve(__dirname, 'src', 'state-machine-docs', 'build.js'), ...fwdContent, ...fwdResolved], { stdio: 'inherit' });
}

if (doBuild('event-catalog')) {
  execFileSync(node, [resolve(__dirname, 'src', 'event-catalog.js'), ...fwdContent, ...fwdResolved], { stdio: 'inherit' });
}

if (doBuild('api-reference')) {
  execFileSync(node, [resolve(__dirname, 'src', 'api-reference.js'), ...fwdContent, ...fwdResolved], { stdio: 'inherit' });
}

if (doBuild('client-reference')) {
  execFileSync(node, [resolve(__dirname, 'src', 'client-reference.js'), ...fwdContent, ...fwdResolved, ...fwdClients], { stdio: 'inherit' });
}

if (doBuild('authored')) {
  execFileSync(node, [resolve(__dirname, 'src', 'authored.js'), ...fwdContent], { stdio: 'inherit' });
}

// Hub is always rebuilt last so it can scan all tool output directories
execFileSync(node, [resolve(__dirname, 'src', 'hub.js'), ...fwdContent], { stdio: 'inherit' });
