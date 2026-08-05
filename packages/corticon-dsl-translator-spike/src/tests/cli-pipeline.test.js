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
 * Full pipeline: ingest-project.js -> classify-project.js -> translate-project.js.
 * graph-project.js is exercised in the same test as an optional diagnostic step
 * (it no longer feeds classify, but its output shape is still verified).
 */
const FIXTURES = [
  'fixtures/dc-medicaid-chip',
  'fixtures/irr',
  'fixtures/mortgage',
  'fixtures/servicecallout',
  'fixtures/branch-reconstruction',
  'fixtures/all-patterns',
];

for (const fixtureDir of FIXTURES) {
  test(`pipeline: ingest-project.js -> graph-project.js -> classify-project.js -> translate-project.js runs end-to-end for ${fixtureDir}`, () => {
    const scratch = mkdtempSync(join(tmpdir(), 'corticon-pipeline-'));
    try {
      const projectJsonPath = join(scratch, 'project.json');
      const graphJsonPath = join(scratch, 'project.graph.json');
      const classifiedJsonPath = join(scratch, 'project.classified.json');
      const translatedJsonPath = join(scratch, 'project.translated.json');
      const crosswalkJsonPath = join(scratch, 'project.translated.crosswalk.json');

      execFileSync('node', ['src/ingest-project.js', fixtureDir, '--out', projectJsonPath], { encoding: 'utf-8' });
      const project = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));
      assert.ok(project.rulesheets, 'ingest-project.js --out should write a project with rulesheets');
      assert.ok(project.ruleflows, 'ingest-project.js --out should write a project with ruleflows');
      assert.ok(project.vocabularies, 'ingest-project.js --out should write a project with vocabularies');

      // graph-project.js is an optional diagnostic step -- no longer feeds classify,
      // but its output shape is still verified here.
      execFileSync('node', ['src/graph-project.js', projectJsonPath, '--out', graphJsonPath], { encoding: 'utf-8' });
      const combined = JSON.parse(readFileSync(graphJsonPath, 'utf-8'));
      assert.ok(combined.project, 'graph-project.js --out should carry the original project through, not just the graph');
      assert.deepEqual(combined.project.rulesheets, project.rulesheets, 'the carried-through project should match Phase 1\'s own output exactly');
      assert.ok(combined.graph, 'graph-project.js --out should include the derived graph');
      assert.ok(Array.isArray(combined.graph.edges), 'graph.edges should be an array');
      assert.ok(combined.graph.nodes && typeof combined.graph.nodes === 'object', 'graph.nodes should be present');

      // classify-project.js takes project.json directly (not graph.json).
      execFileSync('node', ['src/classify-project.js', projectJsonPath, '--out', classifiedJsonPath], { encoding: 'utf-8' });
      const classified = JSON.parse(readFileSync(classifiedJsonPath, 'utf-8'));
      assert.ok(classified.project, 'classify-project.js --out should carry the original project through, not just the classification');
      assert.deepEqual(classified.project.rulesheets, project.rulesheets, 'the carried-through project should match Phase 1\'s own output exactly');
      assert.ok(classified.classification, 'classify-project.js --out should include the classification');
      for (const key of ['selfLoops', 'multiHopCycles', 'crossRulesheetAssembly', 'decisionTableCombinatorics', 'entityCreation', 'serviceCallouts', 'filters', 'expressionPatterns', 'noOps']) {
        assert.ok(Array.isArray(classified.classification[key]), `classify-project.js --out should include an array for classification.${key}`);
      }

      execFileSync('node', ['src/translate-project.js', classifiedJsonPath, '--out', translatedJsonPath], { encoding: 'utf-8' });
      const translated = JSON.parse(readFileSync(translatedJsonPath, 'utf-8'));
      const crosswalkDoc = JSON.parse(readFileSync(crosswalkJsonPath, 'utf-8'));
      assert.ok(Array.isArray(translated.facts), 'translate-project.js --out should write a Facts-only file');
      assert.ok(Array.isArray(crosswalkDoc.crosswalk), 'translate-project.js --out should write a separate <file>.crosswalk.json for the Vocabulary<->Fact crosswalk');
      for (const fact of translated.facts) {
        assert.ok(fact.path?.startsWith('/'), `every compiled Fact path should be a real decision-rules DSL path, got: ${fact.path}`);
        assert.ok(fact.derived !== undefined || fact.writable === true, `every compiled Fact should be either Derived or Writable, got: ${JSON.stringify(fact)}`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}
