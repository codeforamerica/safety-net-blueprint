#!/usr/bin/env node
/**
 * export-png.js
 *
 * Exports slide-deck-ready PNGs from the adoption model SPA, then zips them.
 *
 * All animations are frozen at their fully-visible end state by injecting a
 * CSS override that fast-forwards every animation 9999s and pauses it.
 * Elements that loop indefinitely (s4 receipt, doc-row, status labels) get an
 * explicit opacity:1 override so they're always visible in the export.
 *
 * Requires puppeteer and jszip (both optional dependencies).
 */

import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync, writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir  = resolve(__dirname, '..', 'output');
const distDir = resolve(__dirname, '..', 'dist');

// CSS injected after navigating to each slide to freeze everything at end state.
// The global rule fast-forwards all animations; the s4 block force-shows looping
// elements that would otherwise land at an arbitrary point in their cycle.
const FREEZE_CSS = `
  svg * {
    animation-delay: -9999s !important;
    animation-fill-mode: both !important;
    animation-play-state: paused !important;
  }
  /* s4 looping elements — force visible regardless of cycle position */
  #s4-receipt,
  #s4-doc-row,
  #s4-status-sub,
  #s4-status-rev,
  #s4-portal-label,
  #s4-case-label,
  #s4-mobile-label {
    opacity: 1 !important;
  }
  /* s4 curtain — push it off-screen so sandbox is fully visible */
  #s4-curtain {
    transform: translateY(-100%) !important;
  }
  /* s4 connection lines — fully drawn */
  #s4-ln1, #s4-ln2, #s4-ln3 {
    stroke-dashoffset: 0 !important;
    opacity: 1 !important;
  }
  /* top nav chrome hidden for clean PNG */
  #top-nav { display: none !important; }
  #container { padding-top: 0 !important; }
`;

const SLIDES = [
  { id: 's1', png: 'slide-1-the-problem.png'          },
  { id: 's2', png: 'slide-2-the-solution.png'         },
  { id: 's3', png: 'slide-3-make-it-yours.png'        },
  { id: 's4', png: 'slide-4-day-one.png'              },
  { id: 's5', png: 'slide-5-path-to-production.png'   },
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
    console.warn('adoption-model.html not found in output/');
    return;
  }

  mkdirSync(distDir, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  // All slides are 1400×480; 2× scale for retina-quality PNGs
  await page.setViewport({ width: 1400, height: 480, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });

  const pngBuffers = {};

  for (const { id, png } of SLIDES) {
    await page.evaluate((slideId) => window._navigate(slideId), id);
    // Wait one rAF for the SVG to render
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));

    // Inject freeze styles
    await page.evaluate((css) => {
      const existing = document.getElementById('__export-freeze');
      if (existing) existing.remove();
      const style = document.createElement('style');
      style.id = '__export-freeze';
      style.textContent = css;
      document.head.appendChild(style);
    }, FREEZE_CSS);

    // One more rAF after style injection
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));

    const svgEl = await page.$('svg');
    const buffer = await svgEl.screenshot({ type: 'png' });
    pngBuffers[png] = buffer;

    const pngPath = resolve(distDir, png);
    writeFileSync(pngPath, buffer);
    console.log(`Wrote ${pngPath}`);
  }

  await browser.close();

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
