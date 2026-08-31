#!/usr/bin/env node
/**
 * Full pipeline: ingest → translate → visualize.
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

run('src/sources/corticon/ingest-project.js',    fixtureDir,            '--out', out('source.json'));
run('src/sources/corticon/translate-project.js', out('source.json'), '--out', out('graph.json'), '--translation-log', out('translation-log.json'));
run('src/visualizers/visualize-html.js', slug,
  '--project',         out('source.json'),
  '--graph',           out('graph.json'),
  '--translation-log', out('translation-log.json'),
  '--out',             join(outDir, `${slug}.html`));
