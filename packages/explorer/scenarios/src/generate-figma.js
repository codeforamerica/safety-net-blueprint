/**
 * generate-figma.js
 *
 * Converts the scenario.columns data model (from parseScenario) into the
 * Blueprint and CardData formats consumed by the Figma plugin.
 *
 * Card type classification is centralised in classifyStep() so richer types
 * (data-entity, pain-point, communications, etc.) can be added incrementally.
 */

function slugify(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function toActorType(actorId) {
  const id = (actorId || '').replace(/_/g, '');
  if (id === 'applicant') return 'applicant';
  if (id === 'caseworker') return 'caseworker';
  if (id === 'supervisor') return 'supervisor';
  return 'system';
}

function domainLabel(domain) {
  return (domain || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Returns { type: CardType, actor?: ActorType }.
// Extend this function to map step attributes to richer card types over time.
function classifyStep(step) {
  if (step.actors.length > 0) {
    return { type: 'person-action', actor: toActorType(step.actors[0]) };
  }
  if (step.displayDomain === 'communication') return { type: 'communications' };
  if (step.event) return { type: 'domain-event' };
  return { type: 'system' };
}

// Group a flat columns array into phases, preserving order.
function groupByPhase(columns) {
  const groups = [];
  for (const col of columns) {
    const last = groups[groups.length - 1];
    if (last && last.label === col.phase) {
      last.cols.push(col);
    } else {
      groups.push({ label: col.phase, cols: [col] });
    }
  }
  return groups;
}

export function generateFigmaBlueprint(scenario) {
  const columns = scenario.columns || [];
  const actorOrder = ['applicant', 'case_worker', 'caseworker', 'supervisor'];

  const seenActors = new Set();
  let hasPolicies = false;
  for (const col of columns) {
    for (const step of col.steps) {
      for (const a of step.actors) seenActors.add(a);
      if (step.policies.length > 0) hasPolicies = true;
    }
  }

  // ── Lanes ────────────────────────────────────────────────────────────────────
  // Actor lanes (one per person type seen), then a single system lane, then
  // a regulations lane if any step carries policy annotations.
  const lanes = [
    ...actorOrder.filter(a => seenActors.has(a)).map(a => ({
      id: a === 'case_worker' ? 'caseworker' : a,
      label: a === 'applicant' ? 'Applicant'
           : (a === 'case_worker' || a === 'caseworker') ? 'Caseworker'
           : 'Supervisor',
    })),
    { id: 'system', label: 'System' },
    ...(hasPolicies ? [{ id: 'regulations', label: 'Regulations' }] : []),
  ];

  // ── Phases + sub-phases ──────────────────────────────────────────────────────
  const phaseGroups = groupByPhase(columns);

  const phases = phaseGroups.map(pg => ({
    id: slugify(pg.label),
    label: pg.label,
    subPhases: pg.cols.map(col => ({
      id: col.subPhase ? slugify(col.subPhase) : slugify(col.phase),
      label: col.subPhase || col.phase,
    })),
  }));

  // Map each column to its subPhaseId for cell placement.
  const colSubPhaseId = columns.map(col =>
    col.subPhase ? slugify(col.subPhase) : slugify(col.phase)
  );

  // ── Cells ────────────────────────────────────────────────────────────────────
  // Flat array of { laneId, subPhaseId, cards }.  Empty cells are omitted.
  const cells = [];

  for (const lane of lanes) {
    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci];
      const subPhaseId = colSubPhaseId[ci];
      const cards = [];

      for (const step of col.steps) {
        const norm = (id) => id === 'case_worker' ? 'caseworker' : id;

        if (lane.id === 'regulations') {
          for (const p of step.policies) {
            cards.push({
              type: 'policy',
              text: p.citation || step.name,
              subtext: p.description?.trim() || undefined,
              citation: p.citation,
            });
          }
        } else if (lane.id !== 'system') {
          // Actor lane
          if (step.actors.some(a => norm(a) === lane.id)) {
            const classified = classifyStep(step);
            cards.push({ ...classified, text: step.name });
          }
        } else {
          // System lane — non-actor steps only
          if (step.actors.length === 0) {
            const classified = classifyStep(step);
            const label = `${domainLabel(step.displayDomain)} · ${step.name}`;
            cards.push({ ...classified, text: label });
          }
        }
      }

      if (cards.length > 0) {
        cells.push({ laneId: lane.id, subPhaseId, cards });
      }
    }
  }

  // ── Blueprint ────────────────────────────────────────────────────────────────
  const blueprint = {
    id: slugify(scenario.name),
    name: scenario.name,
    lanes,
    phases,
    cells,
  };

  // ── CardData ─────────────────────────────────────────────────────────────────
  // Standalone card groups for the plugin's "Cards" mode.
  const cardData = {
    domain: scenario.domain,
    name: scenario.name,
    phases: phaseGroups.map(pg => ({
      id: slugify(pg.label),
      label: pg.label,
      subPhases: pg.cols
        .map(col => {
          const cards = col.steps.flatMap(step =>
            step.policies.map(p => ({
              type: 'policy',
              text: p.citation || step.name,
              subtext: p.description?.trim() || undefined,
              citation: p.citation,
              citationUrl: p.citationUrl,
            }))
          );
          return {
            id: col.subPhase ? slugify(col.subPhase) : slugify(col.phase),
            label: col.subPhase || col.phase,
            cards,
          };
        })
        .filter(sp => sp.cards.length > 0),
    })).filter(pg => pg.subPhases.length > 0),
  };

  return { blueprint, cardData };
}
