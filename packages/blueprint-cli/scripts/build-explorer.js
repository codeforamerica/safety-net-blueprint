#!/usr/bin/env node
/**
 * build-explorer.js
 *
 * Builds the Blueprint Explorer static site by invoking each rendering tool
 * from the @codeforamerica/blueprint-explorer package.
 *
 * Usage:
 *   node scripts/build-explorer.js --spec=<resolved-dir> --out=<out-dir>
 *   node scripts/build-explorer.js --spec=<path> --out=<path> --config=<config-dir>
 *   node scripts/build-explorer.js --spec=<path> --out=<path> --only=rules-docs
 *
 *   --spec      Path to resolved contracts directory (output of blueprint-resolve)
 *   --out       Path to the output directory — receives all generated HTML files
 *   --config    Path to the authored configuration directory — contains config.yaml,
 *               context-map/config/, and sequence-diagrams/config/. Defaults to --out.
 *               When different from --out, config files are copied to --out before
 *               building so that tool scripts can find them there.
 *   --authored  Path to authored HTML pages source directory. Defaults to the
 *               blueprint-explorer package's built-in authored/ directory.
 *   --clients   Path to generated TypeScript clients (output of blueprint-generate-ts-clients).
 *   --only      Build one tool only: context-map, sequence-diagrams, data-dictionaries,
 *               state-machine-docs, rules-docs, event-catalog, api-reference, client-reference
 */

import { cpSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import {
  buildAnnotationsExplorer,
  buildContextMap,
  buildSequenceDiagrams,
  buildDataDictionaries,
  buildStateMachineDocs,
  buildRulesDocs,
  buildEventCatalog,
  buildApiReference,
  buildClientReference,
  buildHub,
} from '@codeforamerica/blueprint-explorer';

const args        = process.argv.slice(2);
const onlyArg     = args.find(a => a.startsWith('--only='));
const only        = onlyArg ? onlyArg.slice('--only='.length) : null;
const specArg     = args.find(a => a.startsWith('--spec='));
const outArg      = args.find(a => a.startsWith('--out='));
const configArg   = args.find(a => a.startsWith('--config='));
const authoredArg = args.find(a => a.startsWith('--authored='));
const clientsArg  = args.find(a => a.startsWith('--clients='));

if (!specArg || !outArg) {
  console.error('Usage: node build-explorer.js --spec=<resolved-dir> --out=<out-dir> [--config=<config-dir>] [--authored=<path>] [--clients=<path>] [--only=<tool>]');
  process.exit(1);
}

const specDir    = resolve(process.cwd(), specArg.slice('--spec='.length));
const outDir     = resolve(process.cwd(), outArg.slice('--out='.length));
const configDir  = configArg ? resolve(process.cwd(), configArg.slice('--config='.length)) : outDir;
const authoredDir = authoredArg ? resolve(process.cwd(), authoredArg.slice('--authored='.length)) : undefined;
const clientsDir  = clientsArg  ? resolve(process.cwd(), clientsArg.slice('--clients='.length))  : undefined;

// When config and out differ, copy authored config files to outDir so that
// tool scripts (which read from their --content arg) can find them there.
if (configDir !== outDir) {
  mkdirSync(outDir, { recursive: true });
  cpSync(join(configDir, 'config.yaml'), join(outDir, 'config.yaml'));
  const cmConfig  = join(configDir, 'context-map', 'config');
  if (existsSync(cmConfig))  cpSync(cmConfig,  join(outDir, 'context-map', 'config'),  { recursive: true });
  const seqConfig = join(configDir, 'sequence-diagrams', 'config');
  if (existsSync(seqConfig)) cpSync(seqConfig, join(outDir, 'sequence-diagrams', 'config'), { recursive: true });
}

const contentDir  = outDir;
const resolvedDir = specDir;
const doBuild = tool => !only || only === tool;

if (doBuild('annotations-explorer')) buildAnnotationsExplorer({ contentDir, resolvedDir });
if (doBuild('context-map'))       buildContextMap({ contentDir, resolvedDir });
if (doBuild('sequence-diagrams')) buildSequenceDiagrams({ contentDir, resolvedDir });
if (doBuild('data-dictionaries')) await buildDataDictionaries({ contentDir, resolvedDir });
if (doBuild('state-machine-docs')) buildStateMachineDocs({ contentDir, resolvedDir });
if (doBuild('rules-docs'))        buildRulesDocs({ contentDir, resolvedDir });
if (doBuild('event-catalog'))     buildEventCatalog({ contentDir, resolvedDir });
if (doBuild('api-reference'))     await buildApiReference({ contentDir, resolvedDir });
if (doBuild('client-reference'))  buildClientReference({ contentDir, resolvedDir, clientsDir });

// Hub is always rebuilt last so it can scan all tool output directories
buildHub({ contentDir, authoredDir });
