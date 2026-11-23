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
 *               and context-map/config/. Defaults to --out.
 *               When different from --out, config files are copied to --out before
 *               building so that tool scripts can find them there.
 *   --authored  Path to authored HTML pages source directory. Defaults to the
 *               blueprint-explorer package's built-in authored/ directory.
 *   --only      Build one tool only: context-map, data-dictionaries,
 *               state-machine-docs, rules-docs, event-catalog, api-reference, scenarios
 */

import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import yaml from 'js-yaml';
import {
  buildAnnotationsExplorer,
  buildContextMap,
  buildDataDictionaries,
  buildStateMachineDocs,
  buildRulesDocs,
  buildEventCatalog,
  buildApiReference,
  buildTryIt,
  buildHub,
  bundleSiteRouting,
} from '@codeforamerica/blueprint-explorer';

const args        = process.argv.slice(2);
const onlyArg     = args.find(a => a.startsWith('--only='));
const only        = onlyArg ? onlyArg.slice('--only='.length) : null;
const specArg     = args.find(a => a.startsWith('--spec='));
const outArg      = args.find(a => a.startsWith('--out='));
const configArg   = args.find(a => a.startsWith('--config='));
const authoredArg = args.find(a => a.startsWith('--authored='));

if (!specArg || !outArg) {
  console.error('Usage: node build-explorer.js --spec=<resolved-dir> --out=<out-dir> [--config=<config-dir>] [--authored=<path>] [--only=<tool>]');
  process.exit(1);
}

const specDir    = resolve(process.cwd(), specArg.slice('--spec='.length));
const outDir     = resolve(process.cwd(), outArg.slice('--out='.length));
const configDir  = configArg ? resolve(process.cwd(), configArg.slice('--config='.length)) : outDir;
const authoredDir = authoredArg ? resolve(process.cwd(), authoredArg.slice('--authored='.length)) : undefined;

// When config and out differ, copy authored config files to outDir so that
// tool scripts (which read from their --content arg) can find them there.
if (configDir !== outDir) {
  mkdirSync(outDir, { recursive: true });
  if (existsSync(join(configDir, 'config.yaml'))) {
    cpSync(join(configDir, 'config.yaml'), join(outDir, 'config.yaml'));
    // The site's own script, logo and pages, which config.yaml names relative to itself.
    const config = yaml.load(readFileSync(join(configDir, 'config.yaml'), 'utf8')) ?? {};
    for (const key of ['script', 'logo', 'pages']) {
      const named = config[key];
      if (typeof named !== 'string') continue;
      if (!existsSync(join(configDir, named))) {
        console.error(`config.yaml names ${key}: ${named}, but ${join(configDir, named)} doesn't exist.`);
        process.exit(1);
      }
      mkdirSync(dirname(join(outDir, named)), { recursive: true });
      cpSync(join(configDir, named), join(outDir, named), { recursive: true });
    }
  }
  const cmConfig  = join(configDir, 'context-map', 'config');
  if (existsSync(cmConfig))  cpSync(cmConfig,  join(outDir, 'context-map', 'config'),  { recursive: true });
}

const contentDir  = outDir;
const resolvedDir = specDir;
const doBuild = tool => !only || only === tool;

if (doBuild('annotations-explorer')) buildAnnotationsExplorer({ contentDir, resolvedDir });
if (doBuild('context-map'))       buildContextMap({ contentDir, resolvedDir });
if (doBuild('data-dictionaries')) await buildDataDictionaries({ contentDir, resolvedDir });
if (doBuild('state-machine-docs')) buildStateMachineDocs({ contentDir, resolvedDir });
if (doBuild('rules-docs'))        buildRulesDocs({ contentDir, resolvedDir });
if (doBuild('event-catalog'))     buildEventCatalog({ contentDir, resolvedDir });
if (doBuild('api-reference'))     await buildApiReference({ contentDir, resolvedDir });
if (doBuild('scenarios'))         buildTryIt({ contentDir, resolvedDir });

// The site's routing, checked against the contracts and bundled with its modules.
try {
  await bundleSiteRouting({ configDir, outDir, resolvedDir });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Hub is always rebuilt last so it can scan all tool output directories
buildHub({ contentDir, authoredDir });
