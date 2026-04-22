#!/usr/bin/env node
/**
 * generate-blueprint.js
 *
 * Reads a blueprint context YAML file and its referenced state machine YAML,
 * then writes a blueprint JSON file consumable by the Figma plugin.
 *
 * Usage:
 *   node generate-blueprint.js ../config/intake-context.yaml
 *   npm run generate -- ../config/intake-context.yaml
 *
 * Output: <input-dir>/<domain>.json  (alongside the context file)
 *
 * Context file structure:
 *   Each sub-phase has a 'cards' map keyed by lane ID. Cards are listed in
 *   the order they appear on the blueprint.
 *
 *   An item with an 'event' field is an event slot — it expands in-place:
 *     - In actor lanes (applicant, caseworker, system, etc.) → person-action card
 *     - In the 'data' lane → domain-event card derived from the transition's event effect
 *
 *   If an event slot references an event not yet in the state machine or rules
 *   file but provides explicit 'text', the card is still generated (with a warning).
 *   This allows context files to reference events that are not yet wired up.
 *
 *   All other items are passed through as regular cards.
 *   Policy cards support a 'citation' field that is merged into subtext.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────────

const defsPath = process.argv[2];
if (!defsPath) {
  console.error('Usage: node generate-blueprint.js <context.yaml>');
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
  // No rules file found — subscribed event slots won't resolve to domain-event cards
}

// ── Build transition index ────────────────────────────────────────────────────

const smTransitions = new Map(); // trigger name → transition object
for (const t of (sm.transitions ?? [])) {
  smTransitions.set(t.trigger, t);
}

// ── Build subscribed-event index ──────────────────────────────────────────────
// Maps external event name → the SM transition it triggers (or null if the rule
// set uses a non-transition action like appendToArray or createResource).

const subscribedEvents = new Map(); // event name → SM transition | null

for (const ruleSet of ruleSets) {
  if (!ruleSet.on) continue;
  let transition = null;
  for (const rule of (ruleSet.rules ?? [])) {
    const name = rule.action?.triggerTransition?.transition;
    if (name) { transition = smTransitions.get(name) ?? null; break; }
  }
  if (!subscribedEvents.has(ruleSet.on) || (transition && !subscribedEvents.get(ruleSet.on))) {
    subscribedEvents.set(ruleSet.on, transition);
  }
}

// ── Build lane maps ───────────────────────────────────────────────────────────

const actorToLane = new Map(); // actor string → lane id
const laneToActors = new Map(); // lane id → actor[]
for (const lane of (defs.lanes ?? [])) {
  laneToActors.set(lane.id, lane.actors ?? []);
  for (const actor of (lane.actors ?? [])) {
    actorToLane.set(actor, lane.id);
  }
}

// ── Build blueprint ───────────────────────────────────────────────────────────

const lanes = defs.lanes.map(l => ({ id: l.id, label: l.label }));

const phases = defs.phases.map(p => ({
  id: p.id,
  label: p.label,
  subPhases: p.subPhases.map(sp => ({ id: sp.id, label: sp.label })),
}));

// cellCards[laneId/subPhaseId] = Card[]
const cellCards = new Map();
const getCell = (laneId, subPhaseId) => {
  const key = `${laneId}/${subPhaseId}`;
  if (!cellCards.has(key)) cellCards.set(key, []);
  return cellCards.get(key);
};

for (const phase of defs.phases) {
  for (const subPhase of (phase.subPhases ?? [])) {
    for (const [laneId, cardItems] of Object.entries(subPhase.cards ?? {})) {
      for (const item of cardItems) {
        if (item.event) {
          expandEventSlot(item, laneId, subPhase.id);
        } else {
          getCell(laneId, subPhase.id).push(buildRegularCard(item));
        }
      }
    }
  }
}

// Assemble cells array (skip empty cells)
const cells = [];
for (const [key, cards] of cellCards.entries()) {
  if (cards.length === 0) continue;
  const slashIdx   = key.indexOf('/');
  const laneId     = key.slice(0, slashIdx);
  const subPhaseId = key.slice(slashIdx + 1);
  cells.push({ laneId, subPhaseId, cards });
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

// ── Card builders ─────────────────────────────────────────────────────────────

function expandEventSlot(item, laneId, subPhaseId) {
  const eventName = item.event;

  // Resolve the transition — published transitions first, then subscribed
  let transition = null;
  let found = false;
  if (smTransitions.has(eventName)) {
    transition = smTransitions.get(eventName);
    found = true;
  } else if (subscribedEvents.has(eventName)) {
    transition = subscribedEvents.get(eventName); // may be null
    found = true;
  }

  if (!found) {
    if (item.text) {
      // Event not yet wired up but text provided — generate card and warn
      console.warn(`Warning: event '${eventName}' not found in state machine or rules file (sub-phase '${subPhaseId}') — using provided text`);
    } else {
      console.warn(`Warning: event '${eventName}' not found in state machine or rules file (sub-phase '${subPhaseId}') — skipping`);
      return;
    }
  }

  if (laneId === 'data') {
    // Expand to domain-event card — requires a resolved transition
    if (!transition) return;
    const eventEffect = (transition.effects ?? []).find(e => e.type === 'event');
    if (!eventEffect) return;
    const raw = eventEffect.description ?? '';
    const subtext = raw.replace(/^Emit [^\u2014]+\u2014\s*/, '').trim();
    // Subscribed events are not shown in the data lane — they appear as
    // SYSTEM (INTAKE) cards in the system lane, authored in the context YAML.
    if (subscribedEvents.has(eventName) && !smTransitions.has(eventName)) return;

    const objectPrefix = sm.object ? sm.object.toLowerCase() : sm.domain;
    getCell(laneId, subPhaseId).push({
      type: 'domain-event-published',
      text: `${objectPrefix}.${eventEffect.action}`,
      ...(subtext ? { subtext } : {}),
    });
  } else {
    // Expand to person-action card
    const actor = item.actor ?? deriveActorForLane(laneId, transition);
    const text  = item.text  ?? (actor ? `${titleCase(actor)}: ${eventName}` : null);
    if (!text) {
      console.warn(`Warning: cannot derive text for event '${eventName}' in lane '${laneId}' (sub-phase '${subPhaseId}') — skipping`);
      return;
    }
    getCell(laneId, subPhaseId).push({
      type: 'person-action',
      ...(actor ? { actor } : {}),
      text,
      ...(item.subtext ? { subtext: item.subtext } : {}),
    });
  }
}

function buildRegularCard(item) {
  // Policy cards: merge citation + subtext into a single subtext string
  if (item.type === 'policy') {
    let subtext;
    if (item.citation && item.subtext) {
      subtext = `${item.subtext} — ${item.citation}`;
    } else if (item.citation) {
      subtext = item.citation;
    } else if (item.subtext) {
      subtext = item.subtext;
    }
    return {
      type: 'policy',
      text: item.text,
      ...(subtext ? { subtext } : {}),
    };
  }

  // All other cards — pass through standard fields
  return {
    type: item.type,
    ...(item.actor  ? { actor:  item.actor  } : {}),
    ...(item.domain ? { domain: item.domain } : {}),
    text: item.text,
    ...(item.subtext ? { subtext: item.subtext } : {}),
  };
}

function deriveActorForLane(laneId, transition) {
  if (!transition) return null;
  const laneActors = laneToActors.get(laneId) ?? [];
  return (transition.actors ?? []).find(a => laneActors.includes(a)) ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function titleCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
