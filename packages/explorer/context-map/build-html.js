#!/usr/bin/env node
/**
 * build-html.js
 *
 * Assembles per-domain SVGs from output/ into a single context-map.html
 * with click-to-navigate behavior.
 *
 * Usage:
 *   node build-html.js [output-dir]
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(__dirname, 'output');

function readSvg(name) {
  const raw = readFileSync(resolve(outDir, name), 'utf8');
  // Strip XML declaration
  return raw.replace(/<\?xml[^?]*\?>\s*/, '').trim();
}

const files = readdirSync(outDir).filter(f => extname(f) === '.svg');
const hasOverview = files.includes('overview.svg');
const domainFiles = files.filter(f => f !== 'overview.svg');

// Build a map of id → SVG content
const svgs = {};
if (hasOverview) svgs['__overview__'] = readSvg('overview.svg');
for (const f of domainFiles) {
  svgs[basename(f, '.svg')] = readSvg(f);
}

const svgEntries = Object.entries(svgs)
  .map(([id, content]) => `    ${JSON.stringify(id)}: ${JSON.stringify(content)}`)
  .join(',\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Safety Net Blueprint — Context Map</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #f8fafc; }
    #container {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      min-height: 100vh;
      padding: 24px 16px;
    }
    #map-wrapper {
      background: white;
      border-radius: 10px;
      box-shadow: 0 2px 16px rgba(0,0,0,0.10);
      overflow: hidden;
      max-width: 100%;
    }
    #map-wrapper svg {
      display: block;
      max-width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  <div id="container">
    <div id="map-wrapper"></div>
  </div>

  <script>
    const SVGS = {
${svgEntries}
    };

    let current = '__overview__';
    const wrapper = document.getElementById('map-wrapper');

    function navigate(id) {
      if (!SVGS[id]) return;
      current = id;
      wrapper.innerHTML = SVGS[id];
      attachHandlers();
    }

    function attachHandlers() {
      // Clickable domain boxes (data-navigate on <g> elements)
      wrapper.querySelectorAll('[data-navigate]').forEach(el => {
        el.addEventListener('click', () => navigate(el.getAttribute('data-navigate')));
      });
    }

    navigate('__overview__');
  </script>
</body>
</html>`;

const outPath = resolve(outDir, 'context-map.html');
writeFileSync(outPath, html, 'utf8');
console.log(`Written: ${outPath}`);
