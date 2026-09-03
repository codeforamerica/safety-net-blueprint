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

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname, basename, extname, relative, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { loadConfig } from '../lib/config.js';
import { COLORS, FONT } from '../lib/theme.js';
import { breadcrumb } from '../lib/html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// srcDir: where render.js wrote the fragments
// outDir: where to write per-page HTML files
// --config=<path>: path to context-map config.yaml (contains nav definition)
const args       = process.argv.slice(2);
const configArg  = args.find(a => a.startsWith('--config='));
const contentArg = args.find(a => a.startsWith('--content='));
const positional = args.filter(a => !a.startsWith('--'));
const srcDir     = positional[0] ? resolve(positional[0]) : resolve(__dirname, '../dist');
const outDir     = positional[1] ? resolve(positional[1]) : resolve(__dirname, '..');
const contentDir = contentArg ? resolve(contentArg.slice('--content='.length)) : null;
const hubHref    = contentDir ? relative(outDir, join(contentDir, 'index.html')) : '../../index.html';
const { name: projectName } = contentDir ? loadConfig(contentDir) : { name: 'Blueprint' };
mkdirSync(outDir, { recursive: true });
readdirSync(outDir).filter(f => f.endsWith('.html')).forEach(f => rmSync(resolve(outDir, f)));

// ── Nav definition — loaded from config ──────────────────────────────────────

let ALL_NAV = [];
if (configArg) {
  const config = yaml.load(readFileSync(configArg.slice('--config='.length), 'utf8'));
  ALL_NAV = (config.nav ?? []).map(({ file, label }) => ({ file, label }));
}

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
      : `color:${COLORS.lightBlue};border-radius:4px;padding:0.25rem 0.5rem;`;
    if (isActive) {
      return `<span style="${style};font-size:12px;font-family:${FONT};">${item.label}</span>`;
    }
    return `<a href="${item.file}.html" style="${style};font-size:12px;text-decoration:none;font-family:${FONT};">${item.label}</a>`;
  });

  return `<nav style="background:${COLORS.darkBlue};border-bottom:3px solid ${COLORS.midBlue};padding:0 1.5rem;display:flex;align-items:center;gap:0.25rem;height:48px;overflow-x:auto;">
  ${links.join('\n  ')}
</nav>`;
}

function buildPage(fragmentName, svgContent) {
  const nav = buildNav(fragmentName);
  const navItem = navItems.find(n => n.file === fragmentName);
  const pageTitle = navItem ? navItem.label : fragmentName;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${projectName} \u2014 Context Map \u2014 ${pageTitle}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${FONT}; background: ${COLORS.bg}; }
    #container { min-height: 100vh; padding: 16px 0; overflow-x: hidden; }
    #map-wrapper { background: white; box-shadow: 0 2px 16px rgba(0,0,0,0.10); overflow: hidden; width: 1400px; transform-origin: top left; }
  </style>
</head>
<body>
  ${breadcrumb([{ label: 'Explorer', href: hubHref }, { label: 'Context Map', href: 'domains.html' }, { label: pageTitle }])}
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
