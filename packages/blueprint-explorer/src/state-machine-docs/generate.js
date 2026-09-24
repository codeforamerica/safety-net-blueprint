import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { titleCase } from '../lib/html.js';
import { branchSteps, matchCases, forEachBody } from './walk.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getActors(guards) {
  if (!guards) return [];
  const entry = guards.find(g => g.actors);
  return entry?.actors || [];
}


function stripRpcPrefix(desc) {
  if (!desc) return null;
  return desc.replace(/^(POST|GET|PATCH|PUT|DELETE)\s+\S+\s+[—\-–]+\s*/i, '').trim();
}

function stripEmitPrefix(desc) {
  if (!desc) return null;
  return desc.replace(/^Emit\s+[a-z_]+(?:\.[a-z_]+)*\s*[—\-–]+\s*/i, '').trim();
}

function humanActors(actors) {
  if (actors.length === 1) return actors[0];
  const last = actors[actors.length - 1];
  return actors.slice(0, -1).join(', ') + ', or ' + last;
}

function machineLink(domain, object, allStateMachines) {
  const sm = allStateMachines.find(s => s.domain === domain);
  const multi = sm && sm.machines.length > 1;
  const anchor = multi ? `#${object.toLowerCase()}` : '';
  return `[${titleCase(domain)}/${object}](${domain}.md${anchor})`;
}

function renderInvokeCompact(inv) {
  const entry = Object.entries(inv).find(([k]) => ['GET','POST','PUT','PATCH','DELETE'].includes(k));
  return entry ? `\`${entry[0]} ${entry[1]}\`` : JSON.stringify(inv);
}

function allProcedures(machine, sm) {
  return [...(machine.procedures || []), ...(sm.procedures || [])];
}

function humanizeCondition(expr) {
  expr = String(expr).trim();

  // Split compound && expressions
  if (expr.includes(' && ')) {
    return expr.split(' && ').map(humanizeCondition).join(' and ');
  }

  // $this.data.X — simple event data path
  let m = expr.match(/^\$this\.data\.(\w+)$/);
  if (m) return m[1];

  // $X.field == null → "field is not set"
  m = expr.match(/^\$\w+\.(\w+)\s*==\s*null$/);
  if (m) return `${m[1]} is not set`;

  // $X.field != null → "field is set"
  m = expr.match(/^\$\w+\.(\w+)\s*!=\s*null$/);
  if (m) return `${m[1]} is set`;

  // $X.field == "value"
  m = expr.match(/^\$\w+\.(\w+)\s*==\s*"([^"]+)"$/);
  if (m) return `${m[1]} is "${m[2]}"`;

  // $this.data.fields.exists(f, f == "f1" || f == "f2") — field update checks
  if (expr.includes('.fields.exists(')) {
    const fields = [...expr.matchAll(/f\s*==\s*"([^"]+)"/g)].map(x => x[1]);
    if (fields.length) return fields.join(' or ') + ' was updated';
  }

  return expr.replace(/ == /g, ' is ').replace(/ != /g, ' is not ');
}

// ── Events page ───────────────────────────────────────────────────────────────

export function generateEventsPage(eventIndex, allStateMachines, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const lines = [];

  lines.push('# Published Events');
  lines.push('');
  lines.push('Auto-generated from state machine `emit` and subscription declarations.');
  lines.push('');

  const allEvents = new Set([
    ...Object.keys(eventIndex.emitters),
    ...Object.keys(eventIndex.subscribers),
  ]);

  const sorted = [...allEvents].sort();
  const noPublisher = sorted.filter(e => !eventIndex.emitters[e]);

  lines.push('| Event | Published by | Subscribers |');
  lines.push('|---|---|---|');

  for (const event of sorted) {
    const emitter = eventIndex.emitters[event];
    const subs = eventIndex.subscribers[event] || [];
    const publisherCol = emitter
      ? machineLink(emitter.domain, emitter.object, allStateMachines)
      : '*(unknown)*';
    const subsCol = subs.length
      ? subs.map(s => machineLink(s.domain, s.object, allStateMachines)).join(', ')
      : '*(none)*';
    lines.push(`| \`${event}\` | ${publisherCol} | ${subsCol} |`);
  }

  lines.push('');

  if (noPublisher.length) {
    lines.push('## Subscribed but not emitted');
    lines.push('');
    lines.push('These events are subscribed to but have no emitter in the current state machines:');
    lines.push('');
    for (const e of noPublisher) {
      const subs = eventIndex.subscribers[e] || [];
      lines.push(`- \`${e}\` — subscribed by ${subs.map(s => machineLink(s.domain, s.object, allStateMachines)).join(', ')}`);
    }
    lines.push('');
  }

  const outPath = path.join(outputDir, 'events.md');
  writeFileSync(outPath, lines.join('\n'));
  console.log(`  wrote events.md`);
}

// ── Overview ──────────────────────────────────────────────────────────────────

