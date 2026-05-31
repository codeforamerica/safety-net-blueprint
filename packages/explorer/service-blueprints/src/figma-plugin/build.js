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
// Derive policy cards from config.yaml steps. Steps may use either:
//   ref: "section/key"  — resolved via domain annotations + policy registry
//   regulatory: [...]   — legacy inline format (kept for unconverted steps)
// Groups by flow label (phase) → enclosing fragment label (sub-phase).
// Deduplicates globally by policy ID / citation so each regulation appears once.

const configSrc = path.join(__dirname, '..', '..', '..', 'src', 'config.yaml');
const cardsCurrentPath = path.join(__dirname, 'src', '_current_cards.json');
const contractsDir = path.join(__dirname, '..', '..', '..', '..', 'contracts');

if (fs.existsSync(configSrc)) {
  const config = yaml.load(fs.readFileSync(configSrc, 'utf8'));

  // Load domain annotations and policy registry from contracts
  let annotationSections = {};
  let policies = {};
  const citationToPolicyId = {};  // reverse index: citation string → policy ID

  const annotationsPath = path.join(contractsDir, 'intake-annotations.yaml');
  if (fs.existsSync(annotationsPath)) {
    const annotations = yaml.load(fs.readFileSync(annotationsPath, 'utf8'));
    annotationSections = {
      schema: annotations.schema || {},
      operations: annotations.operations || {},
      events: annotations.events || {},
    };
  }

  const registryPath = path.join(contractsDir, 'platform-registry-policies.yaml');
  if (fs.existsSync(registryPath)) {
    const registry = yaml.load(fs.readFileSync(registryPath, 'utf8'));
    policies = registry.policies || {};
    for (const [id, policy] of Object.entries(policies)) {
      if (policy.citation) citationToPolicyId[policy.citation] = id;
    }
  }

  // Resolve "section/key" ref to policy card objects
  function resolveRef(ref) {
    const slashIdx = ref.indexOf('/');
    if (slashIdx === -1) return [];
    const section = ref.slice(0, slashIdx);
    const key = ref.slice(slashIdx + 1);
    const annotation = annotationSections[section]?.[key];
    if (!annotation?.policies) return [];
    return annotation.policies.flatMap(id => {
      const policy = policies[id];
      if (!policy) return [];
      return [{ policyId: id, type: 'policy', text: policy.citation, subtext: policy.description?.trim(), citation: policy.citation }];
    });
  }

  // First pass: collect every occurrence of each policy across all flows/fragments.
  // occurrences: dedup key → [{ flowLabel, fragmentLabel, text, subtext, citation, legacy? }]
  const occurrences = new Map();

  function collect(steps, flowLabel, fragmentLabel) {
    for (const step of steps) {
      const frag = (step.fragment !== undefined && step.label) ? step.label : fragmentLabel;

      if (step.ref && typeof step.ref === 'string') {
        for (const card of resolveRef(step.ref)) {
          if (!occurrences.has(card.policyId)) occurrences.set(card.policyId, []);
          occurrences.get(card.policyId).push({ flowLabel, fragmentLabel: frag, text: card.text, subtext: card.subtext, citation: card.citation });
        }
      }

      if (Array.isArray(step.regulatory)) {
        for (const reg of step.regulatory) {
          if (!reg.citation) continue;
          // Use policy ID as dedup key when the citation matches a registry entry
          const key = citationToPolicyId[reg.citation] || reg.citation;
          if (!occurrences.has(key)) occurrences.set(key, []);
          occurrences.get(key).push({ flowLabel, fragmentLabel: frag, text: reg.summary, subtext: reg.detail, citation: reg.citation });
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

  // Second pass: place each policy once (at first occurrence), appending
  // "Used in: A · B · C" to subtext when it appears in multiple phases.
  const grouped = {};  // { [flowLabel]: { [fragmentLabel]: CardEntry[] } }

  for (const [, list] of occurrences) {
    const first = list[0];
    const phases = [...new Set(list.map(o => o.flowLabel))];
    const usedIn = phases.length > 1 ? `Used in: ${phases.join(' · ')}` : null;
    const subtext = [first.subtext, usedIn].filter(Boolean).join('\n\n') || undefined;
    const card = { type: 'policy', text: first.text, subtext, citation: first.citation };

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
