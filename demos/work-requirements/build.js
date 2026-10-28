#!/usr/bin/env node
/**
 * Build the work requirements demo: one HTML file that opens from disk.
 *
 * For the federal rules and each state in packages/safety-net-contracts/states/,
 * resolves the contracts with the package's overlays and that state's file —
 * as `blueprint-resolve --overlay=src/overlays --overlay=states/<state>.yaml`
 * does — and compiles the Medicaid and SNAP work requirement rulesets. The
 * graphs, the citations their annotations name, the scenarios the rulesets
 * are tested with (grouped by decision as scenarios.yaml lists them), this
 * folder's questions and answers, the explorer's
 * palette, and the rules engine's browser bundle are
 * inlined into page.html, written as standalone.html.
 *
 * The page runs the rules engine on the compiled graphs directly; no mock
 * server, since evaluating a ruleset is all it does.
 *
 * The output is deterministic, so scripts/generate-artifacts.sh can rebuild it
 * and fail when the committed copy is stale.
 *
 * Usage: node demos/work-requirements/build.js
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { discover, load, resolve, generate } from '@codeforamerica/blueprint-core';
import { inputOf } from '@codeforamerica/blueprint-core/cel';
// The explorer's palette and font, so the demo looks like the blueprint's other
// pages. Read by path: this is a repo script, and the theme isn't part of the
// explorer's published API.
import { COLORS, FONT } from '../../packages/blueprint-explorer/src/lib/theme.js';
// The scenarios the rulesets are tested with, with every question each leaves
// out answered as the tests answer it, so the page can start from one.
import { scenariosFor } from '../../packages/safety-net-contracts/tests/scenarios.js';

const here = dirname(fileURLToPath(import.meta.url));
const CONTRACTS = resolvePath(here, '../../packages/safety-net-contracts');
const PROGRAMS = { medicaid: 'medicaidWorkRequirements', snap: 'snapWorkRequirements' };

const docs = discover(join(CONTRACTS, 'src')).map(load);
const packageOverlays = docs.filter((doc) => doc.type === 'overlay').map((doc) => doc.content);
const contracts = docs.filter((doc) => doc.type !== 'overlay');

const states = readdirSync(join(CONTRACTS, 'states'))
  .filter((file) => file.endsWith('.yaml'))
  .sort()
  .map((file) => {
    const overlay = yaml.load(readFileSync(join(CONTRACTS, 'states', file), 'utf8'));
    return { code: file.replace(/\.yaml$/, '').toUpperCase(), name: overlay.info.title.replace(/ work requirements$/, ''), overlay };
  });

/**
 * The inputs each fact reads directly, as the graph names them: `$.person.age`,
 * or `$.months[].hoursWorked` for a field of a list's items. The page groups
 * each question under the facts that read it.
 *
 * A graph's dependencies name an input list but not its items' fields, which
 * a per-item fact reads through its item's name (`month.hoursWorked`). Those
 * are found from inputOf: the input a list fact's items come from.
 */
function readsOf(graph) {
  const reads = {};
  const inputs = Object.keys(graph.inputs);
  for (const [fact, node] of Object.entries(graph.facts)) {
    const direct = (graph.dependencies[fact] ?? []).filter((dep) => dep.startsWith('$.') && !dep.endsWith('[]'));
    const fromItems = [];
    for (let at = fact.lastIndexOf('[].'); at >= 0; at = fact.lastIndexOf('[].', at - 1)) {
      const list = fact.slice(0, at);
      const as = graph.facts[list]?.as;
      const source = as && inputOf(graph, list);
      if (!source) continue;
      for (const [, field] of node.expression.matchAll(new RegExp(`(?<![A-Za-z0-9_.])${as}\\.([A-Za-z][A-Za-z0-9]*)`, 'g'))) {
        if (inputs.includes(`${source}.${field}`)) fromItems.push(`${source}.${field}`);
      }
    }
    // A list read whole — `months` in reviewMonths — is asked as the list.
    const lists = (graph.dependencies[fact] ?? []).filter((dep) => dep.startsWith('$.') && dep.endsWith('[]'));
    const all = [...new Set([...direct, ...fromItems, ...lists])];
    if (all.length) reads[fact] = all;
  }
  return reads;
}

