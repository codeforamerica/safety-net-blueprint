import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs the *real* CLI scripts as subprocesses, chained exactly as a user would
 * from the command line -- unlike every other test file, which calls the
 * underlying functions directly. This is what actually proves each script's own
 * argument parsing, file I/O, and output shape work, not just the library code
 * underneath it.
 *
 * Pipeline: ingest-project.js -> translate-project.js (classify is now internal).
 * classify-project.js is also exercised as a standalone tool to verify it still works.
 */
const FIXTURES = [
  'fixtures/corticon/government/dc-medicaid-chip',
  'fixtures/corticon/vendor-samples/irr',
  'fixtures/corticon/vendor-samples/mortgage',
  'fixtures/corticon/vendor-samples/servicecallout',
  'fixtures/corticon/synthetic/branch-reconstruction',
  'fixtures/corticon/synthetic/all-patterns',
  'fixtures/corticon/synthetic/snap-work-requirements',
];

for (const fixtureDir of FIXTURES) {
  test(`pipeline: ingest-project.js -> translate-project.js runs end-to-end for ${fixtureDir}`, () => {
    const scratch = mkdtempSync(join(tmpdir(), 'corticon-pipeline-'));
    try {
      const projectJsonPath      = join(scratch, 'project.json');
      const classifiedJsonPath   = join(scratch, 'project.patterns.json');
      const graphJsonPath        = join(scratch, 'graph.json');
      const translationLogPath   = join(scratch, 'translation-log.json');

      execFileSync('node', ['src/sources/corticon/ingest-project.js', fixtureDir, '--out', projectJsonPath], { encoding: 'utf-8' });
      const project = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));
      assert.ok(project.rulesheets, 'ingest-project.js --out should write a project with rulesheets');
      assert.ok(project.ruleflows, 'ingest-project.js --out should write a project with ruleflows');
      assert.ok(project.vocabularies, 'ingest-project.js --out should write a project with vocabularies');

      // classify-project.js is still usable as a standalone tool.
      execFileSync('node', ['src/sources/corticon/classify-project.js', projectJsonPath, '--out', classifiedJsonPath], { encoding: 'utf-8' });
      const classified = JSON.parse(readFileSync(classifiedJsonPath, 'utf-8'));
      assert.ok(classified.sourceFile, 'classify-project.js --out should reference the source file');
      assert.ok(classified.classification, 'classify-project.js --out should include the classification');
      assert.ok(Array.isArray(classified.classification.patterns), 'classify-project.js --out should include classification.patterns as an array');
      assert.ok('sinkCandidates' in classified.classification, 'classify-project.js --out should include classification.sinkCandidates');

      // translate-project.js now takes input.json directly; classification runs internally.
      execFileSync('node', ['src/sources/corticon/translate-project.js', projectJsonPath, '--out', graphJsonPath, '--translation-log', translationLogPath], { encoding: 'utf-8' });

      const graph = JSON.parse(readFileSync(graphJsonPath, 'utf-8'));
      assert.ok(graph.nodes && typeof graph.nodes === 'object' && !Array.isArray(graph.nodes), 'translate-project.js --out should write a graph with nodes as a path-keyed object');
      assert.ok(graph.edges && typeof graph.edges === 'object' && !Array.isArray(graph.edges), 'translate-project.js --out should write a graph with edges as an edgeId-keyed object');
      for (const [path, node] of Object.entries(graph.nodes)) {
        assert.ok(typeof path === 'string' && path.length > 0, `every graph node key should be a non-empty string, got: ${path}`);
        const isInput = path.startsWith('$.');
        if (isInput) {
          assert.ok(!node.expression, `input node ${path} should not have an expression`);
        } else {
          assert.ok(node.expression !== undefined, `derived node ${path} should have an expression`);
        }
      }
      for (const [edgeId, pairs] of Object.entries(graph.edges)) {
        assert.ok(typeof edgeId === 'string' && edgeId.length > 0, `every edge key should be a non-empty edgeId string, got: ${edgeId}`);
        assert.ok(Array.isArray(pairs) && pairs.length > 0, `every edge value should be a non-empty array of {from,to} pairs, got: ${JSON.stringify(pairs)}`);
        for (const pair of pairs) {
          assert.ok(pair.from && pair.to, `every edge pair should have from and to, got: ${JSON.stringify(pair)}`);
        }
      }

      const translationLogRaw = JSON.parse(readFileSync(translationLogPath, 'utf-8'));
      assert.ok(translationLogRaw && typeof translationLogRaw === 'object' && !Array.isArray(translationLogRaw), 'translation log should be an object with entries and sinkCandidates');
      assert.ok(translationLogRaw.entries && typeof translationLogRaw.entries === 'object' && !Array.isArray(translationLogRaw.entries), 'translation log entries should be a pattern-keyed object');
      assert.ok(translationLogRaw.sinkCandidates && typeof translationLogRaw.sinkCandidates === 'object', 'translation log should have a sinkCandidates object');
      for (const [, sc] of Object.entries(translationLogRaw.sinkCandidates)) {
        assert.ok(typeof sc.nodeCount === 'number', `sinkCandidate should have nodeCount, got: ${JSON.stringify(sc)}`);
        assert.ok(typeof sc.depth === 'number', `sinkCandidate should have depth, got: ${JSON.stringify(sc)}`);
      }
      for (const [pattern, entries] of Object.entries(translationLogRaw.entries)) {
        assert.ok(typeof pattern === 'string' && pattern.length > 0, `every entries key should be a pattern name, got: ${pattern}`);
        assert.ok(Array.isArray(entries), `entries[${pattern}] should be an array, got: ${JSON.stringify(entries)}`);
        for (const entry of entries) {
          assert.ok(entry.pattern === pattern, `every entry under pattern key "${pattern}" should have matching pattern field, got: ${JSON.stringify(entry)}`);
          assert.ok(['confirmed', 'inferred', 'unsupported', 'error'].includes(entry.status), `every entry should have a valid status, got: ${JSON.stringify(entry)}`);
          assert.ok(typeof entry.translated === 'boolean', `every entry should have a boolean translated field, got: ${JSON.stringify(entry)}`);
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}
