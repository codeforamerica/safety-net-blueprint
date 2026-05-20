#!/usr/bin/env node
/**
 * export-png.js
 *
 * Screenshots an HTML file to a PNG via Puppeteer, then deletes the HTML.
 *
 * Requires puppeteer (optional dependency — skips gracefully if not installed).
 */

import { pathToFileURL } from 'url';

/**
 * @param {string} htmlPath  absolute path to an HTML file to screenshot
 * @param {string} pngPath   absolute path to write the PNG
 */
export async function exportHtmlPng(htmlPath, pngPath) {
  if (process.env.CI) {
    console.log('CI environment — skipping PNG export');
    return;
  }

  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch {
    console.warn('puppeteer not installed — skipping PNG export. Run: npm install puppeteer');
    return;
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  const page    = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: pngPath, fullPage: true });
  await browser.close();

  console.log(`Wrote ${pngPath}`);
}
