/**
 * render-blueprint.js
 *
 * Renders a parsed scenario as an HTML service blueprint (swimlane diagram).
 * Rows = actor lanes + domain lanes + events lane.
 * Columns = phases (Postman collection folders).
 * Skips verification GET requests.
 */

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const LANE_STYLES = {
  applicant:          { bg: '#D97C20', fg: '#fff', label: 'Applicant'         },
  case_worker:        { bg: '#2B1A78', fg: '#fff', label: 'Caseworker'        },
  caseworker:         { bg: '#2B1A78', fg: '#fff', label: 'Caseworker'        },
  supervisor:         { bg: '#4F41B2', fg: '#fff', label: 'Supervisor'        },
  intake:             { bg: '#2B1A78', fg: '#fff', label: 'System'            },
  workflow:           { bg: '#137C69', fg: '#fff', label: 'Workflow'          },
  eligibility:        { bg: '#154C21', fg: '#fff', label: 'Eligibility'       },
  data_exchange:      { bg: '#2E6276', fg: '#fff', label: 'Data Exchange'     },
  client_management:  { bg: '#4F41B2', fg: '#fff', label: 'Client Management' },
  notification:       { bg: '#2672DE', fg: '#fff', label: 'Notification'      },
  platform:           { bg: '#555',    fg: '#fff', label: 'Events'            },
};

function laneStyle(id) {
  return LANE_STYLES[id] || { bg: '#888', fg: '#fff', label: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) };
}

const CARD_STYLES = {
  action:  { headerBg: '#2B1A78', headerFg: '#fff', bodyBg: '#EEEBFF', bodyFg: '#1A1040', label: 'ACTION'  },
  system:  { headerBg: '#137C69', headerFg: '#fff', bodyBg: '#F1FFFD', bodyFg: '#0A3A2E', label: 'SYSTEM'  },
  event:   { headerBg: '#2E6276', headerFg: '#fff', bodyBg: '#E7F2F5', bodyFg: '#0A2E34', label: 'EVENT'   },
};

function cardHtml(text, style, subtext) {
  const s = CARD_STYLES[style] || CARD_STYLES.system;
  return `<div style="border-radius:5px;overflow:hidden;margin-bottom:6px;box-shadow:0 1px 3px rgba(0,0,0,.15);">
    <div style="background:${s.headerBg};color:${s.headerFg};padding:6px 8px;">
      <div style="font-size:11px;font-weight:700;line-height:1.3;">${esc(text)}</div>
      <div style="font-size:9px;font-weight:800;letter-spacing:.06em;margin-top:3px;opacity:.9;">${s.label}</div>
    </div>
    ${subtext ? `<div style="background:${s.bodyBg};color:${s.bodyFg};padding:5px 8px;font-size:10px;line-height:1.4;">${esc(subtext)}</div>` : ''}
  </div>`;
}

export function renderBlueprintHtml(scenario) {
  // Derive ordered lanes: actors first (from state machine), then domains, events last
  const actorOrder = ['applicant', 'case_worker', 'caseworker', 'supervisor'];
  const seenActors = new Set(scenario.actors);
  const seenDomains = new Set(scenario.domains);

  const lanes = [
    ...actorOrder.filter(a => seenActors.has(a)),
    ...[...seenDomains].filter(d => !actorOrder.includes(d) && d !== 'platform'),
  ];
  if (seenDomains.has('platform')) lanes.push('platform');

  // Phases: only include phases with at least one non-verification step
  const phases = scenario.phases.filter(p => p.steps.some(s => !s.isVerification));

  const LANE_W = 140;
  const COL_W  = 200;
  const gridCols = `${LANE_W}px ${phases.map(() => `${COL_W}px`).join(' ')}`;

  // Phase header row
  const phaseHeaders = [
    `<div style="background:#fff;border-right:1px solid #ddd;"></div>`,
    ...phases.map(p => `<div style="background:#1a1a1a;color:#fff;font-size:12px;font-weight:800;padding:9px 11px;border-left:2px solid #fff;">${esc(p.name)}</div>`),
  ].join('');

  // Lane rows
  const laneRows = lanes.map(laneId => {
    const ls = laneStyle(laneId);
    const cells = phases.map(phase => {
      const steps = phase.steps.filter(s => !s.isVerification);
      const cards = steps
        .filter(s => {
          if (laneId === 'platform') return s.event !== null;
          if (actorOrder.includes(laneId)) return s.actors.includes(laneId);
          return s.domain === laneId && !s.event;
        })
        .map(s => {
          if (s.event) return cardHtml(s.event, 'event', s.name);
          if (actorOrder.includes(laneId)) return cardHtml(s.name, 'action');
          return cardHtml(s.name, 'system');
        })
        .join('');
      return `<div style="border-left:1px solid #ddd;border-top:1px solid #e8e8e8;padding:7px;min-height:56px;">${cards}</div>`;
    }).join('');

    return `
<div style="background:#fafafa;border-right:1px solid #ddd;border-top:1px solid #e8e8e8;padding:10px 8px;font-size:11px;font-weight:700;color:${ls.fg};background:${ls.bg};display:flex;align-items:center;justify-content:center;text-align:center;">${esc(ls.label)}</div>
${cells}`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>* { box-sizing:border-box; margin:0; padding:0; } body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#fff; padding:24px; }</style>
</head>
<body>
  <h1 style="font-size:15px;font-weight:800;color:#1a1a1a;margin-bottom:16px;">${esc(scenario.name)} — Service Blueprint</h1>
  <div style="display:grid;grid-template-columns:${gridCols};border:1px solid #ccc;border-radius:4px;overflow:hidden;">
    ${phaseHeaders}
    ${laneRows}
  </div>
</body>
</html>`;
}
