/**
 * render-sequence.js
 *
 * Renders a parsed scenario as an SVG-based sequence diagram.
 * Shows participant boxes, lifelines, and directional arrows per step.
 * Emission assertions (GET /platform/events?type=...) render as:
 *   - a dotted EMIT arc from the source domain to platform
 *   - a par combined fragment with one delivery arc per subscriber
 */

const DOMAIN_COLORS = {
  intake:             { bg: '#2B1A78', fg: '#fff' },
  workflow:           { bg: '#137C69', fg: '#fff' },
  eligibility:        { bg: '#154C21', fg: '#fff' },
  data_exchange:      { bg: '#2E6276', fg: '#fff' },
  client_management:  { bg: '#4F41B2', fg: '#fff' },
  notification:       { bg: '#2672DE', fg: '#fff' },
  communication:      { bg: '#2672DE', fg: '#fff' },
  platform:           { bg: '#555',    fg: '#fff' },
  applicant:          { bg: '#D97C20', fg: '#fff' },
  caseworker:         { bg: '#2B1A78', fg: '#fff' },
  case_worker:        { bg: '#2B1A78', fg: '#fff' },
  supervisor:         { bg: '#4F41B2', fg: '#fff' },
};

function domainColor(domain) {
  return DOMAIN_COLORS[domain] || { bg: '#888', fg: '#fff' };
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function participantLabel(domain) {
  return domain.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// A step is architecturally meaningful if it:
//   - has explicit actor guards (a guarded state transition), OR
//   - is an event injection (platform choreography), OR
//   - is an emission assertion (GET /platform/events?type=...), OR
//   - creates the primary entity — POST to a collection endpoint (no {id} in path)
// Data-entry sub-resource POSTs (.../members, .../incomes, etc.) are filtered out.
function isSignificant(step) {
  if (step.actors.length > 0 || step.event !== null || step.emittedEvent !== null || step.isReactionAssertion || step.isCrossDomainCall || step.isCrossDomainReturn) return true;
  return !step.isVerification;
}

const MSG_H      = 52;
const DESC_H     = 14;  // height of description line below an arrow
const POLICY_H   = 14;  // height of policy citation line below an arrow
const PAR_PAD    = 8;   // top + bottom padding inside par block
const PAR_LBL    = 18;  // height of the "par" label strip at the top of the block
const BRANCH_LBL = 16;  // height of the per-branch label inside a par block

function annotationH(step) {
  let h = 0;
  if (step.description) h += DESC_H;
  if (step.policies?.length) h += POLICY_H;
  return h;
}

// Build a map of parent emission index → consequence steps within the same phase.
// Consequences are: causal chain emissions (isCausalChain) and reaction assertions
// (isReactionAssertion) that appear after the most recent non-causal emission.
function buildCausalMap(steps) {
  const map = new Map();
  let parentIdx = -1;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.emittedEvent && !s.isCausalChain) {
      parentIdx = i;
    } else if (parentIdx >= 0 && ((s.emittedEvent && s.isCausalChain) || s.isReactionAssertion || s.isCrossDomainCall || s.isCrossDomainReturn)) {
      if (!map.has(parentIdx)) map.set(parentIdx, []);
      map.get(parentIdx).push(s);
    }
  }
  return map;
}

// Height of one subscriber branch in a par block, including causal-chain emissions
// whose emittedEventSource matches this subscriber and reaction assertions whose
// domain matches this subscriber.
// src: the emitting domain — when sub === src, the EMIT arrow is skipped (no self-loop)
function branchHeight(sub, causalChildren, src) {
  let h = (sub === src) ? 0 : MSG_H;
  for (const child of causalChildren) {
    if (child.emittedEvent && child.emittedEventSource === sub) h += MSG_H;
    if (child.isReactionAssertion && child.domain === sub) h += MSG_H;
    if (child.isCrossDomainCall && child.fromDomain === sub) h += MSG_H;
    if (child.isCrossDomainReturn && child.toDomain === sub) h += MSG_H;
  }
  return h;
}

