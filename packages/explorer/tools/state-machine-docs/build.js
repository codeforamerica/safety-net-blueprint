import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { generate, generateOverview, generateEventsPage, buildEventIndex } from './src/generate.js';
import { generateHtml, generateOverviewHtml } from './src/generate-html.js';
import { resolvedDir } from '../../lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir   = join(__dirname);

const files = readdirSync(resolvedDir)
  .filter(f => f.endsWith('-state-machine.yaml'))
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
