#!/usr/bin/env node
/**
 * build-html.js
 *
 * Assembles the overview HTML and per-domain HTML fragments into a single
 * context-map.html with click-to-navigate behavior.
 *
 * Usage:
 *   node render.js        # generates dist/*.html fragments
 *   node build-html.js    # assembles output/context-map.html
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// srcDir: where render.js wrote the fragments (default: dist/)
// outDir: where to write context-map.html (default: output/)
const srcDir = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, 'dist');
const outDir = process.argv[3] ? resolve(process.argv[3]) : resolve(__dirname, 'output');
mkdirSync(outDir, { recursive: true });

// ── Read fragment files ─────────────────────────────────────────────────────

function readFile(name) {
  return readFileSync(resolve(srcDir, name), 'utf8')
    .replace(/<\/script/gi, '<\\/script');
}

const content = {};

if (existsSync(resolve(srcDir, 'overview.html'))) {
  content['__overview__'] = readFile('overview.html');
}

const detailFiles = readdirSync(srcDir)
  .filter(f => extname(f) === '.html' && f !== 'overview.html' && f !== 'context-map.html');

for (const f of detailFiles) {
  content[basename(f, '.html')] = readFile(f);
}

const contentEntries = Object.entries(content)
  .map(([id, html]) => `    ${JSON.stringify(id)}: ${JSON.stringify(html)}`)
  .join(',\n');

// ── Assemble ────────────────────────────────────────────────────────────────

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Safety Net Blueprint \u2014 Context Map</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #f8fafc; }
    #container { min-height: 100vh; padding: 24px 0; overflow-x: hidden; }
    #map-wrapper { background: white; box-shadow: 0 2px 16px rgba(0,0,0,0.10); overflow: hidden; width: 1400px; transform-origin: top left; }

    /* ── Overview ── */
    .cm { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; background: white; }
    .cm-banner { background: #f0fdf4; border: 1px solid #16a34a; border-radius: 6px; padding: 10px 16px; text-align: center; margin-bottom: 20px; }
    .cm-banner-label { font-size: 9px; font-weight: 700; color: #15803d; letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 3px; }
    .cm-banner-items { font-size: 12px; color: #166534; }
    .cm-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px; }
    .cm-domain { border-radius: 8px; padding: 16px 14px; cursor: default; min-height: 110px; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; transition: filter 0.15s; }
    .cm-domain.partial         { background: #eff6ff; border: 1.5px solid #2563eb; cursor: pointer; }
    .cm-domain.design-complete { background: #f0fdf4; border: 1.5px solid #16a34a; cursor: pointer; }
    .cm-domain.not-started     { background: #f9fafb; border: 1.5px dashed #9ca3af; }
    .cm-domain.partial:hover, .cm-domain.design-complete:hover { filter: brightness(0.96); }
    .cm-title    { font-size: 15px; font-weight: 700; color: #111827; text-align: center; line-height: 1.2; }
    .cm-entities { font-size: 9px; color: #9ca3af; text-align: center; width: 100%; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .cm-desc     { font-size: 11px; color: #6b7280; text-align: center; }
    .cm-legend   { display: flex; gap: 20px; padding: 8px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; align-items: center; flex-wrap: wrap; }
    .cm-legend-item { display: flex; align-items: center; gap: 6px; font-size: 9px; color: #374151; }
    .cm-swatch   { width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; }
    .cm-swatch.design-complete { background: #f0fdf4; border: 1.5px solid #16a34a; }
    .cm-swatch.partial         { background: #eff6ff; border: 1.5px solid #2563eb; }
    .cm-swatch.not-started     { background: #f9fafb; border: 1.5px dashed #9ca3af; }

    /* ── Detail views ── */
    .dt-wrap { position: relative; width: 1400px; height: 1100px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: white; overflow: hidden; }
    .dt-nav  { position: absolute; top: 16px; left: 20px; font-size: 12px; z-index: 10; }
    .dt-box  { position: absolute; width: 220px; border-radius: 8px; padding: 12px 14px; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-align: center; box-sizing: border-box; min-height: 105px; z-index: 2; }
    .dt-box.nav { cursor: pointer; transition: filter 0.15s; }
    .dt-box.nav:hover { filter: brightness(0.95); }
    .dt-title    { font-size: 15px; font-weight: 700; color: #111827; line-height: 1.2; }
    .dt-entities { font-size: 9px; color: #9ca3af; width: 100%; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .dt-desc     { font-size: 11px; color: #6b7280; }
    .dt-legend { position: absolute; bottom: 16px; left: 25px; right: 25px; display: flex; gap: 16px; padding: 8px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; align-items: center; flex-wrap: wrap; font-size: 9px; z-index: 10; }

  </style>
</head>
<body>
  <div id="container">
    <div id="map-wrapper"></div>
  </div>

  <script>
    const CONTENT = {
${contentEntries}
    };

    let current = '__overview__';
    const wrapper = document.getElementById('map-wrapper');

    // Shared cursor-following tooltip for integration details on domain detail pages.
    // position:fixed keeps it relative to the viewport and never causes document scroll.
    const intTooltip = document.createElement('div');
    intTooltip.id = 'int-tooltip';
    intTooltip.style.cssText = [
      'position:fixed', 'display:none', 'pointer-events:none',
      "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif",
      'font-size:8.5px', 'line-height:1.65', 'white-space:nowrap',
      'z-index:9999', 'background:white', 'border:1px solid #e5e7eb',
      'border-radius:5px', 'padding:5px 8px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.12)'
    ].join(';');
    document.body.appendChild(intTooltip);

    // Scale the diagram to fill the available viewport width.
    // transform: scale() keeps internal coordinates at 1400px; marginBottom compensates
    // for the layout gap (scale < 1) or extension (scale > 1) left by the transform.
    // Formula: offsetHeight * (scale - 1) is naturally negative below 1, positive above.
    function fitDiagram() {
      // outerWidth is the physical window size, unaffected by browser zoom level.
      // clientWidth shrinks when the user zooms in, which fights the browser's
      // native zoom and pushes the diagram off-screen. outerWidth stays constant
      // across zoom changes and only changes when the window is actually resized.
      const scale = window.outerWidth / 1400;
      wrapper.style.transform = 'scale(' + scale + ')';
      wrapper.style.marginBottom = Math.round(wrapper.offsetHeight * (scale - 1)) + 'px';
    }

    function navigate(id) {
      if (!CONTENT[id]) return;
      current = id;
      intTooltip.style.display = 'none';
      wrapper.innerHTML = CONTENT[id];
      fitDiagram();
      window.scrollTo(0, 0);

      wrapper.querySelectorAll('[data-navigate]').forEach(el => {
        el.addEventListener('click', () => navigate(el.getAttribute('data-navigate')));
      });

      // Map content by id for O(1) lookup
      const intContent = {};
      wrapper.querySelectorAll('.int-content').forEach(el => {
        intContent[el.dataset.intId] = el.innerHTML;
      });

      // Wire up cursor-following tooltip on connection hit areas
      wrapper.querySelectorAll('.int-hit').forEach(el => {
        const html = intContent[el.dataset.intId] || '';
        if (!html) return;
        el.addEventListener('mouseenter', () => {
          intTooltip.innerHTML = html;
          intTooltip.style.display = 'block';
        });
        el.addEventListener('mousemove', e => {
          intTooltip.style.left = (e.clientX + 16) + 'px';
          intTooltip.style.top  = (e.clientY + 10) + 'px';
        });
        el.addEventListener('mouseleave', () => {
          intTooltip.style.display = 'none';
        });
      });
    }

    navigate('__overview__');
    window.addEventListener('resize', fitDiagram);
  </script>
</body>
</html>`;

const outPath = resolve(outDir, 'context-map.html');
writeFileSync(outPath, html, 'utf8');
console.log(`Written: ${outPath}`);
