#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { PALETTE, wrapText, box, arrow, wrapSvgAsHtml } from './diagram-utils.js';
import { parseCliArgs } from './cli-utils.js';

function printUsage() {
  console.error('Usage: node src/visualize-fact-graph.js <project.translated.json> [--out <file.html>]');
  console.error('  <project.translated.json> is the output of: node src/translate-project.js <project.classified.json> --out <project.translated.json>');
  console.error('  --out defaults to generated/fact-graph.html');
  console.error('Example: node src/translate-project.js generated/all-patterns.classified.json --out generated/all-patterns.translated.json');
  console.error('         node src/visualize-fact-graph.js generated/all-patterns.translated.json --out generated/all-patterns-fact-graph.html');
}

// Reverse-chaining dependency graph, not a forward-chaining flowchart -- so the
// color vocabulary means something different here than in visualize-rules.js,
// even though it's drawn from the same shared palette: teal = a Derived fact
// (computed from other facts), dark navy = a Writable fact (supplied from
// OUTSIDE the derivation graph -- reusing context-map's own "api" color, since
// both are "comes from beyond this system's own computation" in spirit).
const COLOR = {
  derived: PALETTE.teal,
  writable: PALETTE.navy,
};

const BOX_W = 300;
const WRAP_CHARS = 42;
const LAYER_V_GAP = 70;
const H_GAP = 40;
const PAD = 24;

/**
 * Every real Fact path (e.g. "/household/totalIncome") corresponds to exactly one
 * CEL alias.attribute reference (e.g. "household.totalIncome") in another Fact's
 * own `derived` expression -- confirmed by construction, since to-cel.js's own
 * factPathFromCanonicalPath is what produced the Fact path in the first place, by
 * lowercasing the entity and joining with "/". Build the reverse mapping once.
 */
function aliasKeyFor(factPath) {
  return factPath.slice(1).replace(/\//g, '.');
}

/**
 * Scans a Derived fact's own CEL text for other Fact paths it references --
 * confirmed sufficient for every proposed custom function this translator emits
 * (yearsBetween(applicant.dob, today), sum(applicant, 'income'), nthByKey(program,
 * 'priority', 1).name, etc.): every real dependency shows up as a bare
 * "alias.attribute" token somewhere in the string, whether as a direct operand or
 * a function argument. NOT exhaustive by construction -- a bare collection-name
 * reference with no specific attribute (e.g. "size(adult)", not "adult.age")
 * doesn't name a single Fact path and is deliberately not captured as a
 * dependency edge; only attribute-qualified references are.
 *
 * Checked, and NOT sufficient on its own: `nthByKey(program, 'priority', 1).name`
 * and `sum(applicant, 'income')` (see to-cel.js) name their field via a STRING
 * LITERAL argument, not a dot-expression -- "program.priority" never appears as a
 * literal token anywhere in that CEL text, so the bare-token scan above misses it
 * entirely, and bestProgram would render as a false root (no incoming edges) if
 * this weren't handled specially. Both proposed functions' real shapes are
 * checked directly.
 */
function extractDependencies(derivedText, pathByAliasKey) {
  const deps = new Set();
  const matches = derivedText.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\b/g) ?? [];
  for (const m of matches) {
    const target = pathByAliasKey.get(m);
    if (target) deps.add(target);
  }
  const fieldNameCalls = derivedText.matchAll(/\b(?:nthByKey|sum)\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*,\s*'([a-zA-Z_][a-zA-Z0-9_]*)'/g);
  for (const [, collection, field] of fieldNameCalls) {
    const target = pathByAliasKey.get(`${collection}.${field}`);
    if (target) deps.add(target);
  }
  return [...deps];
}

/**
 * Longest-path-from-source layering: a Writable fact (nothing it depends on) sits
 * at layer 0; a Derived fact sits one layer below the deepest fact it depends on.
 * Throws on a cycle rather than looping forever or guessing -- shouldn't happen
 * given a genuine cycle never becomes a Fact in the first place (see
 * TRANSLATION-PATTERNS.md's three-way self-loop section), so a cycle showing up
 * here would mean something upstream is wrong, not something to silently work
 * around.
 */
