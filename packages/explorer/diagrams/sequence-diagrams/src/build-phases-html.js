#!/usr/bin/env node
/**
 * build-phases-html.js
 *
 * Generates the sequence diagrams landing page (output/index.html) from
 * index-config.yaml. Phases are shown as cards; each phase links to its
 * event chain diagrams. Also wraps any individual phase SVGs in output/.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { COLORS, FONT } from '../../../lib/theme.js';
import { esc, titleCase, breadcrumb, statusBadge } from '../../../lib/html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '../config/index-config.yaml');
const distDir    = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, '../dist');
const outDir     = process.argv[3] ? resolve(process.argv[3]) : resolve(__dirname, '..');
mkdirSync(outDir, { recursive: true });

const config  = yaml.load(readFileSync(configPath, 'utf8'));
const phases  = config.phases ?? [];
const diagDefs = config.diagrams ?? [];
const diagById = new Map(diagDefs.map(d => [d.id, d]));


//── Landing page — horizontal blueprint layout ────────────────────────────
//
// Phases as columns, swim lanes as rows:
//   Row 1 (header): phase number + label + status badge
//   Row 2 (states): state machine sub-steps with colored badges + arrow connectors
//   Row 3 (domains): domain chips for this phase
//   Row 4 (diagrams): event chain diagram links

// Phase header cells (top bar)
const phaseHeaders = phases.map((phase, i) => {
  const isPlanned = phase.status === 'planned';
  const isLast    = i === phases.length - 1;
  const borderR   = isLast ? '' : 'border-right:1px solid rgba(255,255,255,0.12);';
  return `<div style="flex:1;padding:1rem 1.25rem;${borderR}${isPlanned ? 'opacity:0.55;' : ''}">
    <div style="display:flex;align-items:flex-start;gap:8px;">
      <span style="font-size:11px;font-weight:800;color:rgba(255,255,255,0.4);line-height:2;flex-shrink:0;">${String(i+1).padStart(2,'0')}</span>
      <div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:0.9375rem;font-weight:800;color:white;line-height:1.3;">${esc(phase.label)}</span>
          ${statusBadge(phase.status)}
        </div>
        <p style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:3px;line-height:1.5;">${esc(phase.description)}</p>
      </div>
    </div>
  </div>`;
}).join(`<div style="width:0;"></div>`);

// Domain swim lane cells
const domainCells = phases.map((phase, i) => {
  const isLast  = i === phases.length - 1;
  const borderR = isLast ? '' : `border-right:1px solid ${COLORS.sandDark};`;
  const chips   = (phase.domains ?? []).map(d =>
    `<span style="font-size:10px;font-weight:600;color:${COLORS.midBlue};background:${COLORS.paleBlue};border:1px solid ${COLORS.lightBlue};border-radius:4px;padding:2px 7px;">${esc(titleCase(d))}</span>`
  ).join('');
  return `<div style="flex:1;padding:0.875rem 1.25rem;${borderR}">
    <div style="display:flex;flex-wrap:wrap;gap:4px;">${chips}</div>
  </div>`;
}).join('');

// Diagram swim lane cells
const diagramCells = phases.map((phase, i) => {
  const isLast       = i === phases.length - 1;
  const borderR      = isLast ? '' : `border-right:1px solid ${COLORS.sandDark};`;
  const phaseDiagrams = (phase.diagrams ?? []).map(id => diagById.get(id)).filter(Boolean);
  const links = phaseDiagrams.map(d =>
    `<a href="${esc(d.id)}.html" class="diag-link" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:${COLORS.midBlue};background:white;border:1px solid ${COLORS.lightBlue};border-radius:5px;padding:4px 10px;text-decoration:none;">
      <svg viewBox="0 0 12 12" width="10" height="10" style="flex-shrink:0;"><line x1="1" y1="4" x2="7" y2="4" stroke="${COLORS.midBlue}" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="8" x2="11" y2="8" stroke="${COLORS.midBlue}" stroke-width="1.5" stroke-linecap="round"/><polygon points="7,4 5,2.5 5,5.5" fill="${COLORS.midBlue}"/><polygon points="11,8 9,6.5 9,9.5" fill="${COLORS.midBlue}"/></svg>
      ${esc(d.title.replace(' — Event Chain', ''))}</a>`
  ).join('');
  const empty = `<span style="font-size:11px;color:#bbb;font-style:italic;">No diagrams yet</span>`;
  return `<div style="flex:1;padding:0.875rem 1.25rem;${borderR}">
    <div style="display:flex;flex-wrap:wrap;gap:5px;">${links || empty}</div>
  </div>`;
}).join('');

function swimLane(label, cells, opts = {}) {
  const { bg = 'white', labelBg = COLORS.sandMid, borderTop = `1px solid ${COLORS.sandDark}` } = opts;
  return `<div style="display:flex;border-top:${borderTop};background:${bg};">
    <div style="width:120px;flex-shrink:0;padding:0.875rem 1rem;background:${labelBg};border-right:2px solid ${COLORS.sandDark};display:flex;align-items:flex-start;">
      <span style="font-size:9.5px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:#9a8070;line-height:1.4;">${label}</span>
    </div>
    <div style="flex:1;display:flex;">${cells}</div>
  </div>`;
}

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Safety Net Blueprint — Sequence Diagrams</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${FONT}; background: ${COLORS.bg}; color: ${COLORS.text}; min-height: 100vh; }
    .page-title { background: ${COLORS.darkBlue}; color: ${COLORS.white}; padding: 1.25rem 1.5rem 1.125rem; }
    .page-title h2 { font-size: 1.25rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 0.2rem; }
    .page-title p  { font-size: 0.8125rem; color: rgba(255,255,255,0.55); }
    .blueprint { margin: 2rem auto; max-width: 1200px; padding: 0 1.5rem 4rem; }
    .blueprint-table { border: 1px solid ${COLORS.sandDark}; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 6px rgba(0,0,0,0.06); }
    .phase-header-row { display: flex; background: ${COLORS.darkBlue}; }
    .diag-link:hover { border-color: ${COLORS.midBlue} !important; }
    footer { border-top: 1px solid ${COLORS.sandDark}; background: ${COLORS.white}; padding: 1.5rem 2rem; text-align: center; font-size: 12px; color: ${COLORS.textLight}; }
    footer a { color: ${COLORS.midBlue}; text-decoration: none; }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>

  ${breadcrumb([{ label: 'Explorer', href: '../../index.html' }, { label: 'Sequence Diagrams' }])}

  <div class="page-title">
    <h2>Sequence Diagrams</h2>
    <p>Contract-driven event chain diagrams, organized by benefits lifecycle phase.</p>
  </div>

  <div class="blueprint">
    <div class="blueprint-table">
      <!-- Phase headers -->
      <div class="phase-header-row" style="display:flex;background:${COLORS.darkBlue};">
        <div style="width:120px;flex-shrink:0;padding:1rem;background:rgba(0,0,0,0.2);border-right:2px solid rgba(255,255,255,0.1);display:flex;align-items:flex-end;">
          <span style="font-size:9.5px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:rgba(255,255,255,0.35);">Phase</span>
        </div>
        <div style="flex:1;display:flex;">${phaseHeaders}</div>
      </div>
      ${swimLane('Domains', domainCells)}
      ${swimLane('Event Chains', diagramCells)}
    </div>
  </div>

  <footer>
    <a href="https://github.com/codeforamerica/safety-net-blueprint">Safety Net Blueprint</a>
    &nbsp;·&nbsp; Code for America
  </footer>

</body>
</html>`;

writeFileSync(resolve(outDir, 'index.html'), indexHtml, 'utf8');
console.log(`  Written: index.html`);

// ── Individual phase SVG wrappers (kept for reference) ────────────────────

const FIT_JS = `
    const wrapper = document.getElementById('map-wrapper');
    function fitDiagram() {
      var vw = document.documentElement.clientWidth || window.innerWidth || 1400;
      var scale = Math.min(1, vw / 1400);
      wrapper.style.transform = 'scale(' + scale + ')';
      var h = wrapper.getBoundingClientRect().height || wrapper.offsetHeight;
      wrapper.style.marginBottom = Math.round(h * (scale - 1)) + 'px';
    }
    fitDiagram();
    window.addEventListener('resize', fitDiagram);`;

if (existsSync(distDir)) {
  const phaseFiles = readdirSync(distDir)
    .filter(f => extname(f) === '.svg' && f !== 'overview.svg');

  for (const f of phaseFiles) {
    const id  = basename(f, '.svg');
    const svg = readFileSync(resolve(distDir, f), 'utf8');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Safety Net Blueprint \u2014 ${id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${FONT}; background: ${COLORS.bg}; }
    #container { min-height: 100vh; padding: 24px 0; overflow-x: hidden; }
    #map-wrapper { background: white; box-shadow: 0 2px 16px rgba(0,0,0,0.10); overflow: hidden; width: 1400px; transform-origin: top left; }
  </style>
</head>
<body>
  <div style="position:fixed;top:0;left:0;right:0;z-index:100;pointer-events:none;">
    <a href="index.html" style="pointer-events:auto;position:absolute;top:12px;left:16px;font-size:11px;color:#5650BE;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;text-decoration:none;">&#8592; Sequence Diagrams</a>
  </div>
  <div id="container"><div id="map-wrapper">${svg}</div></div>
  <script>${FIT_JS}</script>
</body>
</html>`;
    writeFileSync(resolve(outDir, `${id}.html`), html, 'utf8');
    console.log(`  Written: ${id}.html`);
  }
}