export function generateOverview(stateMachines, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const lines = [];

  lines.push('# State Machine Overview');
  lines.push('');
  lines.push('Auto-generated from `packages/contracts/*-state-machine.yaml`.');
  lines.push('');
  lines.push('See also: [Published events](events.md)');
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push('| Machine | States |');
  lines.push('|---|---|');
  for (const sm of stateMachines) {
    const multiMachine = sm.machines.length > 1;
    for (const machine of sm.machines) {
      const anchor = multiMachine ? `#${machine.object.toLowerCase()}` : '';
      const link = `[${titleCase(sm.domain)} — ${machine.object}](${sm.domain}.md${anchor})`;
      const stateList = (machine.states || []).map(s => `\`${s.id}\``).join(', ');
      lines.push(`| ${link} | ${stateList} |`);
    }
  }
  lines.push('');

  const outPath = path.join(outputDir, 'index.md');
  writeFileSync(outPath, lines.join('\n'));
  console.log(`  wrote index.md`);
}

// ── Transition rendering ──────────────────────────────────────────────────────

function collectTransitionStepLines(steps, sm, machine, eventIndex, allStateMachines, indent) {
  const lines = [];
  const recurse = (inner, deeper) =>
    collectTransitionStepLines(inner, sm, machine, eventIndex, allStateMachines, deeper);

  for (const step of steps || []) {
    const description = step.description?.trim().replace(/\n\s*/g, ' ') || '';

    if (step.kind === 'set') {
      const fieldNote = `sets \`${step.field}\``;
      lines.push(`${indent}- ${description ? `${description} (${fieldNote})` : fieldNote}`);
    } else if (step.kind === 'emit') {
      const desc = stripEmitPrefix(description) || description;
      const subs = eventIndex?.subscribers[step.type] || [];
      const subLinks = subs.map(s => machineLink(s.domain, s.object, allStateMachines)).join(', ');
      lines.push(`${indent}- Emit: \`${step.type}\`${desc ? ` — ${desc}` : ''}`);
      if (subLinks) lines.push(`${indent}  - Subscribed by: ${subLinks}`);
    } else if (step.kind === 'call') {
      if (step.procedure) {
        const proc = allProcedures(machine, sm).find(p => p.id === step.procedure);
        const desc = proc?.description?.trim().replace(/\n\s*/g, ' ');
        lines.push(`${indent}- ${desc || step.procedure}`);
      } else if (step.request) {
        const desc = description
          || step.request.description?.trim().replace(/\n\s*/g, ' ')
          || renderInvokeCompact(step.request);
        lines.push(`${indent}- ${desc}`);
      }
    } else if (step.kind === 'if') {
      lines.push(`${indent}- If \`${humanizeCondition(step.condition)}\`:`);
      lines.push(...recurse(branchSteps(step, 'then'), indent + '  '));
      const otherwise = branchSteps(step, 'else');
      if (otherwise.length) {
        lines.push(`${indent}- Else:`);
        lines.push(...recurse(otherwise, indent + '  '));
      }
    } else if (step.kind === 'match') {
      lines.push(`${indent}- Match on \`${humanizeCondition(step.on)}\`:`);
      for (const [value, caseSteps] of matchCases(step)) {
        lines.push(`${indent}  - When \`${value}\`:`);
        lines.push(...recurse(caseSteps, indent + '    '));
      }
    } else if (step.kind === 'forEach') {
      const collection = step.in ? ` \`${step.in}\`` : '';
      lines.push(`${indent}- For each${collection}:`);
      lines.push(...recurse(forEachBody(step), indent + '  '));
    }
  }
  return lines;
}

