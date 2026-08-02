#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { loadProject } from './ingest/project.js';

function printUsage() {
  console.error('Usage: node src/ingest-project.js <corticon-project-dir> [--out <file.json>]');
  console.error('Example: node src/ingest-project.js fixtures/dc-medicaid-chip --out generated/dc-medicaid-chip.json');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return null;
  }
  const outIndex = args.indexOf('--out');
  const hasOut = outIndex >= 0;
  const outFile = hasOut ? args[outIndex + 1] : undefined;
  const excluded = hasOut ? new Set([outIndex, outIndex + 1]) : new Set();
  const projectDir = args.filter((_, i) => !excluded.has(i))[0];
  return { projectDir, outFile };
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

function toJson(map) {
  if (map instanceof Map) return Object.fromEntries([...map].map(([k, v]) => [k, toJson(v)]));
  if (Array.isArray(map)) return map.map(toJson);
  if (map && typeof map === 'object') return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, toJson(v)]));
  return map;
}

const args = parseArgs(process.argv);
if (!args) {
  printUsage();
  process.exit(args === null ? 0 : 1);
}

const project = loadProject(args.projectDir);
const summary = summarize(project);

if (args.outFile) {
  writeFileSync(args.outFile, JSON.stringify(toJson(project), null, 2));
  console.log(`Wrote full project model to ${args.outFile}`);
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(JSON.stringify(summary, null, 2));
}
