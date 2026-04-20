/**
 * build.js
 *
 * Orchestrates all service blueprint outputs for a given blueprint dataset.
 * Runs the Figma plugin build and the SVG renderer in sequence.
 *
 * Usage:
 *   node build.js                                    # baseline → figma/dist/
 *   node build.js <input-dir> <output-dir>           # state-specific
 *   node build.js --watch                            # watch mode (Figma only)
 *
 * Examples:
 *   node build.js states/co dist/co
 *
 * The SVG is written alongside the blueprint JSON (or to --out if passed).
 * Watch mode is passed through to the Figma build only — SVG is rendered once.
 */

import { execFileSync } from 'child_process';
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

  execFileSync('node', [path.join(__dirname, 'render-svg.js'), blueprintJson], {
    stdio: 'inherit',
  });
}