function renderOpLine(op, sm, machine, eventIndex, allStateMachines) {
  const lines = [];

  const desc = op.description ? stripRpcPrefix(op.description) : null;
  lines.push(desc ? `- **${op.id}** — ${desc}` : `- **${op.id}**`);

  const actors = getActors(op.guards);
  if (actors.length === 1 && actors[0] === 'system') {
    lines.push(`  - Actors: system only`);
  } else if (actors.length) {
    lines.push(`  - Actors: ${humanActors(actors)}`);
  }

  if (op.transition?.to) {
    const froms = Array.isArray(op.transition.from)
      ? op.transition.from
      : op.transition.from ? [op.transition.from] : [];
    const fromStr = froms.length ? froms.map(f => `\`${f}\``).join('/') + ' → ' : '';
    lines.push(`  - Transition: ${fromStr}\`${op.transition.to}\``);
  } else if (op.transition && !op.transition.to) {
    lines.push(`  - Transition: no state change`);
  }

  const required = op.schema?.request?.required || [];
  if (required.length) {
    lines.push(`  - Requires: ${required.map(f => `\`${f}\``).join(', ')}`);
  }

  lines.push(...collectTransitionStepLines(
    op.steps, sm, machine, eventIndex, allStateMachines, '  '
  ));

  return lines.join('\n');
}

// ── Event subscription rendering ──────────────────────────────────────────────

function appendStepLines(out, step, machine, sm, indent, allMachines) {
  const raw = step.description?.trim().replace(/\n\s*/g, ' ');
  const deeper = indent + '  ';

  switch (step.kind) {
    case 'call': {
      if (step.procedure) {
        const proc = allProcedures(machine, sm).find(p => p.id === step.procedure);
        const desc = proc?.description?.trim().replace(/\n\s*/g, ' ');
        out.push(`${indent}- ${desc || step.procedure}`);
      } else if (step.request) {
        const desc = raw
          || step.request.description?.trim().replace(/\n\s*/g, ' ')
          || renderInvokeCompact(step.request);
        out.push(`${indent}- ${desc}`);
      }
      return;
    }

    case 'if': {
      out.push(`${indent}- If \`${humanizeCondition(step.condition)}\`:`);
      for (const s of branchSteps(step, 'then')) appendStepLines(out, s, machine, sm, deeper, allMachines);
      const otherwise = branchSteps(step, 'else');
      if (otherwise.length) {
        out.push(`${indent}- Else:`);
        for (const s of otherwise) appendStepLines(out, s, machine, sm, deeper, allMachines);
      }
      return;
    }

    case 'match': {
      out.push(`${indent}- Match on \`${humanizeCondition(step.on)}\`:`);
      for (const [value, caseSteps] of matchCases(step)) {
        out.push(`${indent}  - When \`${value}\`:`);
        for (const s of caseSteps) appendStepLines(out, s, machine, sm, indent + '    ', allMachines);
      }
      return;
    }

    case 'forEach': {
      const collection = step.in ? ` \`${step.in}\`` : '';
      out.push(`${indent}- For each${collection}:`);
      for (const s of forEachBody(step)) appendStepLines(out, s, machine, sm, deeper, allMachines);
      return;
    }

    case 'set': {
      out.push(`${indent}- ${raw ? `${raw} (sets \`${step.field}\`)` : `sets \`${step.field}\``}`);
      return;
    }

    case 'emit': {
      const desc = raw ? stripEmitPrefix(raw) || raw : null;
      out.push(`${indent}- Emits \`${step.type}\`${desc ? ` — ${desc}` : ''}`);
      return;
    }
  }
}

function formatContextLookups(context) {
  return context.map(b => {
    const [name, def] = Object.entries(b)[0];
    const whereId = def?.where?.id;
    if (whereId) {
      const p = String(whereId).replace(/^\$this\./, 'event.');
      return `${name} (from \`${p}\`)`;
    }
    return name;
  }).join(', ');
}

function renderEventSubLine(sub, sm, machine, eventIndex, allStateMachines) {
  const emitter = eventIndex?.emitters[sub.name];
  const emitterSuffix = emitter
    ? ` *(emitted by ${machineLink(emitter.domain, emitter.object, allStateMachines)})*`
    : '';
  const lines = [`- **\`${sub.type}\`**${emitterSuffix}`];
  if (sub.context?.length) {
    lines.push(`  - Look up: ${formatContextLookups(sub.context)}`);
  }
  for (const step of sub.steps ?? []) {
    appendStepLines(lines, step, machine, sm, '  ', allStateMachines);
  }
  return lines.join('\n');
}

// ── Detail page ───────────────────────────────────────────────────────────────

/**
 * Write one domain's markdown page.
 *
 * @param {ReturnType<import('./walk.js').stateMachineView>} sm - The domain to render
 * @param {string} outputDir
 * @param {object} eventIndex - From buildEventIndex
 * @param {ReturnType<import('./walk.js').stateMachineView>[]} allStateMachines -
 *   Every domain, for cross-domain links
 */
export function generate(sm, outputDir, eventIndex, allStateMachines) {
  mkdirSync(outputDir, { recursive: true });

  const lines = [];
  lines.push(`# ${titleCase(sm.domain)} State Machine`);
  lines.push('');
  const smFile = path.basename(sm.path);
  const contractsRel = '../../../contracts';
  lines.push(`Domain: \`${sm.domain}\` | API spec: [${sm.apiSpec}](${contractsRel}/${sm.apiSpec}) | State machine: [${smFile}](${contractsRel}/${smFile})`);
  lines.push('');

  for (const machine of sm.machines) {
    lines.push('---');
    lines.push('');
    lines.push(`## ${machine.object}`);
    lines.push('');

    if (machine.actions?.length) {
      lines.push('### Actions');
      lines.push('');
      for (const op of machine.actions) {
        lines.push(renderOpLine(op, sm, machine, eventIndex, allStateMachines));
      }
      lines.push('');
    }

    if (machine.events?.length) {
      lines.push('### Event subscriptions');
      lines.push('');
      for (const sub of machine.events) {
        lines.push(renderEventSubLine(sub, sm, machine, eventIndex, allStateMachines));
      }
      lines.push('');
    }
  }

  const outPath = path.join(outputDir, `${sm.domain}.md`);
  writeFileSync(outPath, lines.join('\n'));
  console.log(`  wrote ${path.basename(outPath)}`);
}
