/**
 * Golden file tests for rules-docs HTML generation.
 *
 * Generates HTML from the shared harness contracts and compares against committed
 * golden files. A failure here means the rendering changed — either update the
 * golden with `npm run test:goldens-regenerate` if the change was intentional,
 * or investigate the regression.
 *
 * Resolved contracts: packages/blueprint-harness/resolved/
 * Golden outputs:     tests/rules-docs/goldens/
 *
 * To regenerate golden outputs:
 *   node src/rules-docs/build.js \
 *     --content=tests/rules-docs/goldens \
 *     --resolved=../../blueprint-harness/resolved
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { generateRulesetHtml } from '../../src/rules-docs/generate-html.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const harnessDir = join(__dirname, '../../../blueprint-harness');
const resolvedDir = join(harnessDir, 'resolved');
const goldensDir = join(__dirname, 'goldens');

// hubHref mirrors what build.js computes:
//   relative('goldens/rules-docs', 'goldens/index.html') = '../index.html'
const HUB_HREF = '../index.html';

function loadYaml(path) { return load(readFileSync(path, 'utf8')); }

// ── Harness file locations ────────────────────────────────────────────────────
// Resolved structure: resolved/alerts-urgency-graph.yaml (root),
//   resolved/domains/alerts/{annotations,rules,rules-examples}.yaml,
//   resolved/domains/platform/platform-policies.yaml

const alertsDir = join(resolvedDir, 'domains', 'alerts');

const rulesets = [
  {
    domain:     'alerts',
    rulesetName: 'urgency',
    graphPath:   join(resolvedDir, 'alerts-urgency-graph.yaml'),
    rulesPath:   join(alertsDir,   'alerts-rules.yaml'),
    examplesPath: join(alertsDir,  'alerts-rules-examples.yaml'),
    annotationsPath: join(alertsDir, 'alerts-annotations.yaml'),
  },
];

describe('rules-docs golden', () => {
  const policies = loadYaml(join(resolvedDir, 'domains', 'platform', 'platform-policies.yaml'))?.policies ?? {};

  for (const { domain, rulesetName, graphPath, rulesPath, examplesPath, annotationsPath } of rulesets) {
    const graph         = loadYaml(graphPath);
    const examples      = loadYaml(examplesPath)?.rulesets?.[rulesetName]?.examples ?? [];
    const rulesetInputs = loadYaml(rulesPath)?.rulesets?.[rulesetName]?.inputs ?? {};

    const annotationDoc = loadYaml(annotationsPath);
    const annotations = {};
    for (const [key, value] of Object.entries(annotationDoc?.facts ?? {})) {
      if (key.startsWith(`${rulesetName}.`)) {
        annotations[key.slice(rulesetName.length + 1)] = value;
      }
    }

    it(`${domain}/${rulesetName} matches golden file`, () => {
      const html   = generateRulesetHtml(graph, annotations, policies, examples, rulesetInputs, { hubHref: HUB_HREF });
      const golden = readFileSync(join(goldensDir, `${domain}-${rulesetName}.html`), 'utf8');
      assert.strictEqual(html, golden,
        `HTML differs from golden — run \`npm run test:goldens-regenerate\` if the change was intentional`);
    });
  }
});
