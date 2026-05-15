import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { load } from 'js-yaml';
import path from 'path';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getActors(guards) {
  if (!guards) return [];
  const entry = guards.find(g => g.actors);
  return entry?.actors || [];
}

function getSteps(node) {
  return node?.steps || node?.then || [];
}

function getMatchBranches(step) {
  return step?.when || step?.on || {};
}

function getForEachBody(forEach) {
  return forEach?.do || forEach?.then || [];
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

function titleCase(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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

// ── Event index ───────────────────────────────────────────────────────────────

function collectEmitSteps(steps) {
  const emits = [];
  for (const step of steps || []) {
    if (step.emit) {
      emits.push(step.emit.event);
    } else if (step.if !== undefined) {
      emits.push(...collectEmitSteps(getSteps(step)));
      emits.push(...collectEmitSteps(step.else || []));
    } else if (step.match !== undefined) {
      for (const branchSteps of Object.values(getMatchBranches(step))) {
        emits.push(...collectEmitSteps(branchSteps));
      }
    } else if (step.forEach) {
      emits.push(...collectEmitSteps(getForEachBody(step.forEach)));
    }
  }
  return emits;
}

export function buildEventIndex(allStateMachines) {
  const emitters = {};
  const subscribers = {};

  for (const sm of allStateMachines) {
    for (const machine of sm.machines) {
      for (const op of machine.transitions || []) {
        for (const eventId of collectEmitSteps(getSteps(op))) {
          const canonical = `${sm.domain}.${machine.object.toLowerCase()}.${eventId}`;
          emitters[canonical] = { domain: sm.domain, object: machine.object };
        }
      }
      for (const sub of machine.events || []) {
        if (!subscribers[sub.name]) subscribers[sub.name] = [];
        subscribers[sub.name].push({ domain: sm.domain, object: machine.object });
      }
    }
  }

  return { emitters, subscribers };
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
  for (const step of steps || []) {
    if (step.set) {
      const desc = step.set.description?.trim().replace(/\n\s*/g, ' ') || '';
      const fieldNote = `sets \`${step.set.field}\``;
      lines.push(`${indent}- ${desc ? `${desc} (${fieldNote})` : fieldNote}`);
    } else if (step.emit) {
      const rawDesc = step.emit.description?.trim().replace(/\n\s*/g, ' ') || '';
      const desc = stripEmitPrefix(rawDesc) || rawDesc;
      const canonical = `${sm.domain}.${machine.object.toLowerCase()}.${step.emit.event}`;
      const subs = eventIndex?.subscribers[canonical] || [];
      const subLinks = subs.map(s => machineLink(s.domain, s.object, allStateMachines)).join(', ');
      lines.push(`${indent}- Emit: \`${canonical}\`${desc ? ` — ${desc}` : ''}`);
      if (subLinks) lines.push(`${indent}  - Subscribed by: ${subLinks}`);
    } else if (step.call) {
      if (typeof step.call === 'string') {
        const proc = allProcedures(machine, sm).find(p => p.id === step.call);
        const desc = proc?.description?.trim().replace(/\n\s*/g, ' ');
        lines.push(`${indent}- ${desc || step.call}`);
      } else if (typeof step.call === 'object') {
        const desc = step.description?.trim().replace(/\n\s*/g, ' ')
          || step.call.description?.trim().replace(/\n\s*/g, ' ')
          || renderInvokeCompact(step.call);
        lines.push(`${indent}- ${desc}`);
      }
    } else if (step.if !== undefined) {
      lines.push(`${indent}- If \`${humanizeCondition(step.if)}\`:`);
      lines.push(...collectTransitionStepLines(getSteps(step), sm, machine, eventIndex, allStateMachines, indent + '  '));
      if (step.else?.length) {
        lines.push(`${indent}- Else:`);
        lines.push(...collectTransitionStepLines(step.else, sm, machine, eventIndex, allStateMachines, indent + '  '));
      }
    } else if (step.match !== undefined) {
      lines.push(`${indent}- Match on \`${humanizeCondition(step.match)}\`:`);
      for (const [key, branchSteps] of Object.entries(getMatchBranches(step))) {
        lines.push(`${indent}  - When \`${key}\`:`);
        lines.push(...collectTransitionStepLines(branchSteps, sm, machine, eventIndex, allStateMachines, indent + '    '));
      }
    } else if (step.forEach) {
      const collection = step.forEach.in ? ` \`${step.forEach.in}\`` : '';
      lines.push(`${indent}- For each${collection}:`);
      lines.push(...collectTransitionStepLines(getForEachBody(step.forEach), sm, machine, eventIndex, allStateMachines, indent + '  '));
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
    getSteps(op), sm, machine, eventIndex, allStateMachines, '  '
  ));

  return lines.join('\n');
}

// ── Event subscription rendering ──────────────────────────────────────────────

function appendStepLines(out, step, machine, sm, indent, allMachines) {
  if (step.call) {
    if (typeof step.call === 'string') {
      const proc = allProcedures(machine, sm).find(p => p.id === step.call);
      const desc = proc?.description?.trim().replace(/\n\s*/g, ' ');
      out.push(`${indent}- ${desc || step.call}`);
    } else if (typeof step.call === 'object') {
      const desc = step.description?.trim().replace(/\n\s*/g, ' ')
        || step.call.description?.trim().replace(/\n\s*/g, ' ')
        || renderInvokeCompact(step.call);
      out.push(`${indent}- ${desc}`);
    }
    return;
  }

  if (step.if !== undefined) {
    out.push(`${indent}- If \`${humanizeCondition(step.if)}\`:`);
    for (const s of getSteps(step)) appendStepLines(out, s, machine, sm, indent + '  ', allMachines);
    if (step.else?.length) {
      out.push(`${indent}- Else:`);
      for (const s of step.else) appendStepLines(out, s, machine, sm, indent + '  ', allMachines);
    }
    return;
  }

  if (step.match !== undefined) {
    out.push(`${indent}- Match on \`${humanizeCondition(step.match)}\`:`);
    for (const [key, branchSteps] of Object.entries(getMatchBranches(step))) {
      out.push(`${indent}  - When \`${key}\`:`);
      for (const s of (branchSteps || [])) appendStepLines(out, s, machine, sm, indent + '    ', allMachines);
    }
    return;
  }

  if (step.forEach) {
    const collection = step.forEach.in ? ` \`${step.forEach.in}\`` : '';
    out.push(`${indent}- For each${collection}:`);
    for (const s of getForEachBody(step.forEach)) appendStepLines(out, s, machine, sm, indent + '  ', allMachines);
    return;
  }

  if (step.set) {
    const raw = step.set.description?.trim().replace(/\n\s*/g, ' ');
    const desc = raw ? `${raw} (sets \`${step.set.field}\`)` : `sets \`${step.set.field}\``;
    out.push(`${indent}- ${desc}`);
    return;
  }

  if (step.emit) {
    const canonical = `${sm.domain}.${machine.object.toLowerCase()}.${step.emit.event}`;
    const raw = step.emit.description?.trim().replace(/\n\s*/g, ' ');
    const desc = raw ? stripEmitPrefix(raw) || raw : null;
    out.push(`${indent}- Emits \`${canonical}\`${desc ? ` — ${desc}` : ''}`);
    return;
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
  const lines = [`- **\`${sub.name}\`**${emitterSuffix}`];
  if (sub.context?.length) {
    lines.push(`  - Look up: ${formatContextLookups(sub.context)}`);
  }
  for (const step of getSteps(sub)) {
    appendStepLines(lines, step, machine, sm, '  ', allStateMachines);
  }
  return lines.join('\n');
}

// ── Detail page ───────────────────────────────────────────────────────────────

export function generate(inputPath, outputDir, eventIndex, allStateMachines) {
  const sm = load(readFileSync(inputPath, 'utf8'));
  mkdirSync(outputDir, { recursive: true });

  const lines = [];
  lines.push(`# ${titleCase(sm.domain)} State Machine`);
  lines.push('');
  const smFile = path.basename(inputPath);
  const contractsRel = '../../../contracts';
  lines.push(`Domain: \`${sm.domain}\` | API spec: [${sm.apiSpec}](${contractsRel}/${sm.apiSpec}) | State machine: [${smFile}](${contractsRel}/${smFile})`);
  lines.push('');

  for (const machine of sm.machines) {
    lines.push('---');
    lines.push('');
    lines.push(`## ${machine.object}`);
    lines.push('');

    if (machine.transitions?.length) {
      lines.push('### Transitions');
      lines.push('');
      for (const op of machine.transitions) {
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
