/**
 * build.js
 *
 * Bundles the Figma plugin, optionally against a state-specific blueprint.
 *
 * Usage:
 *   node build.js                                    # baseline → dist/
 *   node build.js <input-dir> <output-dir>           # state-specific
 *   node build.js --watch                            # watch mode (baseline)
 *   node build.js <input-dir> <output-dir> --watch   # watch mode (state-specific)
 *
 * Examples:
 *   node build.js src/blueprints/states/co dist/co
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

const inputDir  = args[0] ? path.resolve(args[0]) : path.join(__dirname, '..', 'data');
const outputDir = args[1] ? path.resolve(args[1]) : path.join(__dirname, 'dist');

// ── Validate input ────────────────────────────────────────────────────────────

const blueprintSrc = path.join(inputDir, 'intake.json');
if (!fs.existsSync(blueprintSrc)) {
  console.error(`Error: no intake.json found in ${inputDir}`);
  process.exit(1);
}

// ── Stage blueprint ───────────────────────────────────────────────────────────
// Copy selected blueprint to the well-known path main.ts imports from.

const currentPath = path.join(__dirname, 'src', '_current.json');
fs.copyFileSync(blueprintSrc, currentPath);
console.log(`Blueprint: ${path.relative(__dirname, blueprintSrc)} → src/_current.json`);

// ── Stage cards ───────────────────────────────────────────────────────────────
// Convert cards YAML files to JSON and stage to the well-known path main.ts imports.
// Always reads from the baseline cards directory — state-specific overrides are future work.

const cardsSrc = path.join(__dirname, '..', 'cards', 'intake-cards.yaml');
const cardsCurrentPath = path.join(__dirname, 'src', '_current_cards.json');
if (fs.existsSync(cardsSrc)) {
  const cardsData = yaml.load(fs.readFileSync(cardsSrc, 'utf8'));
  fs.writeFileSync(cardsCurrentPath, JSON.stringify(cardsData));
  console.log(`Cards: ${path.relative(__dirname, cardsSrc)} → src/_current_cards.json`);
} else {
  // Write an empty placeholder so the bundle doesn't fail if the file is missing
  fs.writeFileSync(cardsCurrentPath, JSON.stringify({ domain: '', name: '', phases: [] }));
  console.warn(`Warning: no intake-cards.yaml found at ${cardsSrc}`);
}

// ── Stage card types ──────────────────────────────────────────────────────────
// Convert card-types YAML to JSON and stage to the well-known path renderer.ts imports.
// This is the source of truth for all card type colors, labels, and icon keys.

const cardTypesSrc = path.join(__dirname, '..', 'config', 'card-types.yaml');
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
