#!/usr/bin/env node
/**
 * build-html.js
 *
 * Generates a standalone HTML page for each context map fragment in dist/.
 * Each page includes navigation, the SVG content, fitDiagram(), and
 * data-navigate click handling — no SPA bundling, no innerHTML swapping.
 *
 * Usage:
 *   node build-html.js [distDir] [outDir]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// srcDir: where render.js wrote the fragments (default: dist/)
// outDir: where to write per-page HTML files (default: output/)
const srcDir = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, '../dist');
const outDir = process.argv[3] ? resolve(process.argv[3]) : resolve(__dirname, '..');
mkdirSync(outDir, { recursive: true });

// ── Color constants ──────────────────────────────────────────────────────────

const DARK_BLUE  = '#2B1A78';
const MID_BLUE   = '#5650BE';
const LIGHT_BLUE = '#C2C0E8';
const BG         = '#F3F3F3';

// ── Nav definition ───────────────────────────────────────────────────────────

const ALL_NAV = [
  { file: 'domains',               label: 'Overview' },
  { file: 'domain_intake',         label: 'Intake' },
  { file: 'domain_eligibility',    label: 'Eligibility' },
  { file: 'domain_case_management',label: 'Case Management' },
  { file: 'domain_workflow',       label: 'Workflow' },
  { file: 'domain_data_exchange',  label: 'Data Exchange' },
  { file: 'domain_scheduling',     label: 'Scheduling' },
];

// Only include nav entries that actually have fragment files
const availableFiles = new Set(
  readdirSync(srcDir)
    .filter(f => extname(f) === '.html')
    .map(f => basename(f, '.html'))
);

const navItems = ALL_NAV.filter(item => availableFiles.has(item.file));

// ── Discover all fragment files to generate pages for ────────────────────────

const fragmentFiles = readdirSync(srcDir)
  .filter(f => extname(f) === '.html' && !f.startsWith('flow_') && f !== 'context-map.html');

// ── Page generator ───────────────────────────────────────────────────────────

function buildNav(currentFile) {
  const links = navItems.map(item => {
    const isActive = item.file === currentFile;
    const style = isActive
      ? `color:white;background:rgba(255,255,255,0.15);border-radius:4px;padding:0.25rem 0.5rem;`
      : `color:${LIGHT_BLUE};border-radius:4px;padding:0.25rem 0.5rem;`;
    // Active item: render as a span (no href) to avoid file:// same-origin navigation errors
    if (isActive) {
      return `<span style="${style};font-size:12px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${item.label}</span>`;
    }
    return `<a href="${item.file}.html" style="${style};font-size:12px;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${item.label}</a>`;
  });

  return `<nav style="background:${DARK_BLUE};border-bottom:3px solid ${MID_BLUE};padding:0 1.5rem;display:flex;align-items:center;gap:0.25rem;height:48px;overflow-x:auto;">
  ${links.join('\n  ')}
</nav>`;
}

function buildBreadcrumb(pageTitle) {
  return `<div style="background:${DARK_BLUE};padding:0.5rem 1.25rem;display:flex;align-items:center;gap:0.5rem;font-size:12px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <a href="../../index.html" style="color:${LIGHT_BLUE};text-decoration:none;">Explorer</a>
  <span style="color:${LIGHT_BLUE};opacity:0.5;">/</span>
  <a href="domains.html" style="color:${LIGHT_BLUE};text-decoration:none;">Context Map</a>
  <span style="color:${LIGHT_BLUE};opacity:0.5;">/</span>
  <span style="color:white;">${pageTitle}</span>
</div>`;
}

function buildPage(fragmentName, svgContent) {
  const nav = buildNav(fragmentName);
  const navItem = navItems.find(n => n.file === fragmentName);
  const pageTitle = navItem ? navItem.label : fragmentName;
  const breadcrumb = buildBreadcrumb(pageTitle);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Safety Net Blueprint \u2014 Context Map \u2014 ${pageTitle}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: ${BG}; }
    #container { min-height: 100vh; padding: 16px 0; overflow-x: hidden; }
    #map-wrapper { background: white; box-shadow: 0 2px 16px rgba(0,0,0,0.10); overflow: hidden; width: 1400px; transform-origin: top left; }
  </style>
</head>
<body>
  ${breadcrumb}
  ${nav}
  <div id="container">
    <div id="map-wrapper">
      ${svgContent}
    </div>
  </div>

  <script>
    // Shared cursor-following tooltip for integration details on domain detail pages.
    const intTooltip = document.createElement('div');
    intTooltip.id = 'int-tooltip';
    intTooltip.style.cssText = [
      'position:fixed', 'display:none', 'pointer-events:none',
      "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif",
      'font-size:8.5px', 'line-height:1.65', 'white-space:nowrap',
      'z-index:9999', 'background:white', 'border:1px solid #E9CCBE',
      'border-radius:5px', 'padding:5px 8px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.12)'
    ].join(';');
    document.body.appendChild(intTooltip);

    const wrapper = document.getElementById('map-wrapper');

    // Scale the diagram to fill the available viewport width.
    function fitDiagram() {
      var vw = document.documentElement.clientWidth || window.innerWidth || 1400;
      var scale = Math.min(1, vw / 1400);
      wrapper.style.transform = 'scale(' + scale + ')';
      wrapper.style.marginBottom = Math.round(wrapper.offsetHeight * (scale - 1)) + 'px';
    }

    // Wire up data-navigate click targets to navigate to the corresponding page.
    document.querySelectorAll('[data-navigate]').forEach(function(el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function() {
        location.href = el.getAttribute('data-navigate') + '.html';
      });
    });

    // Map content by id for O(1) lookup
    const intContent = {};
    document.querySelectorAll('.int-content').forEach(function(el) {
      intContent[el.dataset.intId] = el.innerHTML;
    });

    // Wire up cursor-following tooltip on connection hit areas
    document.querySelectorAll('.int-hit').forEach(function(el) {
      var html = intContent[el.dataset.intId] || '';
      if (!html) return;
      el.addEventListener('mouseenter', function() {
        intTooltip.innerHTML = html;
        intTooltip.style.display = 'block';
      });
      el.addEventListener('mousemove', function(e) {
        intTooltip.style.left = (e.clientX + 16) + 'px';
        intTooltip.style.top  = (e.clientY + 10) + 'px';
      });
      el.addEventListener('mouseleave', function() {
        intTooltip.style.display = 'none';
      });
    });

    fitDiagram();
    window.addEventListener('resize', fitDiagram);
  </script>
</body>
</html>`;
}

// ── Generate one page per fragment ───────────────────────────────────────────

for (const fragmentFile of fragmentFiles) {
  const fragmentName = basename(fragmentFile, '.html');
  const svgContent   = readFileSync(resolve(srcDir, fragmentFile), 'utf8');
  const pageHtml     = buildPage(fragmentName, svgContent);
  const outPath      = resolve(outDir, fragmentFile);

  writeFileSync(outPath, pageHtml, 'utf8');
  console.log(`Written: ${outPath}`);
}
