/**
 * Golden file tests for rules-docs HTML generation.
 *
 * Generates HTML from the shared harness contracts and compares against committed
 * golden files. A failure here means the rendering changed — either update the
 * golden if the change was intentional, or investigate the regression.
 *
 * Resolved contracts: packages/blueprint-harness/generated/resolved/
 * Golden outputs:     tests/rules-docs/goldens/
 *
 * To regenerate golden outputs, run:
 *   node -e "
 *     import { readFileSync, writeFileSync, mkdirSync } from 'fs';
 *     import { join } from 'path';
 *     import { load } from 'js-yaml';
 *     import { generateRulesetHtml } from './src/rules-docs/generate-html.js';
 *     const resolvedDir = 'packages/blueprint-harness/generated/resolved';
 *     const goldensDir  = 'packages/blueprint-explorer/tests/rules-docs/goldens';
 *     mkdirSync(goldensDir, { recursive: true });
 *     const HUB_HREF = '../index.html';
 *     const policies = load(readFileSync(join(resolvedDir, 'domains/platform/platform-policies.yaml'), 'utf8'))?.policies ?? {};
 *     const rulesets = [
 *       { domain: 'eligibility', rulesetName: 'expeditedSnap' },
 *       { domain: 'eligibility', rulesetName: 'interviewProbes' },
 *     ];
 *     for (const { domain, rulesetName } of rulesets) {
 *       const domainDir = join(resolvedDir, 'domains', domain);
 *       const graph = load(readFileSync(join(resolvedDir, 'domains', domain, domain + '-' + rulesetName + '-graph.yaml'), 'utf8'));
 *       const examples = load(readFileSync(join(domainDir, domain + '-rules-examples.yaml'), 'utf8'))?.rulesets?.[rulesetName]?.examples ?? [];
 *       const rulesetInputs = load(readFileSync(join(domainDir, domain + '-rules.yaml'), 'utf8'))?.rulesets?.[rulesetName]?.inputs ?? {};
 *       const annotationDoc = load(readFileSync(join(domainDir, domain + '-annotations.yaml'), 'utf8'));
 *       const annotations = {};
 *       for (const [key, value] of Object.entries(annotationDoc?.facts ?? {})) {
 *         if (key.startsWith(rulesetName + '.')) annotations[key.slice(rulesetName.length + 1)] = value;
 *       }
 *       const html = generateRulesetHtml(graph, annotations, policies, examples, rulesetInputs, { hubHref: HUB_HREF });
 *       writeFileSync(join(goldensDir, domain + '-' + rulesetName + '.html'), html);
 *     }
 *   " --input-type=module
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { generateRulesetHtml } from '../../src/rules-docs/generate-html.js';
import { resolvedDir } from '../paths.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const goldensDir = join(__dirname, 'goldens');

const HUB_HREF = '../index.html';

function loadYaml(path) { return load(readFileSync(path, 'utf8')); }

const rulesets = [
  { domain: 'eligibility', rulesetName: 'expeditedSnap' },
  { domain: 'eligibility', rulesetName: 'interviewProbes' },
];

describe('rules-docs golden', () => {
  const policies = loadYaml(join(resolvedDir, 'domains', 'platform', 'platform-policies.yaml'))?.policies ?? {};

  for (const { domain, rulesetName } of rulesets) {
    const domainDir      = join(resolvedDir, 'domains', domain);
    const graphPath      = join(resolvedDir, 'domains', domain, `${domain}-${rulesetName}-graph.yaml`);
    const rulesPath      = join(domainDir, `${domain}-rules.yaml`);
    const examplesPath   = join(domainDir, `${domain}-rules-examples.yaml`);
    const annotationsPath = join(domainDir, `${domain}-annotations.yaml`);

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
        `HTML differs from golden — regenerate if the change was intentional`);
    });
  }
});
