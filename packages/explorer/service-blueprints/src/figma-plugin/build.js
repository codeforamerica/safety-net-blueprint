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

const inputDir  = args[0] ? path.resolve(args[0]) : path.join(__dirname, '..', '..', 'data');
const outputDir = args[1] ? path.resolve(args[1]) : path.join(__dirname, '..', '..', 'output', 'figma-plugin-dist');

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
// Derive policy cards from the regulatory annotations in config.yaml.
// Groups by flow label (phase) → enclosing fragment label (sub-phase).
// Deduplicates globally by citation so each regulation appears once.

const configSrc = path.join(__dirname, '..', '..', '..', 'config.yaml');
const cardsCurrentPath = path.join(__dirname, 'src', '_current_cards.json');


if (fs.existsSync(configSrc)) {
  const config = yaml.load(fs.readFileSync(configSrc, 'utf8'));

  // First pass: collect every occurrence of each citation across all flows/fragments.
  // occurrences: citation → [{ flowLabel, fragmentLabel, summary, detail }]
  const occurrences = new Map();

  function collect(steps, flowLabel, fragmentLabel) {
    for (const step of steps) {
      const frag = (step.fragment !== undefined && step.label) ? step.label : fragmentLabel;
      if (Array.isArray(step.regulatory)) {
        for (const reg of step.regulatory) {
          if (!reg.citation) continue;
          if (!occurrences.has(reg.citation)) occurrences.set(reg.citation, []);
          occurrences.get(reg.citation).push({ flowLabel, fragmentLabel: frag, summary: reg.summary, detail: reg.detail });
        }
      }
      if (Array.isArray(step.steps)) collect(step.steps, flowLabel, frag);
      if (Array.isArray(step.operands)) {
        for (const op of step.operands) {
          if (Array.isArray(op.steps)) collect(op.steps, flowLabel, op.label || frag);
        }
      }
    }
  }

  for (const flow of (config.flows || [])) {
    if (Array.isArray(flow.steps)) collect(flow.steps, flow.label, flow.label);
  }

  // Second pass: place each citation once (at first occurrence), appending a
  // "Used in: A · B · C" line to subtext when it appears in multiple phases.
  const grouped = {};  // { [flowLabel]: { [fragmentLabel]: CardEntry[] } }

  for (const [citation, list] of occurrences) {
    const first = list[0];

    // Collect distinct flow (phase) names across all occurrences
    const phases = [...new Set(list.map(o => o.flowLabel))];
    const usedIn = phases.length > 1 ? `Used in: ${phases.join(' · ')}` : null;

    const subtext = [first.detail, usedIn].filter(Boolean).join('\n\n') || undefined;

    const card = { type: 'policy', text: first.summary, subtext, citation };

    if (!grouped[first.flowLabel]) grouped[first.flowLabel] = {};
    if (!grouped[first.flowLabel][first.fragmentLabel]) grouped[first.flowLabel][first.fragmentLabel] = [];
    grouped[first.flowLabel][first.fragmentLabel].push(card);
  }

  const phases = Object.entries(grouped).map(([flowLabel, fragments], fi) => ({
    id: `flow-${fi}`,
    label: flowLabel,
    subPhases: Object.entries(fragments).map(([fragLabel, cards], si) => ({
      id: `frag-${fi}-${si}`,
      label: fragLabel,
      cards,
    })),
  }));

  const cardsData = { domain: 'intake', name: 'Intake', phases };
  fs.writeFileSync(cardsCurrentPath, JSON.stringify(cardsData));
  console.log(`Cards: ${path.relative(__dirname, configSrc)} → src/_current_cards.json`);
} else {
  fs.writeFileSync(cardsCurrentPath, JSON.stringify({ domain: '', name: '', phases: [] }));
  console.warn(`Warning: no config.yaml found at ${configSrc}`);
}

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
