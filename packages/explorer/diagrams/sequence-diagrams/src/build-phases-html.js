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

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '../config/index-config.yaml');
const distDir    = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, '../dist');
const outDir     = process.argv[3] ? resolve(process.argv[3]) : resolve(__dirname, '..');
mkdirSync(outDir, { recursive: true });

const config  = yaml.load(readFileSync(configPath, 'utf8'));
const phases  = config.phases ?? [];
const diagDefs = config.diagrams ?? [];
const diagById = new Map(diagDefs.map(d => [d.id, d]));

// ── Helpers ───────────────────────────────────────────────────────────────

function statusBadge(status) {
  if (status === 'implemented') return `<span class="status-badge badge-complete">Complete</span>`;
  if (status === 'in-progress') return `<span class="status-badge badge-progress">In progress</span>`;
  return `<span class="status-badge badge-planned">Planned</span>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Helpers ───────────────────────────────────────────────────────────────

function titleCase(s) {
  return s.replace(/-/g, ' ').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

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
  const borderR = isLast ? '' : 'border-right:1px solid #E9CCBE;';
  const chips   = (phase.domains ?? []).map(d =>
    `<span style="font-size:10px;font-weight:600;color:#5650BE;background:#E6EBF9;border:1px solid #C2C0E8;border-radius:4px;padding:2px 7px;">${esc(titleCase(d))}</span>`
  ).join('');
  return `<div style="flex:1;padding:0.875rem 1.25rem;${borderR}">
    <div style="display:flex;flex-wrap:wrap;gap:4px;">${chips}</div>
  </div>`;
}).join('');

// Diagram swim lane cells
const diagramCells = phases.map((phase, i) => {
  const isLast       = i === phases.length - 1;
  const borderR      = isLast ? '' : 'border-right:1px solid #E9CCBE;';
  const phaseDiagrams = (phase.diagrams ?? []).map(id => diagById.get(id)).filter(Boolean);
  const links = phaseDiagrams.map(d =>
    `<a href="${esc(d.id)}.html" class="diag-link" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#5650BE;background:white;border:1px solid #C2C0E8;border-radius:5px;padding:4px 10px;text-decoration:none;">
      <svg viewBox="0 0 12 12" width="10" height="10" style="flex-shrink:0;"><line x1="1" y1="4" x2="7" y2="4" stroke="#5650BE" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="8" x2="11" y2="8" stroke="#5650BE" stroke-width="1.5" stroke-linecap="round"/><polygon points="7,4 5,2.5 5,5.5" fill="#5650BE"/><polygon points="11,8 9,6.5 9,9.5" fill="#5650BE"/></svg>
      ${esc(d.title.replace(' — Event Chain', ''))}</a>`
  ).join('');
  const empty = `<span style="font-size:11px;color:#bbb;font-style:italic;">No diagrams yet</span>`;
  return `<div style="flex:1;padding:0.875rem 1.25rem;${borderR}">
    <div style="display:flex;flex-wrap:wrap;gap:5px;">${links || empty}</div>
  </div>`;
}).join('');

function swimLane(label, cells, opts = {}) {
  const { bg = 'white', labelBg = '#F7EDE8', borderTop = '1px solid #E9CCBE' } = opts;
  return `<div style="display:flex;border-top:${borderTop};background:${bg};">
    <div style="width:120px;flex-shrink:0;padding:0.875rem 1rem;background:${labelBg};border-right:2px solid #E9CCBE;display:flex;align-items:flex-start;">
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
    :root {
      --dark-blue:    #2B1A78;
      --mid-blue:     #5650BE;
      --light-blue:   #C2C0E8;
      --pale-blue:    #E6EBF9;
      --deep-green:   #006152;
      --mid-green:    #00AD93;
      --sand-dark:    #E9CCBE;
      --sand-mid:     #F7EDE8;
      --text:         #1a1a1a;
      --text-mid:     #444;
      --text-light:   #666;
      --bg:           #F3F3F3;
      --white:        #FFFFFF;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    .page-title { background: var(--dark-blue); color: var(--white); padding: 1.25rem 1.5rem 1.125rem; }
    .page-title h2 { font-size: 1.25rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 0.2rem; }
    .page-title p  { font-size: 0.8125rem; color: rgba(255,255,255,0.55); }
    .blueprint { margin: 2rem auto; max-width: 1200px; padding: 0 1.5rem 4rem; }
    .blueprint-table { border: 1px solid #E9CCBE; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 6px rgba(0,0,0,0.06); }
    .phase-header-row { display: flex; background: #2B1A78; }
    .diag-link:hover { border-color: var(--mid-blue) !important; }
    .status-badge { font-size: 9px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; padding: 1px 6px; border-radius: 100px; flex-shrink: 0; }
    .badge-complete { background: rgba(0,173,147,0.25); color: #7ffff0; border: 1px solid rgba(0,173,147,0.4); }
    .badge-progress { background: rgba(194,192,232,0.2); color: #C2C0E8; border: 1px solid rgba(194,192,232,0.3); }
    .badge-planned  { background: rgba(233,204,190,0.15); color: #c8b0a0; border: 1px solid rgba(233,204,190,0.25); }
    footer { border-top: 1px solid var(--sand-dark); background: var(--white); padding: 1.5rem 2rem; text-align: center; font-size: 12px; color: var(--text-light); }
    footer a { color: var(--mid-blue); text-decoration: none; }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>

  <div style="background:#2B1A78;padding:0.5rem 1.25rem;display:flex;align-items:center;gap:0.5rem;font-size:12px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#C2C0E8;">
    <a href="../../index.html" style="color:#C2C0E8;text-decoration:none;">Explorer</a>
    <span style="opacity:0.5;">/</span>
    <span style="color:white;">Sequence Diagrams</span>
  </div>

  <div class="page-title">
    <h2>Sequence Diagrams</h2>
    <p>Contract-driven event chain diagrams, organized by benefits lifecycle phase.</p>
  </div>

  <div class="blueprint">
    <div class="blueprint-table">
      <!-- Phase headers -->
      <div class="phase-header-row" style="display:flex;background:#2B1A78;">
        <div style="width:120px;flex-shrink:0;padding:1rem;background:rgba(0,0,0,0.2);border-right:2px solid rgba(255,255,255,0.1);display:flex;align-items:flex-end;">
          <span style="font-size:9.5px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:rgba(255,255,255,0.35);">Phase</span>
        </div>
        <div style="flex:1;display:flex;">${phaseHeaders}</div>
      </div>
      ${swimLane('Domains', domainCells, { bg: 'white', labelBg: '#F7EDE8' })}
      ${swimLane('Event Chains', diagramCells, { bg: 'white', labelBg: '#F7EDE8' })}
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
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #F3F3F3; }
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
