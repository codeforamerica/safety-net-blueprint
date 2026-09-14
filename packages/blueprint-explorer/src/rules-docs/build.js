/**
 * rules-docs/build.js
 *
 * Discovers *-graph.yaml files from the resolved contracts directory,
 * matches annotation and policy files by domain, and generates per-ruleset
 * HTML pages plus an index into <contentDir>/rules-docs/.
 *
 * Also copies the blueprint-rules-engine browser bundle (dist/browser.js)
 * into the output directory as rules-engine.js, so ruleset pages can load
 * it with a relative <script> tag — no server required.
 */

import { readdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from 'fs';
import { dirname, join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { load } from 'js-yaml';
import { resolvedDir } from '../lib/paths.js';
import { generateRulesetHtml, generateIndexHtml } from './generate-html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const contentArg = process.argv.find(a => a.startsWith('--content='));
if (!contentArg) {
  console.error('Usage: node build.js --content=<path> [--resolved=<path>]');
  process.exit(1);
}
const contentDir = resolve(process.cwd(), contentArg.slice('--content='.length));
const outputDir  = join(contentDir, 'rules-docs');
const hubHref    = relative(outputDir, join(contentDir, 'index.html'));

mkdirSync(outputDir, { recursive: true });
readdirSync(outputDir).filter(f => f.endsWith('.html') || f === 'rules-engine.js')
  .forEach(f => rmSync(join(outputDir, f)));

// ── Discover graph files ──────────────────────────────────────────────────────

const graphFiles = readdirSync(resolvedDir, { recursive: true })
  .filter(f => typeof f === 'string' && f.endsWith('-graph.yaml'))
  .map(f => join(resolvedDir, f));

if (!graphFiles.length) {
  console.log(`No *-graph.yaml files found in ${resolvedDir} — skipping rules-docs`);
  process.exit(0);
}

// ── Load policies (domain-agnostic, keyed by policy id) ───────────────────────

const policies = {};
const policyFiles = readdirSync(resolvedDir, { recursive: true })
  .filter(f => typeof f === 'string' && f.endsWith('policies.yaml'))
  .map(f => join(resolvedDir, f));
for (const pf of policyFiles) {
  Object.assign(policies, load(readFileSync(pf, 'utf8')) ?? {});
}

// ── Load ruleset input schemas (for placeholder detection) ────────────────────
// Finds *-rules.yaml files and indexes ruleset.inputs by domain → ruleset.

const RULES_SCHEMA = 'rules-schema.yaml';
const rulesetInputsByDomainRuleset = {};
const rulesFiles = readdirSync(resolvedDir, { recursive: true })
  .filter(f => typeof f === 'string' && f.endsWith('-rules.yaml'))
  .map(f => join(resolvedDir, f));
for (const rf of rulesFiles) {
  const doc = load(readFileSync(rf, 'utf8'));
  if (!doc?.$schema?.endsWith(RULES_SCHEMA)) continue;
  const domain = doc.domain;
  if (!domain) continue;
  for (const [ruleset, val] of Object.entries(doc.rulesets ?? {})) {
    if (!rulesetInputsByDomainRuleset[domain]) rulesetInputsByDomainRuleset[domain] = {};
    rulesetInputsByDomainRuleset[domain][ruleset] = val.inputs ?? {};
  }
}

// ── Load examples by domain → ruleset ────────────────────────────────────────

const EXAMPLES_SCHEMA = 'rules-examples-schema.yaml';
const examplesByDomainRuleset = {};
const examplesFiles = readdirSync(resolvedDir, { recursive: true })
  .filter(f => typeof f === 'string' && f.endsWith('-rules-examples.yaml'))
  .map(f => join(resolvedDir, f));
for (const ef of examplesFiles) {
  const doc = load(readFileSync(ef, 'utf8'));
  if (!doc?.$schema?.endsWith(EXAMPLES_SCHEMA)) continue;
  const domain = doc.domain;
  if (!domain) continue;
  for (const [ruleset, val] of Object.entries(doc.rulesets ?? {})) {
    if (!examplesByDomainRuleset[domain]) examplesByDomainRuleset[domain] = {};
    examplesByDomainRuleset[domain][ruleset] = val.examples ?? [];
  }
}

// ── Load annotations by domain, indexed by fact path ──────────────────────────

const annotationsByDomain = {};
const annotationFiles = readdirSync(resolvedDir, { recursive: true })
  .filter(f => typeof f === 'string' && f.endsWith('-annotations.yaml'))
  .map(f => join(resolvedDir, f));
for (const af of annotationFiles) {
  const doc = load(readFileSync(af, 'utf8'));
  const domain = doc?.domain;
  if (!domain) continue;
  if (!annotationsByDomain[domain]) annotationsByDomain[domain] = {};
  for (const [key, value] of Object.entries(doc.facts ?? {})) {
    annotationsByDomain[domain][key] = value;
  }
}

// ── Copy browser bundle ───────────────────────────────────────────────────────

const require = createRequire(import.meta.url);
const bundleSrc = require.resolve('@codeforamerica/blueprint-rules-engine/browser');
copyFileSync(bundleSrc, join(outputDir, 'rules-engine.js'));

// ── Generate per-ruleset pages ────────────────────────────────────────────────

console.log(`Generating rules docs for ${graphFiles.length} graph(s)...`);

const allRulesets = [];
for (const graphFile of graphFiles) {
  const graph = load(readFileSync(graphFile, 'utf8'));
  if (!graph?.ruleset || !graph?.domain) continue;

  const { domain, ruleset: rulesetName } = graph;

  // Pull annotations for this specific ruleset: strip "{rulesetName}." prefix
  const domainAnnot = annotationsByDomain[domain] ?? {};
  const annotations = {};
  for (const [key, value] of Object.entries(domainAnnot)) {
    if (key.startsWith(`${rulesetName}.`)) {
      annotations[key.slice(rulesetName.length + 1)] = value;
    }
  }

  const examples = examplesByDomainRuleset[domain]?.[rulesetName] ?? [];
  const rulesetInputs = rulesetInputsByDomainRuleset[domain]?.[rulesetName] ?? {};
  const slug = `${domain}-${rulesetName}`;
  const html = generateRulesetHtml(graph, annotations, policies, examples, rulesetInputs, { hubHref, outputDir });
  writeFileSync(join(outputDir, `${slug}.html`), html);
  allRulesets.push({ domain, rulesetName, slug });
  console.log(`  ✓ ${domain}/${rulesetName}`);
}

generateIndexHtml(allRulesets, outputDir, hubHref);
console.log('Done.');
