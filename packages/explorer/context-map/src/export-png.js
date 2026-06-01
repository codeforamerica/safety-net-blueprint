/**
 * export-png.js
 *
 * Uses a shared Puppeteer browser instance to render each context map view as
 * a PNG. Called by the consolidated packages/explorer/build.js.
 *
 * Output: dist/<slide>.png  — one PNG per view (gitignored)
 *
 * Slide naming matches CONTENT keys from build-html.js (key + ".png"):
 *   domains.png, domain_<id>.png, flow_<domain>_<id>.png
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

/**
 * @param {import('puppeteer').Browser} browser  shared Puppeteer browser
 * @param {string} htmlDir  directory containing context-map.html
 * @param {string} imgDir   directory to write PNGs into
 */
export async function exportContextMapPngs(browser, htmlDir, imgDir) {
  mkdirSync(imgDir, { recursive: true });

  const htmlPath = resolve(htmlDir, 'context-map.html');
  const fileUrl  = pathToFileURL(htmlPath).href;

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
    await new Promise(r => setTimeout(r, 150));

    const filename = key + '.png';
    process.stdout.write(`  [${i + 1}/${keys.length}] ${filename}...`);

    const el  = await page.$('#map-wrapper');
    const png = await el.screenshot({ type: 'png' });

    writeFileSync(resolve(imgDir, filename), png);
    process.stdout.write(' done\n');
  }

  await page.close();
  console.log(`Written ${keys.length} PNGs to ${imgDir}`);
}