// Total height a par-emission step occupies (par box + all branches).
function parStepHeight(subs, causalChildren, src) {
  if (subs.length === 0) return MSG_H;
  if (subs.length === 1) return branchHeight(subs[0], causalChildren, src);
  const branchesH = subs.reduce((acc, sub) => acc + BRANCH_LBL + branchHeight(sub, causalChildren, src), 0);
  return PAR_PAD + PAR_LBL + branchesH + PAR_PAD;
}

export function renderSequenceHtml(scenario) {
  const eventSubscriptions = scenario.eventSubscriptions || new Map();

  // Collect participants from significant steps (including event subscribers)
  const participantSet = new Set();
  for (const actor of scenario.actors) participantSet.add(actor);
  for (const phase of scenario.phases) {
    for (const step of phase.steps) {
      if (!isSignificant(step)) continue;
      if (step.eventSource) participantSet.add(step.eventSource);
      if (step.emittedEventSource) participantSet.add(step.emittedEventSource);
      if (step.emittedEvent) {
        for (const sub of (eventSubscriptions.get(step.emittedEvent) || [])) {
          participantSet.add(sub);
        }
      }
      // platform is a transport layer — don't show it as a participant column
      if (step.domain !== 'platform') participantSet.add(step.domain);
      for (const a of step.actors) participantSet.add(a);
    }
  }
  const participants = [...participantSet];

  const COL_W   = 180;
  const BOX_W   = 140;
  const BOX_H   = 36;
  const START_Y = 10;
  const FONT    = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  const colX = (p) => participants.indexOf(p) * COL_W + COL_W / 2;

  // Helper: visible subscribers for an emission step
  const visibleSubs = (step) =>
    (eventSubscriptions.get(step.emittedEvent) || []).filter(s => participantSet.has(s));

  // Pre-calculate total SVG height
  let contentH = 0;
  for (const phase of scenario.phases) {
    const steps = phase.steps.filter(isSignificant);
    if (steps.length === 0) continue;
    const causalMap = buildCausalMap(steps);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.isCausalChain || step.isReactionAssertion || step.isCrossDomainCall || step.isCrossDomainReturn) continue; // rendered inside parent par block
      const subs = step.emittedEvent ? visibleSubs(step) : [];
      const children = causalMap.get(i) || [];
      contentH += step.emittedEvent ? parStepHeight(subs, children, step.emittedEventSource) : MSG_H + annotationH(step);
    }
  }

  const totalH = START_Y + BOX_H + 16 + contentH + 20;
  const totalW = Math.max(700, participants.length * COL_W + 40);
  const lifelineY = START_Y + BOX_H;

  const parts = [];

  // Lifelines
  for (const p of participants) {
    const x = colX(p);
    parts.push(`<line x1="${x}" y1="${lifelineY}" x2="${x}" y2="${totalH - 10}" stroke="#d0d0d0" stroke-width="1" stroke-dasharray="5,4"/>`);
  }

  // Participant boxes
  for (const p of participants) {
    const c = domainColor(p);
    const x = colX(p);
    parts.push(`<rect x="${x - BOX_W / 2}" y="${START_Y}" width="${BOX_W}" height="${BOX_H}" rx="4" fill="${c.bg}"/>`);
    parts.push(`<text x="${x}" y="${START_Y + BOX_H / 2 + 4}" text-anchor="middle" fill="${c.fg}" font-family="${FONT}" font-size="11" font-weight="700">${esc(participantLabel(p))}</text>`);
  }

  // Helper: draw a single arrow (solid or dashed) with badge + label
  function drawArrow(fromX, toX, midY, badge, badgeBg, label, dashed = false) {
    const dir   = toX > fromX ? 1 : -1;
    const dash  = dashed ? ' stroke-dasharray="5,3"' : '';
    parts.push(`<line x1="${fromX}" y1="${midY}" x2="${toX}" y2="${midY}" stroke="${badgeBg}" stroke-width="1.5"${dash}/>`);
    parts.push(`<polygon points="${toX},${midY} ${toX - dir * 8},${midY - 5} ${toX - dir * 8},${midY + 5}" fill="${badgeBg}"/>`);
    const midX  = (fromX + toX) / 2;
    const badgeW = badge.length * 6 + 10;
    parts.push(`<rect x="${midX - badgeW / 2}" y="${midY - 24}" width="${badgeW}" height="13" rx="2" fill="${badgeBg}"/>`);
    parts.push(`<text x="${midX}" y="${midY - 14}" text-anchor="middle" fill="#fff" font-family="${FONT}" font-size="8" font-weight="800">${esc(badge)}</text>`);
    parts.push(`<text x="${midX}" y="${midY - 4}" text-anchor="middle" fill="#333" font-family="${FONT}" font-size="10">${esc(label)}</text>`);
  }

  // Helper: draw a self-loop arrow (lifeline → right → down → back left with arrowhead)
  function drawSelfArrow(x, midY, badge, badgeBg, label, dashed = false) {
    const R    = 52;
    const yOff = 18;
    const y1   = midY - yOff / 2;
    const y2   = midY + yOff / 2;
    const dash = dashed ? ' stroke-dasharray="5,3"' : '';
    parts.push(`<path d="M ${x},${y1} L ${x + R},${y1} L ${x + R},${y2} L ${x},${y2}" fill="none" stroke="${badgeBg}" stroke-width="1.5"${dash}/>`);
    parts.push(`<polygon points="${x},${y2} ${x + 8},${y2 - 5} ${x + 8},${y2 + 5}" fill="${badgeBg}"/>`);
    const bx     = x + R / 2;
    const badgeW = badge.length * 6 + 10;
    parts.push(`<rect x="${bx - badgeW / 2}" y="${y1 - 16}" width="${badgeW}" height="13" rx="2" fill="${badgeBg}"/>`);
    parts.push(`<text x="${bx}" y="${y1 - 6}" text-anchor="middle" fill="#fff" font-family="${FONT}" font-size="8" font-weight="800">${esc(badge)}</text>`);
    parts.push(`<text x="${bx}" y="${y2 + 12}" text-anchor="middle" fill="#333" font-family="${FONT}" font-size="10">${esc(label)}</text>`);
  }

  // Helper: render description + policy links below an arrow.
  // centerX: horizontal midpoint of the arrow (for centering the description label).
  function drawAnnotations(step, midY, centerX) {
    let ay = midY + MSG_H / 2 + 6;
    if (step.description) {
      parts.push(`<text x="${centerX}" y="${ay}" text-anchor="middle" fill="#666" font-family="${FONT}" font-size="10" font-style="italic">${esc(step.description)}</text>`);
      ay += DESC_H;
    }
    if (step.policies?.length) {
      let px = 12;
      for (const p of step.policies) {
        const w = p.citation.length * 6 + 10;
        if (p.citationUrl) {
          parts.push(`<a href="${esc(p.citationUrl)}" target="_blank"><rect x="${px}" y="${ay - 10}" width="${w}" height="12" rx="2" fill="#e8f0fe"/><text x="${px + w / 2}" y="${ay}" text-anchor="middle" fill="#1a73e8" font-family="${FONT}" font-size="9" font-weight="600">${esc(p.citation)}</text></a>`);
        } else {
          parts.push(`<rect x="${px}" y="${ay - 10}" width="${w}" height="12" rx="2" fill="#f1f3f4"/><text x="${px + w / 2}" y="${ay}" text-anchor="middle" fill="#555" font-family="${FONT}" font-size="9">${esc(p.citation)}</text>`);
        }
        px += w + 6;
      }
    }
  }

  // Messages
  let y = START_Y + BOX_H + 16;

  for (const phase of scenario.phases) {
    const steps = phase.steps.filter(isSignificant);
    if (steps.length === 0) continue;
    const causalMap = buildCausalMap(steps);

    for (let si = 0; si < steps.length; si++) {
      const step = steps[si];

      // Consequence steps are rendered inside their parent's par block
      if (step.isCausalChain || step.isReactionAssertion || step.isCrossDomainCall || step.isCrossDomainReturn) continue;

      // ── Emission assertion ───────────────────────────────────────────────
      if (step.emittedEvent) {
        const src      = step.emittedEventSource;
        const subs     = visibleSubs(step);
        const children = causalMap.get(si) || [];
        const fromX    = src && participantSet.has(src) ? colX(src) : 20;

        if (subs.length === 0) {
          if (src && participantSet.has(src)) {
            const x = colX(src);
            parts.push(`<circle cx="${x}" cy="${y + MSG_H / 2}" r="3" fill="#888"/>`);
            parts.push(`<text x="${x + 8}" y="${y + MSG_H / 2 + 4}" fill="#888" font-family="${FONT}" font-size="10">emits ${esc(step.emittedEvent)}</text>`);
          }
          y += MSG_H;
          continue;
        }

        // Helper: draw one subscriber branch (main arrow + any causal children for this sub)
        // When emitter === subscriber, skip the self-loop and go straight to reactions.
        const drawBranch = (sub) => {
          const color = domainColor(sub).bg;
          const toX   = colX(sub);
          if (fromX !== toX) {
            drawArrow(fromX, toX, y + MSG_H / 2, 'EMIT', color, step.emittedEvent, true);
            y += MSG_H;
          }
          // Consequence steps for this subscriber branch
          for (const child of children) {
            if (child.isCrossDomainCall) {
              if (child.fromDomain !== sub) continue;
              const fromX = participantSet.has(child.fromDomain) ? colX(child.fromDomain) : 20;
              const toX   = participantSet.has(child.toDomain) ? colX(child.toDomain) : fromX;
              const color = domainColor(child.toDomain).bg;
              if (fromX === toX) {
                drawSelfArrow(fromX, y + MSG_H / 2, 'CALLS', color, child.name, false);
              } else {
                drawArrow(fromX, toX, y + MSG_H / 2, 'CALLS', color, child.name, false);
              }
              y += MSG_H;
            } else if (child.isCrossDomainReturn) {
              if (child.toDomain !== sub) continue;
              const retFromX = participantSet.has(child.fromDomain) ? colX(child.fromDomain) : 20;
              const retToX   = participantSet.has(child.toDomain)   ? colX(child.toDomain)   : retFromX;
              const retColor = domainColor(child.fromDomain).bg;
              drawArrow(retFromX, retToX, y + MSG_H / 2, 'RETURN', retColor, child.name, true);
              y += MSG_H;
            } else if (child.isReactionAssertion) {
              if (child.domain !== sub) continue;
              drawSelfArrow(colX(sub), y + MSG_H / 2, 'REACTS', domainColor(sub).bg, child.name, false);
              y += MSG_H;
            } else if (child.emittedEvent) {
              if (child.emittedEventSource !== sub) continue;
              const childSubs  = visibleSubs(child);
              const childFromX = participantSet.has(child.emittedEventSource) ? colX(child.emittedEventSource) : 20;
              if (childSubs.length === 0) {
                parts.push(`<circle cx="${childFromX}" cy="${y + MSG_H / 2}" r="3" fill="#888"/>`);
                parts.push(`<text x="${childFromX + 8}" y="${y + MSG_H / 2 + 4}" fill="#888" font-family="${FONT}" font-size="10">emits ${esc(child.emittedEvent)}</text>`);
              } else {
                const childColor = domainColor(childSubs[0]).bg;
                const childToX   = colX(childSubs[0]);
                if (childFromX === childToX) {
                  drawSelfArrow(childFromX, y + MSG_H / 2, 'EMIT', childColor, child.emittedEvent, true);
                } else {
                  drawArrow(childFromX, childToX, y + MSG_H / 2, 'EMIT', childColor, child.emittedEvent, true);
                }
              }
              y += MSG_H;
            }
          }
        };

        if (subs.length === 1) {
          drawBranch(subs[0]);
        } else {
          const parH = parStepHeight(subs, children, src);
          parts.push(`<rect x="4" y="${y}" width="${totalW - 8}" height="${parH}" fill="none" stroke="#bbb" stroke-width="1"/>`);
          parts.push(`<rect x="4" y="${y}" width="30" height="${PAR_LBL}" fill="#888"/>`);
          parts.push(`<text x="19" y="${y + PAR_LBL - 5}" text-anchor="middle" fill="#fff" font-family="${FONT}" font-size="9" font-weight="800">par</text>`);
          y += PAR_PAD + PAR_LBL;
          for (let i = 0; i < subs.length; i++) {
            if (i > 0) {
              parts.push(`<line x1="4" y1="${y}" x2="${totalW - 4}" y2="${y}" stroke="#bbb" stroke-width="1" stroke-dasharray="4,3"/>`);
            }
            const branchLabel = participantLabel(subs[i]);
            const labelColor  = domainColor(subs[i]).bg;
            parts.push(`<text x="12" y="${y + BRANCH_LBL - 4}" fill="${labelColor}" font-family="${FONT}" font-size="10" font-weight="700">${esc(branchLabel)}</text>`);
            y += BRANCH_LBL;
            drawBranch(subs[i]);
          }
          y += PAR_PAD;
        }
        continue;
      }

      // ── Regular step ────────────────────────────────────────────────────
      // For event injections (POST /platform/events), the "called" domain is
      // platform, which has no participant column. Show instead as the event
      // source domain reacting to itself (a self-annotation).
      let caller = step.eventSource && participantSet.has(step.eventSource) ? step.eventSource : null;
      if (!caller && step.actors.length > 0 && participantSet.has(step.actors[0])) caller = step.actors[0];
      // For write calls with no identified caller, fall back to the scenario's primary domain
      if (!caller && step.method !== 'GET' && step.domain !== 'platform' && participantSet.has(scenario.domain)) caller = scenario.domain;

      const rawCalled = step.domain;
      const called    = rawCalled === 'platform' ? (caller || rawCalled) : rawCalled;
      const msgY      = y + MSG_H / 2;

      if (!caller || !participants.includes(called)) {
        const domainForDot = participants.includes(called) ? called : (participants[0] || called);
        const x = participants.includes(domainForDot) ? colX(domainForDot) : 20;
        parts.push(`<circle cx="${x}" cy="${msgY}" r="3" fill="${domainColor(rawCalled).bg}"/>`);
        parts.push(`<text x="${x + 8}" y="${msgY + 4}" fill="#555" font-family="${FONT}" font-size="10">${esc(step.name)}</text>`);
        drawAnnotations(step, y, x);
        y += MSG_H + annotationH(step);
        continue;
      }

      const badge   = step.event ? 'EVENT' : step.method;
      const badgeBg = step.event ? domainColor(step.eventSource || caller).bg : domainColor(called).bg;
      const label   = step.event ? step.event : step.name;

      // Event injections: arrow shows source domain → receiving/reacting domain (intake)
      const arrowTo = step.event && step.eventSource && participants.includes(step.eventSource)
        ? (participants.includes(scenario.domain) ? colX(scenario.domain) : colX(called))
        : colX(called);
      const arrowFromX = colX(caller);
      drawArrow(arrowFromX, arrowTo, msgY, badge, badgeBg, label, false);
      drawAnnotations(step, y, (arrowFromX + arrowTo) / 2);
      y += MSG_H + annotationH(step);
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: ${FONT}; background: #fff; padding: 24px; }</style>
</head>
<body>
  <h1 style="font-size:15px;font-weight:800;color:#1a1a1a;margin-bottom:20px;">${esc(scenario.name)} — Sequence Diagram</h1>
  <div style="overflow-x:auto;">
    <svg width="${totalW}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
      ${parts.join('\n      ')}
    </svg>
  </div>
</body>
</html>`;
}
