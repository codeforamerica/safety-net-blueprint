#!/usr/bin/env node
/**
 * export-png.js
 *
 * Exports slide-deck-ready PNGs from the adoption model SPA, then zips them.
 * Navigation chrome (breadcrumb, click hints, transparent overlays) is hidden
 * before screenshotting so the PNGs are clean for presentations.
 *
 * Requires puppeteer and jszip (both optional dependencies).
 */

import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync, writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir  = resolve(__dirname, '..', 'output');
const distDir = resolve(__dirname, '..', 'dist');

const SLIDES = [
  { navigateTo: 'overview', png: 'adoption-model.png',      viewportHeight: 630 },
  { navigateTo: 'detail',   png: 'customization-model.png', viewportHeight: 760 },
];

export async function exportPng() {
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch {
    console.warn('puppeteer not installed — skipping PNG export. Run: npm install puppeteer');
    return;
  }

  let JSZip;
  try {
    JSZip = (await import('jszip')).default;
  } catch {
    console.warn('jszip not installed — PNGs will be written individually without a zip.');
    JSZip = null;
  }

  const htmlPath = resolve(outDir, 'adoption-model.html');
  if (!existsSync(htmlPath)) {
    console.warn('adoption-model.html not found — run build first');
    return;
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  // Load the SPA once; we'll navigate between views via JS
  await page.setViewport({ width: 1400, height: 760, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });

  const pngBuffers = {};

  for (const { navigateTo, png, viewportHeight } of SLIDES) {
    // Navigate to the correct view
    await page.evaluate((id) => window._navigate(id), navigateTo);
    await page.setViewport({ width: 1400, height: viewportHeight, deviceScaleFactor: 2 });
    // Let the rAF-based fitDiagram settle
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));

    // Hide navigation chrome
    await page.evaluate(() => {
      const nav = document.getElementById('nav-chrome');
      if (nav) nav.style.visibility = 'hidden';
    });

    const svgEl = await page.$('svg');
    const buffer = await svgEl.screenshot({ type: 'png' });
    pngBuffers[png] = buffer;

    // Write individual PNG to dist/ (intermediate artifact)
    mkdirSync(distDir, { recursive: true });
    const pngPath = resolve(distDir, png);
    writeFileSync(pngPath, buffer);
    console.log(`Wrote ${pngPath}`);
  }

  await browser.close();

  // Zip both PNGs into a single slides archive
  if (JSZip) {
    const zip = new JSZip();
    for (const [filename, buffer] of Object.entries(pngBuffers)) {
      zip.file(filename, buffer);
    }
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const zipPath = resolve(outDir, 'adoption-model-slides.zip');
    writeFileSync(zipPath, zipBuffer);
    console.log(`Wrote ${zipPath}`);
  }
}
