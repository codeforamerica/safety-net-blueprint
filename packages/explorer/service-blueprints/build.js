/**
 * build.js
 *
 * Orchestrates all service blueprint outputs for a given blueprint dataset.
 * Runs the Figma plugin build and the SVG renderer in sequence.
 *
 * Usage:
 *   node build.js                     # baseline (output/) → figma-plugin/dist/ + output/intake.svg
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

// ── Figma plugin build ────────────────────────────────────────────────────────

execFileSync('node', [path.join(__dirname, 'figma-plugin', 'build.js'), ...args], {
  stdio: 'inherit',
});

// ── SVG render ────────────────────────────────────────────────────────────────
// Skip in watch mode — SVG is a one-shot output.

if (!args.includes('--watch')) {
  const nonWatchArgs = args.filter(a => a !== '--watch');
  const inputDir = nonWatchArgs[0]
    ? path.resolve(nonWatchArgs[0])
    : path.join(__dirname, 'output');

  const blueprintJson = path.join(inputDir, 'intake.json');
  const svgOut        = path.join(inputDir, 'intake.svg');

  execFileSync('node', [path.join(__dirname, 'render-svg.js'), blueprintJson, '--out', svgOut], {
    stdio: 'inherit',
  });
}
