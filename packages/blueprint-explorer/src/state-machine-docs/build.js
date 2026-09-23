import { readdirSync, rmSync, mkdirSync } from 'fs';
import { dirname, join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { generate, generateOverview, generateEventsPage } from './generate.js';
import { buildEventIndex } from '../contract-nav.js';
import { discover, extract, load } from '@codeforamerica/blueprint-core';
import { stateMachineView } from './walk.js';
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

const stateMachines = discover(resolvedDir, 'state-machine').map(load);

if (!stateMachines.length) {
  console.error('No state machine contracts found in', resolvedDir);
  process.exit(1);
}

// A base state machine declares shared procedures and no machines of its
// own; there is nothing to document for it.
const domains = stateMachines
  .filter((doc) => doc.domain && Array.isArray(doc.content?.machines))
  .map(stateMachineView);

const eventIndex = buildEventIndex(stateMachines);

const endpointIndex = extract(discover(resolvedDir, 'openapi').map(load), 'relationships');

console.log(`Generating state machine docs for ${domains.length} domain(s)...`);

for (const sm of domains) {
  generate(sm, outputDir, eventIndex, domains);
  generateHtml(sm, outputDir, eventIndex, domains, hubHref, endpointIndex);
}

generateOverview(domains, outputDir);
generateOverviewHtml(domains, outputDir, eventIndex, hubHref);
generateEventsPage(eventIndex, domains, outputDir);
generateEventsHtml(eventIndex, domains, outputDir, hubHref);
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
