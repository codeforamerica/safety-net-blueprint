/**
 * render-blueprint.js
 *
 * Renders a parsed scenario as an HTML service blueprint (swimlane table).
 * Phases = top-level Postman folders; sub-phases = nested folders within them.
 * Lanes = actor rows + one row per system domain + policy row.
 * Uses scenario.columns produced by parseScenario().
 *
 * Card colors, labels, and icons are driven entirely by the cardTypes argument
 * (loaded from service-blueprints/config/card-types.yaml by the caller).
 */

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function domainLabel(domain) {
  return (domain || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const ACTOR_ORDER = ['applicant', 'case_worker', 'caseworker', 'supervisor'];

// Lane header background colors keyed by domain / actor id.
// These are the leftmost label cells — separate from card colors.
const LANE_BG = {
  applicant:           '#D97C20',
  case_worker:         '#2B1A78',
  caseworker:          '#2B1A78',
  supervisor:          '#4F41B2',
  intake:              '#2B1A78',
  workflow:            '#137C69',
  eligibility:         '#154C21',
  data_exchange:       '#2E6276',
  client_management:   '#4F41B2',
  communication:       '#2672DE',
  document_management: '#5C4A1E',
  __policies__:        '#686868',
};

function laneBg(id) {
  return LANE_BG[id] || '#555';
}

function laneLabel(id) {
  if (id === '__policies__') return 'Policy';
  return domainLabel(id);
}

// ── Icons ─────────────────────────────────────────────────────────────────────
// Simple inline SVG paths keyed by icon name (matching card-types.yaml icon values).
// Each function takes a fill color and returns an SVG string.

const ICON_PATHS = {
  'person-single':
    '<circle cx="8" cy="5.5" r="3"/><path d="M1 15a7 7 0 0 1 14 0" stroke-width="1.5" fill="none" stroke="CUR"/>',
  'person-group':
    '<circle cx="5.5" cy="5" r="2.5"/><path d="M0 14a5.5 5.5 0 0 1 11 0" fill="CUR"/><circle cx="11.5" cy="5.5" r="2"/><path d="M11.5 9a4 4 0 0 1 4.5 4" stroke="CUR" stroke-width="1.5" fill="none"/>',
  'gear':
    '<path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm5.66-4.5-.6-1.46 1-1.54L12.5 2l-1.54 1-.6-.6L9.5 2H6.5l-1.46.6L3.5 2 2 3.5l1 1.54-.6 1.46L2 8l.6 1.46-1 1.54 1.46 1.46 1.54-1L6.5 14h3l1.46-.6 1.54 1 1.46-1.46-1-1.54.6-1.46L14 8l-.34-1.5z"/>',
  'lightning':
    '<path d="M9 1.5 4 9h4.5L6.5 15 13 7H8.5z"/>',
  'building':
    '<path d="M8 1 1 6v9h5v-5h4v5h5V6L8 1zm0 2.2 5 3.3V13h-3v-5H6v5H3V6.5L8 3.2z"/>',
  'mail':
    '<path d="M2 4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H2zm0 2.5 6 3.8 6-3.8V12H2V6.5zm0-1.5 6 3.7 6-3.7V5H2v.5z"/>',
  'help':
    '<circle cx="8" cy="8" r="7"/><path d="M6 6.5C6 5.1 6.9 4 8 4s2 1.1 2 2.5c0 .8-.4 1.5-1 2C8.4 9 8 9.5 8 10v.5" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="8" cy="12.5" r=".8" fill="white"/>',
  'document':
    '<path d="M4 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6l-4-4H4zm4 0v4h4M6 9h4M6 11h4M6 7h2"/>',
  'diamond':
    '<path d="M8 2 14 8 8 14 2 8z"/>',
  'diamond-alert':
    '<path d="M8 2 14 8 8 14 2 8z"/><path d="M8 6v3" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="8" cy="11" r=".8" fill="white"/>',
  'lightbulb':
    '<path d="M8 2a5 5 0 0 1 3 9l-.5.5v1.5a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V11.5L5 11A5 5 0 0 1 8 2zm-1 12h2"/>',
  'bar-chart':
    '<rect x="2" y="8" width="3" height="6"/><rect x="6.5" y="5" width="3" height="9"/><rect x="11" y="2" width="3" height="12"/>',
};

function iconSvg(name, fg) {
  const path = ICON_PATHS[name];
  if (!path) return '';
  // Replace stroke="CUR" placeholder with the actual foreground color.
  const inner = path.replace(/stroke="CUR"/g, `stroke="${fg}"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="${fg}" style="vertical-align:middle;flex-shrink:0;">${inner}</svg>`;
}

// ── Card styling from card-types.yaml ─────────────────────────────────────────

function resolveCardStyle(type, actorId, cardTypes) {
  const types  = cardTypes?.types  || {};
  const actors = cardTypes?.actors || {};

  // Actor-specific override for person-action cards
  if ((type === 'person-action' || type === 'staff-action') && actorId) {
    const normActor = actorId === 'case_worker' ? 'caseworker' : actorId;
    const actorDef = actors[normActor];
    if (actorDef) return actorDef;
  }

  let def = types[type] || types['system'] || {};

  // Apply rendersAs override for visual styling (keeps the semantic label/icon)
  if (def.rendersAs && types[def.rendersAs]) {
    const renderDef = types[def.rendersAs];
    def = { ...renderDef, label: def.label, icon: def.icon };
  }

  return def;
}

// ── Card HTML ─────────────────────────────────────────────────────────────────

function cardHtml(text, type, actorId, cardTypes, subtext) {
  const s = resolveCardStyle(type, actorId, cardTypes);
  const hdr    = s.headerBg || '#555';
  const hdrFg  = s.headerFg || '#fff';
  const body   = s.bodyBg   || '#f5f5f5';
  const bodyFg = s.bodyFg   || '#333';
  const label  = s.label    || type.replace(/-/g, ' ').toUpperCase();
  const icon   = s.icon     ? iconSvg(s.icon, hdrFg) : '';

  const headerHtml = `<div style="background:${hdr};color:${hdrFg};padding:5px 7px;display:flex;gap:4px;align-items:flex-start;">
    ${icon ? `<span style="margin-top:1px;opacity:.9;">${icon}</span>` : ''}
    <div style="flex:1;min-width:0;">
      <div style="font-size:10px;font-weight:600;line-height:1.3;">${esc(text)}</div>
      <div style="font-size:8px;font-weight:800;letter-spacing:.05em;margin-top:2px;opacity:.85;">${esc(label)}</div>
    </div>
  </div>`;

  const bodyHtml = subtext
    ? `<div style="background:${body};color:${bodyFg};padding:4px 7px;font-size:9px;line-height:1.4;">${esc(subtext)}</div>`
    : '';

  return `<div style="border-radius:4px;overflow:hidden;margin-bottom:5px;box-shadow:0 1px 2px rgba(0,0,0,.12);">${headerHtml}${bodyHtml}</div>`;
}

export function renderBlueprintHtml(scenario, cardTypes) {
  const columns = scenario.columns || [];
  if (columns.length === 0) {
    return `<!DOCTYPE html><html><body><p style="padding:24px;">No blueprint data.</p></body></html>`;
  }

  // ── Derive lanes ─────────────────────────────────────────────────────────────
  const seenActors = new Set();
  const seenDomains = new Set();
  let hasPolicies = false;

  for (const col of columns) {
    for (const step of col.steps) {
      for (const a of step.actors) seenActors.add(a);
      if (step.displayDomain) seenDomains.add(step.displayDomain);
      if (step.policies.length > 0) hasPolicies = true;
    }
  }

  const lanes = [
    ...ACTOR_ORDER.filter(a => seenActors.has(a)),
    ...[...seenDomains].filter(d => !ACTOR_ORDER.includes(d)),
    ...(hasPolicies ? ['__policies__'] : []),
  ];

  // ── Group columns by phase for header spans ──────────────────────────────────
  const phaseGroups = [];
  for (const col of columns) {
    const last = phaseGroups[phaseGroups.length - 1];
    if (last && last.phase === col.phase) {
      last.cols.push(col);
    } else {
      phaseGroups.push({ phase: col.phase, cols: [col] });
    }
  }

  const hasAnySubPhase = columns.some(c => c.subPhase !== null);

  // ── Build table ──────────────────────────────────────────────────────────────
  const TH_STYLE = 'padding:7px 10px;border:1px solid #333;text-align:left;white-space:nowrap;';

  const phaseRow1Cells = phaseGroups.map(pg => {
    const span   = pg.cols.length;
    const hasSub = pg.cols.some(c => c.subPhase !== null);
    const rowspan = (!hasAnySubPhase || !hasSub) ? ' rowspan="2"' : '';
    return `<th colspan="${span}"${rowspan} style="${TH_STYLE}background:#1a1a1a;color:#fff;font-size:11px;font-weight:800;">${esc(pg.phase)}</th>`;
  }).join('');

  let phaseRow2Cells = '';
  if (hasAnySubPhase) {
    phaseRow2Cells = phaseGroups.flatMap(pg => {
      if (!pg.cols.some(c => c.subPhase !== null)) return [];
      return pg.cols.map(col =>
        `<th style="${TH_STYLE}background:#333;color:#ccc;font-size:9px;font-weight:600;">${esc(col.subPhase || '')}</th>`
      );
    }).join('');
  }

  const headerRows = hasAnySubPhase
    ? `<tr><th rowspan="2" style="background:#000;border:1px solid #333;min-width:90px;"></th>${phaseRow1Cells}</tr><tr>${phaseRow2Cells}</tr>`
    : `<tr><th style="background:#000;border:1px solid #333;min-width:90px;"></th>${phaseRow1Cells}</tr>`;

  const TD = 'style="border:1px solid #e0e0e0;padding:6px;vertical-align:top;min-width:160px;max-width:200px;"';

  const dataRows = lanes.map(laneId => {
    const bg = laneBg(laneId);
    const labelCell = `<td style="background:${bg};color:#fff;font-size:10px;font-weight:700;padding:7px 8px;text-align:center;vertical-align:middle;white-space:nowrap;border:1px solid rgba(0,0,0,.1);">${esc(laneLabel(laneId))}</td>`;

    const dataCells = columns.map(col => {
      let html = '';
      for (const step of col.steps) {
        if (laneId === '__policies__') {
          for (const p of step.policies) {
            html += cardHtml(p.citation || step.name, 'policy', null, cardTypes, p.description);
          }
        } else if (ACTOR_ORDER.includes(laneId)) {
          const norm = (a) => a === 'case_worker' ? 'caseworker' : a;
          const normLane = norm(laneId);
          if (step.actors.some(a => norm(a) === normLane)) {
            html += cardHtml(step.name, 'person-action', laneId, cardTypes);
          }
        } else {
          if (step.displayDomain === laneId) {
            const type = step.actors.length === 0
              ? (step.displayDomain === 'communication' ? 'communications'
                  : step.event ? 'domain-event'
                  : 'system')
              : 'system';
            html += cardHtml(`${domainLabel(laneId)} · ${step.name}`, type, null, cardTypes);
          }
        }
      }
      return `<td ${TD}>${html}</td>`;
    }).join('');

    return `<tr>${labelCell}${dataCells}</tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#fff; padding:24px; overflow-x:auto; }
    table { border-collapse:collapse; }
  </style>
</head>
<body>
  <h1 style="font-size:14px;font-weight:800;color:#1a1a1a;margin-bottom:14px;">${esc(scenario.name)} — Service Blueprint</h1>
  <table>
    <thead>${headerRows}</thead>
    <tbody>${dataRows}</tbody>
  </table>
</body>
</html>`;
}
