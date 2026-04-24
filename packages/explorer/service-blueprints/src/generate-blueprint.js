#!/usr/bin/env node
/**
 * generate-blueprint.js
 *
 * Reads packages/explorer/config.yaml (flow definitions) and an annotations
 * YAML file, then writes a blueprint JSON file consumable by the Figma plugin.
 *
 * Usage:
 *   node generate-blueprint.js config/intake-annotations.yaml
 *
 * Output: output/<domain>.json
 *
 * Annotations file structure:
 *   lanes       — lane definitions (id, label, actors)
 *   phases      — phases → sub-phases; each sub-phase may reference a flow +
 *                 step indices from config.yaml, plus annotation-only cards
 *
 * Card derivation from config.yaml flow steps:
 *   actor step  (from: actorId)  → person-action card in that actor's lane
 *   self step   (self: domainId) → system card in the system lane
 *   event step  (event: name)    → domain-event-published card in the data lane
 *                                  (deduplicated when the same event fans out to
 *                                  multiple subscribers in the same sub-phase)
 *   gap step    (gap: true)      → note card with ⚠ prefix in the system lane
 *   ref step    (ref: flowId)    → ignored
 *   any step with regulatory:   → policy cards in the regulations lane
 *                                  (citation + text + optional subtext)
 *
 * Annotation cards (data entities, notes, etc.) are merged in after the
 * flow-derived cards in each sub-phase's lane. Regulatory policy cards are
 * derived automatically from step.regulatory in config.yaml — do not duplicate
 * them in the annotations file.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────────

const annotationsPath = process.argv[2];
if (!annotationsPath) {
  console.error('Usage: node generate-blueprint.js <annotations.yaml>');
  process.exit(1);
}

// ── Load files ────────────────────────────────────────────────────────────────

const annotationsAbs = resolve(annotationsPath);
const annotationsDir = dirname(annotationsAbs);
const annotations    = yaml.load(readFileSync(annotationsAbs, 'utf8'));

// config.yaml lives two dirs up from service-blueprints/config/
const configAbs  = resolve(annotationsDir, '..', '..', 'config.yaml');
const pkgConfig  = yaml.load(readFileSync(configAbs, 'utf8'));

// ── Build flow index ──────────────────────────────────────────────────────────

const flowIndex = new Map(); // flow.id → flow
for (const flow of (pkgConfig.flows || [])) {
  flowIndex.set(flow.id, flow);
}

// ── Build actor → lane maps ───────────────────────────────────────────────────

const actorToLane = new Map(); // actor id → lane id
for (const lane of (annotations.lanes || [])) {
  for (const actor of (lane.actors || [])) {
    actorToLane.set(actor, lane.id);
  }
}

/** Recursively flatten flow steps — fragment wrappers are unwrapped, not yielded. */
function flattenFlowSteps(steps) {
  const result = [];
  for (const step of steps) {
    if (step.fragment !== undefined) {
      if (step.operands) {
        for (const op of step.operands) {
          result.push(...flattenFlowSteps(op.steps || []));
        }
      } else {
        result.push(...flattenFlowSteps(step.steps || []));
      }
    } else {
      result.push(step);
    }
  }
  return result;
}

/**
 * Collect all flattened steps that belong to any of the named sections.
 * A section is a fragment whose `fragment` value (the name) is in the set.
 * Recurses into other wrappers to find named sections nested within them
 * (e.g. a named section inside a par operand).
 */
function collectSectionSteps(steps, sectionNames) {
  const nameSet = new Set(sectionNames);
  const result  = [];
  for (const step of steps) {
    if (step.fragment !== undefined) {
      if (nameSet.has(step.fragment)) {
        // This wrapper matches — collect all its steps (fully flattened)
        if (step.operands) {
          for (const op of step.operands) result.push(...flattenFlowSteps(op.steps || []));
        } else {
          result.push(...flattenFlowSteps(step.steps || []));
        }
      } else {
        // Recurse to find named sections nested inside other wrappers
        if (step.operands) {
          for (const op of step.operands) result.push(...collectSectionSteps(op.steps || [], sectionNames));
        } else {
          result.push(...collectSectionSteps(step.steps || [], sectionNames));
        }
      }
    }
    // Plain steps are not yielded unless they're inside a matching section
  }
  return result;
}

// ── Assemble blueprint ────────────────────────────────────────────────────────

const lanes = annotations.lanes.map(l => ({ id: l.id, label: l.label }));

const phases = annotations.phases.map(p => ({
  id: p.id,
  label: p.label,
  subPhases: (p.subPhases || []).map(sp => ({ id: sp.id, label: sp.label })),
}));

// cellCards[laneId/subPhaseId] = Card[]
const cellCards = new Map();
const getCell = (laneId, subPhaseId) => {
  const key = `${laneId}/${subPhaseId}`;
  if (!cellCards.has(key)) cellCards.set(key, []);
  return cellCards.get(key);
};

