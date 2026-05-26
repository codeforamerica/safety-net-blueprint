/**
 * build.js
 *
 * Orchestrates all service blueprint outputs for a given blueprint dataset.
 * Runs generate-blueprint.js, the Figma plugin build, and the HTML renderers
 * in sequence.
 *
 * Usage:
 *   node build.js                     # baseline → data/intake.json + output/
 *   node build.js <input-dir>         # state-specific — reads from <input-dir>
 *   node build.js <input-dir> <out>   # state-specific with separate Figma plugin output dir
 *   node build.js --watch             # watch mode (Figma only)
 *
 * Blueprint files (YAML, JSON, theme.yaml) all live together in the same
 * input directory. States keep their files in their own repo and point here.
 *
 * Watch mode is passed through to the Figma build only — HTML renders are one-shot.
 */

import { execFileSync } from 'child_process';
import { mkdirSync } from 'fs';
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

// Figma plugin args: input dir (defaults to data/), optional output dir, optional --watch.
// Strip any annotations YAML path that was passed to this orchestrator — the Figma
// build reads intake.json from the data dir, not from the annotations file.
const figmaArgs = args.filter(a => !a.endsWith('.yaml') && !a.endsWith('.yml'));
execFileSync('node', [path.join(__dirname, 'src', 'figma-plugin', 'build.js'), ...figmaArgs], {
  stdio: 'inherit',
});

// ── PNG previews ──────────────────────────────────────────────────────────────
// Skip in watch mode — renders are one-shot debug outputs.

if (!args.includes('--watch')) {
  mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  const blueprintJson = path.join(__dirname, 'data', 'intake.json');
  const distDir       = path.join(__dirname, 'output');

  const { exportHtmlPng } = await import('./src/export-png.js');

  execFileSync('node', [
    path.join(__dirname, 'src', 'render-blueprint-html.js'),
    blueprintJson, '--out', path.join(distDir, 'intake-blueprint.html'),
  ], { stdio: 'inherit' });
  await exportHtmlPng(path.join(distDir, 'intake-blueprint.html'), path.join(distDir, 'intake-blueprint.png'));

  const { renderCardsHtml } = await import('./src/render-cards-html.js');
  const cardsHtmlPath = renderCardsHtml('intake');
  await exportHtmlPng(cardsHtmlPath, path.join(distDir, 'intake-cards.png'));
}
