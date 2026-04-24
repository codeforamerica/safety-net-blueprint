/**
 * build.js
 *
 * Orchestrates all service blueprint outputs for a given blueprint dataset.
 * Runs generate-blueprint.js, the Figma plugin build, and the SVG renderer
 * in sequence.
 *
 * Usage:
 *   node build.js                     # baseline → output/intake.json + figma-plugin/dist/ + output/intake.svg
 *   node build.js <input-dir>         # state-specific — reads from and writes SVG to <input-dir>
 *   node build.js <input-dir> <out>   # state-specific with separate Figma plugin output dir
 *   node build.js --watch             # watch mode (Figma only)
 *
 * Blueprint files (YAML, JSON, SVG, theme.yaml) all live together in the same
 * input directory. States keep their files in their own repo and point here.
 *
 * Watch mode is passed through to the Figma build only — SVG is rendered once.
 */

import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

// ── Generate blueprint JSON from config.yaml + annotations ───────────────────
// Always regenerate from source before building Figma plugin or SVG.

execFileSync('node', [
  path.join(__dirname, 'src', 'generate-blueprint.js'),
  path.join(__dirname, 'config', 'intake-annotations.yaml'),
], { stdio: 'inherit' });

// ── Figma plugin build ────────────────────────────────────────────────────────

// Figma plugin args: input dir (defaults to output/), optional output dir, optional --watch.
// Strip any annotations YAML path that was passed to this orchestrator — the Figma
// build reads intake.json from the output dir, not from the annotations file.
const figmaArgs = args.filter(a => !a.endsWith('.yaml') && !a.endsWith('.yml'));
execFileSync('node', [path.join(__dirname, 'figma-plugin', 'build.js'), ...figmaArgs], {
  stdio: 'inherit',
});

// ── SVG render ────────────────────────────────────────────────────────────────
// Skip in watch mode — SVG is a one-shot output.

if (!args.includes('--watch')) {
  // generate-blueprint.js always writes to output/ — use that as the SVG input.
  const inputDir      = path.join(__dirname, 'output');
  const blueprintJson = path.join(inputDir, 'intake.json');
  const svgOut        = path.join(inputDir, 'intake.svg');

  execFileSync('node', [path.join(__dirname, 'src', 'render-svg.js'), blueprintJson, '--out', svgOut], {
    stdio: 'inherit',
  });
}
