#!/usr/bin/env node
/**
 * Test, validate, and rebuild all generated HTML fixtures.
 * Usage: node src/build-all.js [--out-dir <dir>]
 */
import { execFileSync, execSync } from 'node:child_process';
import { argv } from 'node:process';

const args = argv.slice(2);
const outDirIdx = args.indexOf('--out-dir');
const outDir = outDirIdx >= 0 ? args[outDirIdx + 1] : 'generated';

function run(...nodeArgs) {
  console.log('>', 'node', nodeArgs.join(' '));
  execFileSync('node', nodeArgs, { stdio: 'inherit' });
}

function runCmd(cmd) {
  console.log('>', cmd);
  execSync(cmd, { stdio: 'inherit' });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

console.log('\n── Tests ─────────────────────────────────────────────────────────\n');
runCmd('node --test src/tests/');

// ── Corticon fixtures ──────────────────────────────────────────────────────────

console.log('\n── Corticon fixtures ─────────────────────────────────────────────\n');
const corticonFixtures = [
  'fixtures/corticon/government/dc-medicaid-chip',
  'fixtures/corticon/synthetic/all-patterns',
  'fixtures/corticon/synthetic/branch-reconstruction',
  'fixtures/corticon/synthetic/snap-work-requirements',
  'fixtures/corticon/vendor-samples/irr',
  'fixtures/corticon/vendor-samples/mortgage',
  'fixtures/corticon/vendor-samples/servicecallout',
  'fixtures/state-specific/cbms-disaster-fs',
  'fixtures/state-specific/expedited-snap',
];
for (const fixture of corticonFixtures) {
  run('src/build.js', fixture, '--out-dir', outDir);
}

// ── Rulespec fixtures ──────────────────────────────────────────────────────────

console.log('\n── Rulespec fixtures ─────────────────────────────────────────────\n');
run('src/build-rulespec.js',
  'fixtures/rulespec/community-engagement/community-engagement.yaml',
  '--out-dir', outDir,
);

// ── Hand-authored graph fixtures ──────────────────────────────────────────────

console.log('\n── Graph fixtures ────────────────────────────────────────────────\n');
run('src/visualizers/visualize-html.js', 'expedited-snap-federal',
  '--graph', 'fixtures/graph/expedited-snap-federal-graph.json',
  '--out', `${outDir}/expedited-snap-federal.html`,
);

// ── State-specific overlays ────────────────────────────────────────────────────

console.log('\n── State overlays ────────────────────────────────────────────────\n');
run('src/apply-overlay.js',
  '--base',    'fixtures/graph/expedited-snap-federal-graph.json',
  '--overlay', 'fixtures/state-specific/expedited-snap-co.overlay.json',
  '--out',     `${outDir}/expedited-snap-co-graph.json`,
);
run('src/visualizers/visualize-html.js', 'expedited-snap-co',
  '--graph', `${outDir}/expedited-snap-co-graph.json`,
  '--out',   `${outDir}/expedited-snap-co.html`,
);

console.log('\n── Done ──────────────────────────────────────────────────────────\n');
