#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { toJson, parseCliArgs } from '../../cli-utils.js';
import { ENGINES, DEFAULT_ENGINE, resolveEngine } from '../../engines.js';

function printUsage() {
  console.error('Usage: node src/ingest-project.js <project-dir> [--engine <name>] [--out <file.json>]');
  console.error(`  --engine defaults to "${DEFAULT_ENGINE}". Known engines: ${Object.keys(ENGINES).join(', ')}`);
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

let loadProject;
try {
  ({ loadProject } = await resolveEngine(args.engine ?? DEFAULT_ENGINE));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const project = loadProject(args.positional);
const summary = summarize(project);

if (args.outFile) {
  // Stamp ruleId onto each rule so consumers can resolve a ruleId from graph edges
  // directly against the source file without knowing the encoding convention.
  for (const [file, rulesheet] of project.rulesheets.entries()) {
    rulesheet.rules.forEach((rule, index) => { rule.ruleId = `${file}:${index}`; });
  }
  writeFileSync(args.outFile, JSON.stringify(toJson({ sourceType: 'corticon', ...project }), null, 2));
  console.log(`Wrote full project model to ${args.outFile}`);
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(JSON.stringify(summary, null, 2));
}