for (const phase of (annotations.phases || [])) {
  for (const subPhase of (phase.subPhases || [])) {

    // ── Cards derived from config.yaml flow steps ──────────────────────────

    if (subPhase.flow) {
      const flow = flowIndex.get(subPhase.flow);
      if (!flow) {
        console.warn(`Warning: flow '${subPhase.flow}' not found in config.yaml`);
      } else {
        const seenEvents  = new Set();
        const lastEventTo = new Map();

        let stepsToProcess;
        if (subPhase.sections) {
          // Preferred: resolve by named section
          stepsToProcess = collectSectionSteps(flow.steps || [], subPhase.sections);
        } else if (subPhase.steps) {
          // Legacy: resolve by flat index
          const allSteps = flattenFlowSteps(flow.steps || []);
          stepsToProcess = subPhase.steps.map(idx => {
            const step = allSteps[idx];
            if (!step) console.warn(`Warning: step index ${idx} out of range in flow '${subPhase.flow}'`);
            return step;
          }).filter(Boolean);
        } else {
          stepsToProcess = flattenFlowSteps(flow.steps || []);
        }

        for (const step of stepsToProcess) {
          deriveCards(step, subPhase.id, seenEvents, lastEventTo);
        }
      }
    }

    // ── Annotation-only cards ──────────────────────────────────────────────

    for (const [laneId, cardItems] of Object.entries(subPhase.cards || {})) {
      for (const item of cardItems) {
        getCell(laneId, subPhase.id).push(buildAnnotationCard(item));
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
  id:     `${annotations.domain}-blueprint`,
  name:   annotations.name,
  lanes,
  phases,
  cells,
};

// ── Write output ──────────────────────────────────────────────────────────────

const outDir  = join(__dirname, '..', 'output');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${annotations.domain}.json`);
writeFileSync(outPath, JSON.stringify(blueprint, null, 2) + '\n');
console.log(`Wrote ${outPath}`);

// ── Step → card derivation ────────────────────────────────────────────────────

function deriveCards(step, subPhaseId, seenEvents, lastEventTo) {
  // Ref steps are inter-flow links — skip
  if (step.ref !== undefined) return;

  // Self-message step → system card (or note card if gap)
  if (step.self !== undefined) {
    const laneId = 'system';
    // Auto-derive "In response to X" subtext from the last event directed at this domain
    const triggerEvent = lastEventTo.get(step.self);
    const autoSubtext  = triggerEvent ? `In response to event ${triggerEvent}` : null;

    if (step.gap) {
      const card = {
        type:   'note',
        domain: step.self,
        text:   `\u26a0 ${step.label || step.self}`,
      };
      card.subtext = step.gap_description || autoSubtext || undefined;
      if (card.subtext === undefined) delete card.subtext;
      getCell(laneId, subPhaseId).push(card);
    } else {
      const card = {
        type:   'system',
        domain: step.self,
        text:   step.label || step.self,
      };
      card.subtext = step.note || autoSubtext || undefined;
      if (card.subtext === undefined) delete card.subtext;
      getCell(laneId, subPhaseId).push(card);
    }
    return;
  }

  // Event step → domain-event card in data lane (deduplicated)
  if (step.event !== undefined) {
    // Track this event as the last one directed at the subscriber domain
    if (step.to) lastEventTo.set(step.to, step.event);
    if (!seenEvents.has(step.event)) {
      seenEvents.add(step.event);
      const card = { type: 'domain-event', text: step.event };
      if (step.from) card.domain = step.from;
      if (step.note) card.subtext = step.note;
      getCell('data', subPhaseId).push(card);
    }
    return;
  }

  // Actor step → person-action in actor's lane
  if (step.label !== undefined && step.from !== undefined) {
    const laneId = actorToLane.get(step.from);
    if (!laneId) return; // from is a domain, not an actor — skip
    const card = {
      type:  'person-action',
      actor: step.from,
      text:  step.label,
    };
    if (step.note) card.subtext = step.note;
    getCell(laneId, subPhaseId).push(card);
  }

  // Regulatory items on any step type → policy cards in the regulations lane
  for (const reg of (step.regulatory || [])) {
    const subtext = [reg.citation, reg.detail].filter(Boolean).join(' \u2014 ');
    getCell('regulations', subPhaseId).push({
      type:    'policy',
      text:    reg.summary,
      subtext: subtext || undefined,
    });
  }
}

// ── Annotation card builder ───────────────────────────────────────────────────

function buildAnnotationCard(item) {
  if (item.type === 'policy') {
    let subtext;
    if (item.citation && item.subtext) {
      subtext = `${item.subtext} \u2014 ${item.citation}`;
    } else if (item.citation) {
      subtext = item.citation;
    } else {
      subtext = item.subtext;
    }
    return { type: 'policy', text: item.text, ...(subtext ? { subtext } : {}) };
  }

  return {
    type:    item.type,
    ...(item.actor   ? { actor:   item.actor   } : {}),
    ...(item.domain  ? { domain:  item.domain  } : {}),
    text:    item.text,
    ...(item.subtext ? { subtext: item.subtext } : {}),
  };
}
