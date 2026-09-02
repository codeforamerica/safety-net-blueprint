import { readdirSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { generate, generateOverview, generateEventsPage } from './generate.js';
import { buildEventIndex } from '@codeforamerica/blueprint-core';
import { generateHtml, generateOverviewHtml } from './generate-html.js';
import { resolvedDir } from '../lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const contentArg = process.argv.find(a => a.startsWith('--content='));
if (!contentArg) {
  console.error('Usage: node build.js --content=<path> [--resolved=<path>]');
  process.exit(1);
}
const contentDir = resolve(process.cwd(), contentArg.slice('--content='.length));
const outputDir = join(contentDir, 'state-machine-docs');
mkdirSync(outputDir, { recursive: true });
readdirSync(outputDir).filter(f => f.endsWith('.html')).forEach(f => rmSync(join(outputDir, f)));

const files = readdirSync(resolvedDir, { recursive: true })
  .filter(f => typeof f === 'string' && f.endsWith('-state-machine.yaml'))
  .map(f => join(resolvedDir, f));

if (!files.length) {
  console.error('No *-state-machine.yaml files found in', resolvedDir);
  process.exit(1);
}

// Platform file has no machines — skip it for doc generation
const domainFiles = files.filter(f => {
  const sm = load(readFileSync(f, 'utf8'));
  return sm.domain && Array.isArray(sm.machines);
});

const allStateMachines = domainFiles.map(f => load(readFileSync(f, 'utf8')));
const eventIndex = buildEventIndex(allStateMachines);

console.log(`Generating state machine docs for ${domainFiles.length} domain(s)...`);

for (const file of domainFiles) {
  generate(file, outputDir, eventIndex, allStateMachines);
  generateHtml(file, outputDir, eventIndex, allStateMachines);
}

generateOverview(allStateMachines, outputDir);
generateOverviewHtml(allStateMachines, outputDir, eventIndex);
generateEventsPage(eventIndex, allStateMachines, outputDir);
console.log('Done.');
