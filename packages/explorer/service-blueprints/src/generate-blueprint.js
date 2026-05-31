/**
 * generate-blueprint.js
 *
 * Assembles blueprint JSON from the enriched explorer config and a
 * service-blueprint annotations YAML, then renders the HTML output.
 * Called by the consolidated packages/explorer/build.js.
 *
 * Annotations file structure:
 *   lanes       — lane definitions (id, label, actors)
 *   phases      — phases → sub-phases; each sub-phase may reference a flow +
 *                 step indices from the enriched config, plus annotation-only cards
 *
 * Card derivation from enriched config flow steps:
 *   actor step  (from: actorId)  → person-action card in that actor's lane
 *   self step   (self: domainId) → system card in the system lane
 *   event step  (event: name)    → domain-event-published card in the data lane
 *                                  (deduplicated when the same event fans out to
 *                                  multiple subscribers in the same sub-phase)
 *   gap step    (gap: true)      → note card with ⚠ prefix in the system lane
 *   cross-flow ref (ref: flowId) → ignored
 *   any step with policies:      → policy cards in the regulations lane
 *                                  (citation + description from policy registry)
 *
 * Annotation cards (data entities, notes, etc.) are merged in after the
 * flow-derived cards in each sub-phase's lane.
 */

import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { renderBlueprintHtml } from './render-blueprint-html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Pure helpers (no mutable state) ──────────────────────────────────────────

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
 */
function collectSectionSteps(steps, sectionNames) {
  const nameSet = new Set(sectionNames);
  const result  = [];
  for (const step of steps) {
    if (step.fragment !== undefined) {
      if (nameSet.has(step.fragment)) {
        if (step.operands) {
          for (const op of step.operands) result.push(...flattenFlowSteps(op.steps || []));
        } else {
          result.push(...flattenFlowSteps(step.steps || []));
        }
      } else {
        if (step.operands) {
          for (const op of step.operands) result.push(...collectSectionSteps(op.steps || [], sectionNames));
        } else {
          result.push(...collectSectionSteps(step.steps || [], sectionNames));
        }
      }
    }
  }
  return result;
}

function buildAnnotationCard(item) {
  if (item.type === 'policy') {
    let subtext;
    if (item.citation && item.subtext) {
      subtext = `${item.subtext} — ${item.citation}`;
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

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * @param {Object} enrichedConfig  config from resolveConfig() — steps have step.policies
 * @param {string} annotationsPath path to service-blueprint annotations YAML
 * @param {string} outDir          directory to write HTML output into
 * @returns {string} absolute path to the generated blueprint HTML file
 */
export function renderBlueprint(enrichedConfig, annotationsPath, outDir) {
  const annotationsAbs = resolve(annotationsPath);
  const annotations    = yaml.load(readFileSync(annotationsAbs, 'utf8'));

  // Build flow index from enriched config
  const flowIndex = new Map();
  for (const flow of (enrichedConfig.flows || [])) {
    flowIndex.set(flow.id, flow);
  }

  // Build actor → lane map
  const actorToLane = new Map();
  for (const lane of (annotations.lanes || [])) {
    for (const actor of (lane.actors || [])) {
      actorToLane.set(actor, lane.id);
    }
  }

  // cellCards[laneId/subPhaseId] = Card[]
  const cellCards = new Map();
  const getCell = (laneId, subPhaseId) => {
    const key = `${laneId}/${subPhaseId}`;
    if (!cellCards.has(key)) cellCards.set(key, []);
    return cellCards.get(key);
  };

  function deriveCards(step, subPhaseId, seenEvents, lastEventTo) {
    // Cross-flow reference steps (no slash in ref) are inter-flow links — skip
    if (step.ref !== undefined && !step.ref.includes('/')) return;

    // Policy cards — run unconditionally; self/event steps return early below
    for (const policy of (step.policies || [])) {
      getCell('regulations', subPhaseId).push({
        type:    'policy',
        text:    policy.description,
        subtext: policy.citation || undefined,
      });
    }

    // Self-message step → system card (or note card if gap)
    if (step.self !== undefined) {
      const triggerEvent = lastEventTo.get(step.self);
      const autoSubtext  = triggerEvent ? `In response to event ${triggerEvent}` : null;

      if (step.gap) {
        const card = {
          type:   'note',
          domain: step.self,
          text:   `⚠ ${step.label || step.self}`,
        };
        card.subtext = step.gap_description || autoSubtext || undefined;
        if (card.subtext === undefined) delete card.subtext;
        getCell('system', subPhaseId).push(card);
      } else {
        const card = {
          type:   'system',
          domain: step.self,
          text:   step.label || step.self,
        };
        card.subtext = step.note || autoSubtext || undefined;
        if (card.subtext === undefined) delete card.subtext;
        getCell('system', subPhaseId).push(card);
      }
      return;
    }

    // Event step → domain-event card in data lane (deduplicated)
    if (step.event !== undefined) {
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
      if (!laneId) return;
      const card = {
        type:  'person-action',
        actor: step.from,
        text:  step.label,
      };
      if (step.note) card.subtext = step.note;
      getCell(laneId, subPhaseId).push(card);
    }

  }

  // Assemble blueprint
  const lanes = annotations.lanes.map(l => ({ id: l.id, label: l.label }));

  const phases = annotations.phases.map(p => ({
    id: p.id,
    label: p.label,
    subPhases: (p.subPhases || []).map(sp => ({ id: sp.id, label: sp.label })),
  }));

  for (const phase of (annotations.phases || [])) {
    for (const subPhase of (phase.subPhases || [])) {
      if (subPhase.flow) {
        const flow = flowIndex.get(subPhase.flow);
        if (!flow) {
          console.warn(`Warning: flow '${subPhase.flow}' not found in config`);
        } else {
          const seenEvents  = new Set();
          const lastEventTo = new Map();

          let stepsToProcess;
          if (subPhase.sections) {
            stepsToProcess = collectSectionSteps(flow.steps || [], subPhase.sections);
          } else if (subPhase.steps) {
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

      for (const [laneId, cardItems] of Object.entries(subPhase.cards || {})) {
        for (const item of cardItems) {
          getCell(laneId, subPhase.id).push(buildAnnotationCard(item));
        }
      }
    }
  }

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

  mkdirSync(outDir, { recursive: true });
  const htmlPath = join(outDir, `${annotations.domain}-blueprint.html`);
  renderBlueprintHtml(blueprint, htmlPath);

  return htmlPath;
}
