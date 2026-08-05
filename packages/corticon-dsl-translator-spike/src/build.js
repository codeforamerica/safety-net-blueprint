#!/usr/bin/env node
/**
 * Full pipeline: ingest → graph → classify → translate → visualize (rules, graph, crosswalk).
 * Usage: node src/build.js <fixtureDir> [--out-dir <dir>]
 * Example: node src/build.js fixtures/all-patterns
 *          node src/build.js fixtures/dc-medicaid-chip --out-dir generated
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

run('src/ingest-project.js',    fixtureDir,              '--out', out('project.json'));
run('src/graph-project.js',     out('project.json'),     '--out', out('graph.json'));
run('src/classify-project.js',  out('project.json'),     '--out', out('classified.json'));
run('src/translate-project.js', out('classified.json'),  '--out', out('translated.json'));
run('src/visualize-rules.js',   out('classified.json'),  '--out', out('diagram.html'));
run('src/visualize-graph.js',   out('translated.json'),  '--classified', out('classified.json'), '--out', out('graph.html'));
run('src/visualize-crosswalk.js', out('classified.json'), out('translated.crosswalk.json'), `--translated=${out('translated.json')}`, '--out', out('crosswalk.html'));
