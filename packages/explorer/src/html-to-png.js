/**
 * html-to-png.js
 *
 * Screenshots an HTML file to a PNG via Puppeteer.
 * Called by the consolidated packages/explorer/build.js with a shared browser.
 *
 * Requires puppeteer (optional dependency — build.js handles graceful skip).
 */

import { pathToFileURL } from 'url';

/**
 * @param {import('puppeteer').Browser} browser  shared Puppeteer browser
 * @param {string} htmlPath  absolute path to an HTML file to screenshot
 * @param {string} pngPath   absolute path to write the PNG
 */
export async function htmlToPng(browser, htmlPath, pngPath) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: pngPath, fullPage: true });
  await page.close();
  console.log(`Wrote ${pngPath}`);
}
