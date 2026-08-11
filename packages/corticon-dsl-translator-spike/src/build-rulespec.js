#!/usr/bin/env node
/**
 * Rulespec full pipeline: ingest → classify → translate → visualize.
 * Usage: node src/build-rulespec.js <fixture.yaml> [--out-dir <dir>]
 * Example: node src/build-rulespec.js fixtures/rulespec/community-engagement/community-engagement.yaml
 *          node src/build-rulespec.js fixtures/rulespec/community-engagement/community-engagement.yaml --out-dir generated
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import jsYaml from 'js-yaml';

const args = process.argv.slice(2);
const fixtureFile = args.find(a => !a.startsWith('--'));
if (!fixtureFile) {
  console.error('Usage: node src/build-rulespec.js <fixture.yaml> [--out-dir <dir>]');
  process.exit(1);
}

const outDirIdx = args.indexOf('--out-dir');
const outDir = outDirIdx >= 0 ? args[outDirIdx + 1] : 'generated';
mkdirSync(outDir, { recursive: true });

const slug = basename(fixtureFile, '.yaml');
const out = name => join(outDir, `${slug}-${name}`);

// Derive domain and graphName from the rulespec YAML per the rulespec naming convention:
// domain = module.program from the YAML (e.g. "medicaid")
// graphName = camelCase of the filename stem (e.g. "community-engagement" -> "communityEngagement")
const fixtureYaml = jsYaml.load(readFileSync(fixtureFile, 'utf-8'));
const domain = fixtureYaml?.module?.program ?? slug;
const slugParts = slug.split('-');
const graphName = slugParts.map((p, i) => i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)).join('');

function run(...nodeArgs) {
  console.log('>', 'node', nodeArgs.join(' '));
  execFileSync('node', nodeArgs, { stdio: 'inherit' });
}

run('src/sources/rulespec/ingest-rulespec.js',   fixtureFile,          '--out', out('rulespec.json'));
run('src/sources/rulespec/classify-rulespec.js', out('rulespec.json'), '--out', out('patterns.json'), '--graph', out('graph.json'), '--schema-graph', out('schema-graph.json'), '--translation-log', out('translation-log.json'));
run('src/visualizers/visualize-html.js', slug, '--graph', out('schema-graph.json'), '--rulespec', fixtureFile, '--translation-log', out('translation-log.json'), '--out', join(outDir, `${slug}.html`));
