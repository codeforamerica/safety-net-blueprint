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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2).filter(a => a !== '--watch');
const watch = process.argv.includes('--watch');

const inputDir  = args[0] ? path.resolve(args[0]) : path.join(__dirname, 'src', 'blueprints');
const outputDir = args[1] ? path.resolve(args[1]) : path.join(__dirname, 'dist');

// ── Validate input ────────────────────────────────────────────────────────────

const blueprintSrc = path.join(inputDir, 'intake.json');
if (!fs.existsSync(blueprintSrc)) {
  console.error(`Error: no intake.json found in ${inputDir}`);
  process.exit(1);
}

// ── Stage blueprint ───────────────────────────────────────────────────────────
// Copy selected blueprint to the well-known path main.ts imports from.

const currentPath = path.join(__dirname, 'src', 'blueprints', '_current.json');
fs.copyFileSync(blueprintSrc, currentPath);
console.log(`Blueprint: ${path.relative(__dirname, blueprintSrc)} → src/blueprints/_current.json`);

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
