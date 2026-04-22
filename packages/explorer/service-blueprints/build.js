/**
 * build.js
 *
 * Orchestrates all service blueprint outputs for a given blueprint dataset.
 * Runs the Figma plugin build and the SVG renderer in sequence.
 *
 * Usage:
 *   node build.js                                    # baseline → figma/dist/ + svg/
 *   node build.js <input-dir> <output-dir>           # state-specific
 *   node build.js --watch                            # watch mode (Figma only)
 *
 * Examples:
 *   node build.js states/co dist/co
 *
 * SVG files are written to service-blueprints/svg/ (sibling of figma/).
 * Watch mode is passed through to the Figma build only — SVG is rendered once.
 */

import { execFileSync } from 'child_process';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

// ── Figma plugin build ────────────────────────────────────────────────────────

execFileSync('node', [path.join(__dirname, 'figma', 'build.js'), ...args], {
  stdio: 'inherit',
});

// ── SVG render ────────────────────────────────────────────────────────────────
// Skip in watch mode — SVG is a one-shot output.

if (!args.includes('--watch')) {
  const nonWatchArgs = args.filter(a => a !== '--watch');
  const inputDir = nonWatchArgs[0]
    ? path.resolve(nonWatchArgs[0])
    : path.join(__dirname, 'figma', 'src', 'blueprints');

  const blueprintJson = path.join(inputDir, 'intake.json');

  const svgDir = path.join(__dirname, 'svg');
  mkdirSync(svgDir, { recursive: true });
  const svgOut = path.join(svgDir, 'intake.svg');

  execFileSync('node', [path.join(__dirname, 'render-svg.js'), blueprintJson, '--out', svgOut], {
    stdio: 'inherit',
  });
}
