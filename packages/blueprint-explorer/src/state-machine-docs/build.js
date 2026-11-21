import { readdirSync, rmSync, mkdirSync } from 'fs';
import { dirname, join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { generate, generateOverview, generateEventsPage } from './generate.js';
import { buildEventIndex } from '../contract-nav.js';
import { eventSenders, callTargets } from '../lib/event-senders.js';
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

// Returning, not exiting: this is one call inside build.js, and a contract
// set with no state machines is a reason to write nothing here rather than
// to end everybody else's build. See rules-docs for what that cost.
if (!stateMachines.length) {
  console.log(`No state machine contracts found in ${resolvedDir} — skipping state-machine-docs`);
  return { skipped: 'no state machines in the contract set' };
}

// A base state machine declares shared procedures and no machines of its
// own; there is nothing to document for it.
// What each machine attaches to comes from core, which needs the whole set.
const entries = extract(discover(resolvedDir).map(load), 'state-machines');
// A domain's page shows every machine its documents declare: communication
// has one document for transcripts and one for transcription sessions.
const byDomain = new Map();
for (const view of stateMachines
  .filter((doc) => doc.domain && Array.isArray(doc.content?.machines))
  .map((doc) => stateMachineView(doc, entries))) {
  const seen = byDomain.get(view.domain);
  byDomain.set(view.domain, seen ? {
    ...seen,
    apis: [...new Set([...seen.apis, ...view.apis])],
    machines: [...seen.machines, ...view.machines],
    procedures: [...seen.procedures, ...view.procedures],
  } : view);
}
const domains = [...byDomain.values()];

const eventIndex = buildEventIndex(stateMachines);

const apiDocs = discover(resolvedDir, 'openapi').map(load);
const endpointIndex = extract(apiDocs, 'relationships');
const senderOf = eventSenders(eventIndex, apiDocs);

// What each procedure emits — platform's requestTimer emits
// platform.timer.requested — so a machine calling one is seen to publish it.
// A shared one is keyed by its id; a machine's own, by domain, object and id.
const procedureEmits = new Map();
const emitsOf = (node, found = []) => {
  if (Array.isArray(node)) node.forEach((item) => emitsOf(item, found));
  else if (node && typeof node === 'object') {
    if (typeof node.emit?.type === 'string') found.push(node.emit.type);
    Object.values(node).forEach((value) => emitsOf(value, found));
  }
  return found;
};
for (const doc of stateMachines) {
  for (const procedure of doc.content?.procedures ?? []) procedureEmits.set(procedure.id, emitsOf(procedure));
  for (const machine of doc.content?.machines ?? []) {
    for (const procedure of machine.procedures ?? []) procedureEmits.set(`${doc.domain}:${machine.object}:${procedure.id}`, emitsOf(procedure));
  }
}

// What steps publish themselves: their emits, and the procedures they call.
const ownEmits = (steps, domain, object) => (steps ?? []).flatMap((step) => [
  ...(step.kind === 'emit' && step.type ? [step.type] : []),
  ...(step.kind === 'call' && step.procedure
    ? procedureEmits.get(`${domain}:${object}:${step.procedure}`) ?? procedureEmits.get(step.procedure) ?? [] : []),
  ...ownEmits(step.children, domain, object),
]);
const actionEmits = new Map();
for (const sm of domains) {
  for (const machine of sm.machines) {
    for (const action of machine.actions ?? []) actionEmits.set(`${sm.domain}:${machine.object}:${action.id}`, ownEmits(action.steps, sm.domain, machine.object));
  }
}
// And what the endpoints they call send: a write's created, updated or deleted
// event, or what the action an endpoint runs emits.
const targetOf = callTargets(apiDocs);
const stepEmits = (steps, domain, object) => [
  ...ownEmits(steps, domain, object).map((type) => ({ type })),
  ...(function calls(list) {
    return (list ?? []).flatMap((step) => {
      const target = step.kind === 'call' && !step.procedure ? targetOf(step.request) : null;
      const rel = target?.relationship;
      const types = target?.event ? [target.event] : rel ? actionEmits.get(`${rel.domain}:${rel.resource}:${rel.id}`) ?? [] : [];
      return [...types.map((type) => ({ type, via: target })), ...calls(step.children)];
    });
  })(steps),
];

console.log(`Generating state machine docs for ${domains.length} domain(s)...`);

for (const sm of domains) {
  generate(sm, outputDir, eventIndex, domains);
  generateHtml(sm, outputDir, eventIndex, domains, hubHref, endpointIndex, senderOf, stepEmits, targetOf);
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
