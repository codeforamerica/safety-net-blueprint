import { readdirSync, readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { generate, generateOverview, generateEventsPage, buildEventIndex } from './src/generate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '../../contracts');
const outputDir    = join(__dirname, 'output');

const files = readdirSync(contractsDir)
  .filter(f => f.endsWith('-state-machine.yaml'))
  .map(f => join(contractsDir, f));

if (!files.length) {
  console.error('No *-state-machine.yaml files found in', contractsDir);
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
}

generateOverview(allStateMachines, outputDir);
generateEventsPage(eventIndex, allStateMachines, outputDir);
console.log('Done.');