function computeLayers(facts, depsByPath) {
  const layerByPath = new Map();
  const visiting = new Set();
  function layerOf(path) {
    if (layerByPath.has(path)) return layerByPath.get(path);
    if (visiting.has(path)) throw new Error(`Cycle detected among Facts while computing dependency-graph layers, at "${path}" -- a genuine cycle should never have become a Fact (see TRANSLATION-PATTERNS.md)`);
    visiting.add(path);
    const deps = depsByPath.get(path) ?? [];
    const layer = deps.length ? 1 + Math.max(...deps.map(layerOf)) : 0;
    visiting.delete(path);
    layerByPath.set(path, layer);
    return layer;
  }
  for (const fact of facts) layerOf(fact.path);
  return layerByPath;
}

function factBodyLines(fact) {
  const lines = [];
  if (fact.derived !== undefined) lines.push(...wrapText(fact.derived, WRAP_CHARS));
  else if (fact.placeholder !== undefined) lines.push(`(placeholder: ${fact.placeholder})`);
  else lines.push('(no default -- pure input)');
  return lines;
}

function renderDiagram(facts) {
  const pathByAliasKey = new Map(facts.map((f) => [aliasKeyFor(f.path), f.path]));
  const depsByPath = new Map(
    facts.map((f) => [f.path, f.derived !== undefined ? extractDependencies(f.derived, pathByAliasKey).filter((d) => d !== f.path) : []])
  );
  const layerByPath = computeLayers(facts, depsByPath);

  const factsByLayer = new Map();
  for (const fact of facts) {
    const layer = layerByPath.get(fact.path);
    if (!factsByLayer.has(layer)) factsByLayer.set(layer, []);
    factsByLayer.get(layer).push(fact);
  }
  const maxLayer = Math.max(...factsByLayer.keys());

  const centerXByPath = new Map();
  const topYByPath = new Map();
  const bottomYByPath = new Map();
  const blocks = [];
  let y = PAD;
  let maxWidth = 0;
  for (let layer = 0; layer <= maxLayer; layer++) {
    const layerFacts = (factsByLayer.get(layer) ?? []).sort((a, b) => a.path.localeCompare(b.path));
    let x = PAD;
    let rowHeight = 0;
    for (const fact of layerFacts) {
      const style = fact.derived !== undefined ? COLOR.derived : COLOR.writable;
      const { svg, height } = box(x, y, BOX_W, fact.path, null, factBodyLines(fact), style, fact.derived === undefined);
      blocks.push(svg);
      centerXByPath.set(fact.path, x + BOX_W / 2);
      topYByPath.set(fact.path, y);
      bottomYByPath.set(fact.path, y + height);
      rowHeight = Math.max(rowHeight, height);
      x += BOX_W + H_GAP;
    }
    maxWidth = Math.max(maxWidth, x - H_GAP);
    // Edges drawn after all of this layer's boxes are placed, from each fact's
    // OWN dependencies (in earlier, already-placed layers, each with its own
    // real box height -- not this layer's) down into it.
    for (const fact of layerFacts) {
      for (const dep of depsByPath.get(fact.path) ?? []) {
        blocks.push(arrow(centerXByPath.get(dep), bottomYByPath.get(dep), centerXByPath.get(fact.path), y));
      }
    }
    y += rowHeight + LAYER_V_GAP;
  }

  const width = maxWidth + PAD;
  const height = y;
  return wrapSvgAsHtml('Decision-rules DSL Fact dependency graph', width, height, blocks.join('\n'));
}

const args = parseCliArgs(process.argv);
if (!args) {
  printUsage();
  process.exit(0);
}

const { facts } = JSON.parse(readFileSync(args.positional, 'utf-8'));
const html = renderDiagram(facts);
const outFile = args.outFile ?? 'generated/fact-graph.html';
writeFileSync(outFile, html);
console.log(`Wrote Fact dependency graph to ${outFile}`);
