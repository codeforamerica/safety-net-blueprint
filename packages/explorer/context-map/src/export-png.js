#!/usr/bin/env node
/**
 * export-png.js
 *
 * Uses Puppeteer to render each context map view as a PNG.
 *
 * Usage:
 *   node export-png.js [html-dir [img-dir]]
 *
 * Output:
 *   dist/<slide>.png  — one PNG per view (gitignored)
 *
 * Slide naming matches CONTENT keys from build-html.js (key + ".png"):
 *   domains.png, domain_<id>.png, flow_<domain>_<id>.png
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// htmlDir: where context-map.html lives (default: output/)
// imgDir:  where individual PNGs are written (default: dist/)
const htmlDir = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, '..', 'output');
const imgDir  = process.argv[3] ? resolve(process.argv[3]) : resolve(__dirname, '..', 'dist');

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.warn('puppeteer not installed — skipping PNG export. Run: npm install puppeteer');
  process.exit(0);
}

mkdirSync(imgDir, { recursive: true });

const htmlPath = resolve(htmlDir, 'context-map.html');
const fileUrl = pathToFileURL(htmlPath).href;

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

// 1400px viewport makes fitDiagram() compute scale=1 (no transform distortion).
// deviceScaleFactor:2 produces retina-quality output.
await page.setViewport({ width: 1400, height: 1100, deviceScaleFactor: 2 });
await page.goto(fileUrl, { waitUntil: 'networkidle0' });

// Hide navigation chrome (.slide-nav) for clean slide output
await page.evaluate(() => {
  const style = document.createElement('style');
  style.textContent = '.slide-nav { display: none !important; }';
  document.head.appendChild(style);
});

const keys = await page.evaluate(() => Object.keys(CONTENT));

for (let i = 0; i < keys.length; i++) {
  const key = keys[i];

  await page.evaluate(id => navigate(id), key);
  // Let the layout settle after navigation
  await new Promise(r => setTimeout(r, 150));

  const filename = key + '.png';

  process.stdout.write(`  [${i + 1}/${keys.length}] ${filename}...`);

  const el = await page.$('#map-wrapper');
  const png = await el.screenshot({ type: 'png' });

  writeFileSync(resolve(imgDir, filename), png);

  process.stdout.write(' done\n');
}

await browser.close();
console.log(`Written ${keys.length} PNGs to ${imgDir}`);
