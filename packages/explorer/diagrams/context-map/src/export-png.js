/**
 * export-png.js
 *
 * Uses a shared Puppeteer browser instance to render each context map page as
 * a PNG. Called by the consolidated packages/explorer/build.js.
 *
 * Output: dist/<slide>.png  — one PNG per view (gitignored)
 *
 * Each standalone HTML page in outDir (domains.html, domain_*.html) is
 * rendered as a PNG named after the page (e.g. domains.png, domain_intake.png).
 */

import { writeFileSync, mkdirSync, readdirSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { pathToFileURL } from 'url';

/**
 * @param {import('puppeteer').Browser} browser  shared Puppeteer browser
 * @param {string} htmlDir  directory containing per-page HTML files
 * @param {string} imgDir   directory to write PNGs into
 */
export async function exportContextMapPngs(browser, htmlDir, imgDir) {
  mkdirSync(imgDir, { recursive: true });

  // Discover all domain pages (domains.html, domain_*.html) — exclude flow_ pages
  const pages = readdirSync(htmlDir)
    .filter(f => extname(f) === '.html' && !f.startsWith('flow_') && f !== 'context-map.html')
    .sort();

  const page = await browser.newPage();

  // 1400px viewport makes fitDiagram() compute scale=1 (no transform distortion).
  // deviceScaleFactor:2 produces retina-quality output.
  await page.setViewport({ width: 1400, height: 1100, deviceScaleFactor: 2 });

  for (let i = 0; i < pages.length; i++) {
    const htmlFile = pages[i];
    const key      = basename(htmlFile, '.html');
    const fileUrl  = pathToFileURL(resolve(htmlDir, htmlFile)).href;

    await page.goto(fileUrl, { waitUntil: 'networkidle0' });

    // Hide navigation chrome for clean slide output
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = 'nav { display: none !important; }';
      document.head.appendChild(style);
    });

    const filename = key + '.png';
    process.stdout.write(`  [${i + 1}/${pages.length}] ${filename}...`);

    const el  = await page.$('#map-wrapper');
    const png = await el.screenshot({ type: 'png' });

    writeFileSync(resolve(imgDir, filename), png);
    process.stdout.write(' done\n');
  }

  await page.close();
  console.log(`Written ${pages.length} PNGs to ${imgDir}`);
}
