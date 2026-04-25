#!/usr/bin/env node
/**
 * build.js
 *
 * Assembles the adoption model SPA (adoption-model.html) from the two SVG
 * views and wires client-side navigation between them — same pattern as the
 * context map.
 *
 * Usage:
 *   node build.js          # HTML only
 *   node build.js --png    # HTML + PNG export (requires puppeteer)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { overviewSVG } from './src/render-overview.js';
import { detailSVG }   from './src/render-detail.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'output');

// Escape </script> inside string literals so they don't break the outer HTML
const overview = overviewSVG().replace(/<\/script/gi, '<\\/script');
const detail   = detailSVG().replace(/<\/script/gi, '<\\/script');

const contentEntries = [
  `    "overview": ${JSON.stringify(overview)}`,
  `    "detail":   ${JSON.stringify(detail)}`,
].join(',\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Safety Net Blueprint \u2014 Adoption Model</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #f0f4f8; }
    #container { min-height: 100vh; padding: 24px 0; overflow-x: hidden; }
    #map-wrapper { background: white; box-shadow: 0 4px 24px rgba(0,0,0,.12); overflow: hidden; width: 1400px; transform-origin: top left; }
    svg { display: block; }
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

    const wrapper = document.getElementById('map-wrapper');

    function fitDiagram() {
      const w = window.outerWidth || window.innerWidth || 1400;
      const scale = w / 1400;
      wrapper.style.transform = 'scale(' + scale + ')';
      wrapper.style.marginBottom = Math.round(wrapper.offsetHeight * (scale - 1)) + 'px';
    }

    function navigate(id) {
      if (!CONTENT[id]) return;
      wrapper.innerHTML = CONTENT[id];
      window.scrollTo(0, 0);

      if (id === 'overview') {
        const trigger = document.getElementById('detail-trigger');
        if (trigger) {
          trigger.addEventListener('click', () => navigate('detail'));
          trigger.addEventListener('mouseenter', () => trigger.setAttribute('fill', 'rgba(37,99,235,0.04)'));
          trigger.addEventListener('mouseleave', () => trigger.setAttribute('fill', 'transparent'));
        }
      }

      if (id === 'detail') {
        const breadcrumb = document.getElementById('breadcrumb');
        if (breadcrumb) {
          breadcrumb.addEventListener('click', () => navigate('overview'));
        }
      }

      requestAnimationFrame(fitDiagram);
    }

    // Expose for Puppeteer PNG export
    window._navigate = navigate;

    navigate('overview');
    window.addEventListener('resize', fitDiagram);
  </script>
</body>
</html>`;

mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'adoption-model.html');
writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);

if (process.argv.includes('--png')) {
  const { exportPng } = await import('./src/export-png.js');
  await exportPng();
}
