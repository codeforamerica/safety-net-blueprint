/**
 * build.js
 *
 * Bundles the Figma plugin.
 * Blueprint and cards data (_current.json, _current_cards.json) are written
 * to src/ by packages/explorer/scenarios/build.js before this runs.
 *
 * Usage:
 *   node build.js                  # build → dist/
 *   node build.js <output-dir>     # build to custom output dir
 *   node build.js --watch          # watch mode
 *
 * The output dir receives main.js, ui.html, and a manifest.json with paths
 * relative to that folder so Figma can load it directly.
 */

import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2).filter(a => a !== '--watch');
const watch = process.argv.includes('--watch');

const outputDir = args[0] ? path.resolve(args[0]) : path.join(__dirname, '..', '..', 'output', 'figma-plugin-dist');

// ── Stage card types ──────────────────────────────────────────────────────────
// Convert card-types YAML to JSON and stage to the well-known path renderer.ts imports.
// This is the source of truth for all card type colors, labels, and icon keys.

const cardTypesSrc = path.join(__dirname, '..', '..', 'config', 'card-types.yaml');
const cardTypesCurrentPath = path.join(__dirname, 'src', '_current_card_types.json');
if (fs.existsSync(cardTypesSrc)) {
  const cardTypesData = yaml.load(fs.readFileSync(cardTypesSrc, 'utf8'));
  fs.writeFileSync(cardTypesCurrentPath, JSON.stringify(cardTypesData));
  console.log(`Card types: ${path.relative(__dirname, cardTypesSrc)} → src/_current_card_types.json`);
} else {
  fs.writeFileSync(cardTypesCurrentPath, JSON.stringify({ types: {}, actors: {} }));
  console.warn(`Warning: no card-types.yaml found at ${cardTypesSrc}`);
}

// ── Build ─────────────────────────────────────────────────────────────────────

fs.mkdirSync(outputDir, { recursive: true });

const buildOptions = {
  entryPoints: [path.join(__dirname, 'src', 'main.ts')],
  bundle: true,
  outfile: path.join(outputDir, 'main.js'),
  platform: 'browser',
  target: ['es6'],
  logLevel: 'info',
};

function copyAssets() {
  fs.copyFileSync(
    path.join(__dirname, 'src', 'ui.html'),
    path.join(outputDir, 'ui.html')
  );

  // Write a manifest pointing to files relative to the output dir
  const baseManifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8')
  );
  fs.writeFileSync(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify({ ...baseManifest, main: 'main.js', ui: 'ui.html' }, null, 2) + '\n'
  );
}

if (watch) {
  const ctx = await esbuild.context({
    ...buildOptions,
    plugins: [{
      name: 'copy-assets',
      setup(build) {
        build.onEnd(() => copyAssets());
      }
    }]
  });
  await ctx.watch();
  console.log(`Watching → ${path.relative(__dirname, outputDir)}/`);
} else {
  await esbuild.build(buildOptions);
  copyAssets();
  console.log(`Built → ${path.relative(__dirname, outputDir)}/`);
}
