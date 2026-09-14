/**
 * Golden file tests for rules-docs HTML generation.
 *
 * Generates HTML from the fixture contracts and compares against committed
 * golden files. A failure here means the rendering changed — either update
 * the golden with `npm run test:goldens-regenerate` if the change was
 * intentional, or investigate the regression.
 *
 * Golden files live in: tests/rules-docs/fixtures/content/rules-docs/
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { generateRulesetHtml } from '../../src/rules-docs/generate-html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = join(__dirname, 'fixtures/contracts');
const goldensDir   = join(__dirname, 'fixtures/content/rules-docs');

// hubHref mirrors what build.js computes:
//   relative('fixtures/content/rules-docs', 'fixtures/content/index.html') = '../index.html'
const HUB_HREF = '../index.html';

function loadYaml(path) { return load(readFileSync(path, 'utf8')); }

function loadAnnotations(domain, rulesetName) {
  const doc = loadYaml(join(contractsDir, `${domain}-annotations.yaml`));
  const out = {};
  for (const [key, value] of Object.entries(doc?.facts ?? {})) {
    if (key.startsWith(`${rulesetName}.`)) {
      out[key.slice(rulesetName.length + 1)] = value;
    }
  }
  return out;
}

// ── Golden comparisons ────────────────────────────────────────────────────────

const rulesets = [
  { domain: 'test', rulesetName: 'main' },
];

describe('rules-docs golden', () => {
  const policies = loadYaml(join(contractsDir, 'test-policies.yaml')) ?? {};

  for (const { domain, rulesetName } of rulesets) {
    const graph         = loadYaml(join(contractsDir, `${domain}-graph.yaml`));
    const annotations   = loadAnnotations(domain, rulesetName);
    const examples      = loadYaml(join(contractsDir, `${domain}-rules-examples.yaml`))?.rulesets?.[rulesetName]?.examples ?? [];
    const rulesetInputs = loadYaml(join(contractsDir, `${domain}-rules.yaml`))?.rulesets?.[rulesetName]?.inputs ?? {};

    it(`${domain}/${rulesetName} matches golden file`, () => {
      const html   = generateRulesetHtml(graph, annotations, policies, examples, rulesetInputs, { hubHref: HUB_HREF });
      const golden = readFileSync(join(goldensDir, `${domain}-${rulesetName}.html`), 'utf8');
      assert.strictEqual(html, golden,
        `HTML differs from golden — run \`npm run test:goldens-regenerate\` if the change was intentional`);
    });
  }
});
