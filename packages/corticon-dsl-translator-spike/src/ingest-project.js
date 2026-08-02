#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { loadProject } from './ingest/project.js';
import { toJson, parseCliArgs } from './cli-utils.js';

function printUsage() {
  console.error('Usage: node src/ingest-project.js <corticon-project-dir> [--out <file.json>]');
  console.error('Example: node src/ingest-project.js fixtures/dc-medicaid-chip --out generated/dc-medicaid-chip.json');
}

function summarize(project) {
  const ruleCount = (rulesheet) => rulesheet.rules.length;
  return {
    projectDir: project.projectDir,
    vocabularies: [...project.vocabularies.entries()].map(([file, v]) => ({
      file,
      entities: [...v.entities.keys()],
    })),
    rulesheets: [...project.rulesheets.entries()].map(([file, r]) => ({ file, rules: ruleCount(r) })),
    ruleflows: [...project.ruleflows.entries()].map(([file, f]) => ({
      file,
      nodes: f.nodes.map((n) => ({ kind: n.kind, name: n.name, iterative: n.iterative })),
    })),
    ruletests: [...project.ruletests.entries()].map(([file, sheets]) => ({
      file,
      testsheets: sheets.length,
      totalTraceEntries: sheets.reduce((n, s) => n + s.trace.length, 0),
    })),
  };
}

const args = parseCliArgs(process.argv);
if (!args) {
  printUsage();
  process.exit(0);
}

const project = loadProject(args.positional);
const summary = summarize(project);

if (args.outFile) {
  writeFileSync(args.outFile, JSON.stringify(toJson(project), null, 2));
  console.log(`Wrote full project model to ${args.outFile}`);
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(JSON.stringify(summary, null, 2));
}