/** The policies each key's annotation cites, by id. */
function citationsFor(section, ruleset) {
  return Object.fromEntries(Object.entries(section ?? {})
    .filter(([key]) => key.startsWith(`${ruleset}.`))
    .map(([key, annotation]) => [key.slice(ruleset.length + 1), annotation.policies ?? []]));
}

/** What each cited policy says, once: its citation, link and description. */
function policiesCited(programs, registry) {
  const ids = new Set(Object.values(programs).flatMap((p) => [...Object.values(p.citations), ...Object.values(p.constantCitations)].flat()));
  return Object.fromEntries([...ids].sort().map((id) => [id, {
    citation: registry[id]?.citation ?? id,
    url: registry[id]?.citationUrl ?? null,
    description: registry[id]?.description?.replace(/\s+/g, ' ').trim() ?? null,
  }]));
}

const jurisdictions = [{ code: 'US', name: 'Federal rules', overlay: null }, ...states].map(({ code, name, overlay }) => {
  const resolved = resolve(contracts, { overlays: [...packageOverlays, ...(overlay ? [overlay] : [])] });
  const graphs = generate(resolved.docs, 'graph');
  const annotations = resolved.docs.find((doc) => doc.relativePath?.endsWith('eligibility-annotations.yaml'))?.content ?? {};
  const registry = resolved.docs.find((doc) => doc.relativePath?.endsWith('platform-registry-policies.yaml'))?.content?.entries ?? {};
  const programs = Object.fromEntries(Object.entries(PROGRAMS).map(([program, ruleset]) => {
    const found = graphs.find(({ graph }) => graph.ruleset === ruleset);
    if (!found) throw new Error(`${name}: no ${ruleset} graph`);
    return [program, {
      graph: found.graph,
      reads: readsOf(found.graph),
      citations: citationsFor(annotations.facts, ruleset),
      constantCitations: citationsFor(annotations.constants, ruleset),
    }];
  }));
  return { code, name, programs, policies: policiesCited(programs, registry) };
});

/** Each program's scenarios: their story, state, answers and expected results. */
const scenarios = Object.fromEntries(Object.entries(PROGRAMS).map(([program, ruleset]) => [program, scenariosFor(ruleset).map((s) => {
  const state = s.state ?? 'US';
  if (!jurisdictions.some((j) => j.code === state)) throw new Error(`${s.id}: no state ${state}`);
  return { id: s.id, story: s.story, state, values: s.inputs, expect: s.expect };
})]));

const results = yaml.load(readFileSync(join(here, 'results.yaml'), 'utf8')).programs;

/** The scenarios the page lists, grouped by decision; every id and decision checked here. */
const groups = yaml.load(readFileSync(join(here, 'scenarios.yaml'), 'utf8')).programs;
for (const [program, list] of Object.entries(groups)) {
  for (const group of list) {
    if (!results[program]?.sections?.[group.decision]) throw new Error(`scenarios.yaml: ${group.title}: no section for ${group.decision} in results.yaml`);
    for (const { id } of group.scenarios) {
      if (!scenarios[program]?.some((s) => s.id === id)) throw new Error(`scenarios.yaml: ${group.title}: no ${program} scenario ${id}`);
    }
  }
}

const data = {
  jurisdictions,
  scenarios,
  groups,
  questions: yaml.load(readFileSync(join(here, 'questions.yaml'), 'utf8')).programs,
  results,
};

const require = createRequire(import.meta.url);
const engine = readFileSync(require.resolve('@codeforamerica/blueprint-rules-engine/browser'), 'utf8');

// Replacer functions, not strings: a string replacement reads `$&` and `$'`
// as patterns, and a minified bundle is full of `$`. `<` is escaped so the
// inlined text can't end its <script> early.
const theme = `:root { --font: ${FONT}; ${Object.entries(COLORS).map(([name, value]) => `--${name}: ${value};`).join(' ')} }`;
const page = readFileSync(join(here, 'page.html'), 'utf8')
  .replace('/* THEME */', () => theme)
  .replace('<!-- ENGINE -->', () => `<script>${engine.replace(/<\/script/gi, '<\\/script')}</script>`)
  .replace('<!-- DATA -->', () => `<script type="application/json" id="demo-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);

writeFileSync(join(here, 'standalone.html'), page);
console.log(`Wrote demos/work-requirements/standalone.html: ${jurisdictions.length} jurisdictions, ${Object.keys(PROGRAMS).length} programs, ${Math.round(page.length / 1024)} KB`);
