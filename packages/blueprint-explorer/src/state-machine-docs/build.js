import { readdirSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { dirname, join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { generate, generateOverview, generateEventsPage } from './generate.js';
import { buildEventIndex } from '@codeforamerica/blueprint-core/state-machines';
import { buildEndpointIndex } from '@codeforamerica/blueprint-core/openapi';
import { generateHtml, generateOverviewHtml, generateEventsHtml } from './generate-html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @param {{ contentDir: string, resolvedDir: string }} opts
 */
export function build({ contentDir, resolvedDir }) {
const outputDir = join(contentDir, 'state-machine-docs');
const hubHref = relative(outputDir, join(contentDir, 'index.html'));
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

const openApiFiles = readdirSync(resolvedDir, { recursive: true })
  .filter(f => typeof f === 'string' && f.endsWith('-openapi.yaml'))
  .map(f => ({ spec: load(readFileSync(join(resolvedDir, f), 'utf8')) }));
const endpointIndex = buildEndpointIndex(openApiFiles);

console.log(`Generating state machine docs for ${domainFiles.length} domain(s)...`);

for (const file of domainFiles) {
  generate(file, outputDir, eventIndex, allStateMachines);
  generateHtml(file, outputDir, eventIndex, allStateMachines, hubHref, endpointIndex);
}

generateOverview(allStateMachines, outputDir);
generateOverviewHtml(allStateMachines, outputDir, eventIndex, hubHref);
generateEventsPage(eventIndex, allStateMachines, outputDir);
generateEventsHtml(eventIndex, allStateMachines, outputDir, hubHref);
console.log('Done.');
} // end build()

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const contentArg  = process.argv.find(a => a.startsWith('--content='));
  const resolvedArg = process.argv.find(a => a.startsWith('--resolved='));
  if (!contentArg) {
    console.error('Usage: node build.js --content=<path> [--resolved=<path>]');
    process.exit(1);
  }
  build({
    contentDir:  resolve(process.cwd(), contentArg.slice('--content='.length)),
    resolvedDir: resolvedArg ? resolve(process.cwd(), resolvedArg.slice('--resolved='.length)) : null,
  });
}
