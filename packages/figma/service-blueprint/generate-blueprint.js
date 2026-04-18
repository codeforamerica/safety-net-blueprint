#!/usr/bin/env node
/**
 * generate-blueprint.js
 *
 * Reads a blueprint definitions YAML file and its referenced state machine YAML,
 * then writes a blueprint JSON file consumable by the Figma plugin.
 *
 * Usage:
 *   node generate-blueprint.js src/blueprints/intake-definitions.yaml
 *   npm run generate -- src/blueprints/intake-definitions.yaml
 *
 * Output: src/blueprints/<domain>.json  (alongside the definitions file)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────────

const defsPath = process.argv[2];
if (!defsPath) {
  console.error('Usage: node generate-blueprint.js <definitions.yaml>');
  process.exit(1);
}

// ── Load files ────────────────────────────────────────────────────────────────

const defsAbs  = resolve(defsPath);
const defsDir  = dirname(defsAbs);
const defs     = yaml.load(readFileSync(defsAbs, 'utf8'));
const smAbs    = resolve(defsDir, defs.stateMachine);
const sm       = yaml.load(readFileSync(smAbs, 'utf8'));

// Rules file is optional — auto-discovered as {domain}-rules.yaml alongside the state machine
const smDir    = dirname(smAbs);
let ruleSets   = [];
try {
  const rulesPath = join(smDir, `${sm.domain}-rules.yaml`);
  const rules = yaml.load(readFileSync(rulesPath, 'utf8'));
  ruleSets = rules.ruleSets ?? [];
} catch {
  // No rules file found — subscribed-event phase triggers won't resolve
}

// ── Build transition index ────────────────────────────────────────────────────

const smTransitions = new Map(); // trigger name → transition object
for (const t of (sm.transitions ?? [])) {
  smTransitions.set(t.trigger, t);
}

// ── Build subscribed-event index ──────────────────────────────────────────────
// Maps external event name → the SM transition it triggers (or null if the rule
// set uses a non-transition action like appendToArray or createResource).
// Multiple rule sets may share the same on: value (e.g. workflow.task.claimed);
// the first one with a triggerTransition wins for domain-event card derivation.

const subscribedEvents = new Map(); // event name → SM transition | null

for (const ruleSet of ruleSets) {
  if (!ruleSet.on) continue;
  let transition = null;
  for (const rule of (ruleSet.rules ?? [])) {
    const name = rule.action?.triggerTransition?.transition;
    if (name) { transition = smTransitions.get(name) ?? null; break; }
  }
  // Only set if not seen yet, or if we now have a transition and previously had null
  if (!subscribedEvents.has(ruleSet.on) || (transition && !subscribedEvents.get(ruleSet.on))) {
    subscribedEvents.set(ruleSet.on, transition);
  }
}

// ── Build actor → lane mapping ────────────────────────────────────────────────

const actorToLane = new Map(); // actor string → lane id
for (const lane of (defs.lanes ?? [])) {
  for (const actor of (lane.actors ?? [])) {
    actorToLane.set(actor, lane.id);
  }
}

// ── Build blueprint ───────────────────────────────────────────────────────────

const lanes  = defs.lanes.map(l => ({ id: l.id, label: l.label }));
const phases = defs.phases.map(p => ({
  id: p.id, label: p.label, ...(p.sublabel ? { sublabel: p.sublabel } : {}),
}));

// cellCards[laneId/phaseId] = Card[]
const cellCards = new Map();
const getCell = (laneId, phaseId) => {
  const key = `${laneId}/${phaseId}`;
  if (!cellCards.has(key)) cellCards.set(key, []);
  return cellCards.get(key);
};

for (const phase of defs.phases) {

  // 1. Person-action and domain-event cards from phase events
  for (const evt of (phase.events ?? [])) {
    let transition;

    if (evt.published) {
      // published: domain emits this event via a state machine transition actor initiates
      transition = smTransitions.get(evt.published);
      if (!transition) {
        console.warn(`Warning: published trigger '${evt.published}' not found in state machine (phase '${phase.id}')`);
        continue;
      }

      // Person-action cards — one per non-system actor
      for (const actor of (transition.actors ?? [])) {
        if (actor === 'system') continue;
        const laneId = actorToLane.get(actor);
        if (!laneId) {
          console.warn(`Warning: actor '${actor}' has no mapped lane (phase '${phase.id}')`);
          continue;
        }
        const override = evt.actorCards?.[actor];
        const card = {
          type: 'person-action',
          actor,
          text: override?.text ?? `${titleCase(actor)}: ${transition.trigger}`,
          ...(override?.subtext ? { subtext: override.subtext } : {}),
        };
        getCell(laneId, phase.id).push(card);
      }

    } else if (evt.subscribed) {
      // subscribed: domain receives this event from another domain; rules file maps it to an SM transition
      if (!subscribedEvents.has(evt.subscribed)) {
        console.warn(`Warning: subscribed event '${evt.subscribed}' not found in rules file (phase '${phase.id}')`);
        continue;
      }
      transition = subscribedEvents.get(evt.subscribed); // may be null

      // Person-action cards come from actorCards only — actors cannot be derived from the external event
      for (const [actor, override] of Object.entries(evt.actorCards ?? {})) {
        const laneId = actorToLane.get(actor);
        if (!laneId) {
          console.warn(`Warning: actor '${actor}' has no mapped lane (phase '${phase.id}')`);
          continue;
        }
        const card = {
          type: 'person-action',
          actor,
          text: override.text,
          ...(override.subtext ? { subtext: override.subtext } : {}),
        };
        getCell(laneId, phase.id).push(card);
      }

      // If no transition is triggered, no domain-event card — any data side-effects go in extras
      if (!transition) continue;

    } else {
      console.warn(`Warning: event in phase '${phase.id}' has neither 'published' nor 'subscribed' — skipping`);
      continue;
    }

    // Domain-event card — from the resolved transition's event effect (applies to both published and subscribed)
    const eventEffect = (transition.effects ?? []).find(e => e.type === 'event');
    if (eventEffect) {
      const raw = eventEffect.description ?? '';
      const subtext = raw.replace(/^Emit [^\u2014]+\u2014\s*/, '').trim();
      const objectPrefix = sm.object ? sm.object.toLowerCase() : sm.domain;
      const card = {
        type: 'domain-event',
        text: `${objectPrefix}.${eventEffect.action}`,
        ...(subtext ? { subtext } : {}),
      };
      getCell('data-events', phase.id).push(card);
    }
  }

  // 2. Policy cards from regulations
  for (const reg of (phase.regulations ?? [])) {
    let subtext;
    if (reg.citation && reg.subtext) {
      subtext = `${reg.subtext} — ${reg.citation}`;
    } else if (reg.citation) {
      subtext = reg.citation;
    } else if (reg.subtext) {
      subtext = reg.subtext;
    }
    const card = {
      type: 'policy',
      text: reg.text,
      ...(subtext ? { subtext } : {}),
    };
    getCell('regulations', phase.id).push(card);
  }

  // 3. Extras — verbatim cards keyed by lane ID
  for (const [laneId, cards] of Object.entries(phase.extras ?? {})) {
    for (const card of cards) {
      getCell(laneId, phase.id).push({ ...card });
    }
  }
}

// Assemble cells array (skip empty cells)
const cells = [];
for (const [key, cards] of cellCards.entries()) {
  if (cards.length === 0) continue;
  const slashIdx = key.indexOf('/');
  const laneId   = key.slice(0, slashIdx);
  const phaseId  = key.slice(slashIdx + 1);
  cells.push({ laneId, phaseId, cards });
}

const blueprint = {
  id:     `${defs.domain}-blueprint`,
  name:   defs.name,
  lanes,
  phases,
  cells,
};

// ── Write output ──────────────────────────────────────────────────────────────

const outPath = join(defsDir, `${defs.domain}.json`);
writeFileSync(outPath, JSON.stringify(blueprint, null, 2) + '\n');
console.log(`Wrote ${outPath}`);

// ── Helpers ───────────────────────────────────────────────────────────────────

function titleCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
