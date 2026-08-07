#!/usr/bin/env node
/**
 * Full pipeline: ingest → classify → translate → visualize.
 * Usage: node src/build.js <fixtureDir> [--out-dir <dir>]
 * Example: node src/build.js fixtures/corticon/synthetic/all-patterns
 *          node src/build.js fixtures/corticon/government/dc-medicaid-chip --out-dir generated
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const fixtureDir = args.find(a => !a.startsWith('--'));
if (!fixtureDir) {
  console.error('Usage: node src/build.js <fixtureDir> [--out-dir <dir>]');
  process.exit(1);
}

const outDirIdx = args.indexOf('--out-dir');
const outDir = outDirIdx >= 0 ? args[outDirIdx + 1] : 'generated';
mkdirSync(outDir, { recursive: true });

const slug = basename(fixtureDir);
const out = name => join(outDir, `${slug}-${name}`);

function run(...nodeArgs) {
  console.log('>', 'node', nodeArgs.join(' '));
  execFileSync('node', nodeArgs, { stdio: 'inherit' });
}

run('src/sources/corticon/ingest-project.js',    fixtureDir,                    '--out', out('corticon.json'));
run('src/sources/corticon/classify-project.js',  out('corticon.json'),           '--out', out('patterns.json'));
run('src/sources/corticon/translate-project.js', out('patterns.json'),  '--out', out('blueprint-dsl.json'));
run('src/sources/corticon/visualize-rules-html.js', slug,
  '--classified', out('patterns.json'),
  '--project',    out('corticon.json'),
  '--out',        join(outDir, `${slug}-rules.html`));
run('src/targets/blueprint-dsl/visualize-graph-html.js', slug,
  '--classified',  out('patterns.json'),
  '--translated',  out('blueprint-dsl.json'),
  '--graph',       out('graph.json'),
  '--out',         join(outDir, `${slug}-graph.html`));
