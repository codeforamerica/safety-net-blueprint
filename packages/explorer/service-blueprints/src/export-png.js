#!/usr/bin/env node
/**
 * export-png.js
 *
 * Converts a rendered service blueprint SVG to a PNG via Puppeteer.
 * Reads from dist/<domain>.svg, writes to output/<domain>.png.
 *
 * Requires puppeteer (optional dependency — skips gracefully if not installed).
 */

import { resolve, dirname, basename } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir   = resolve(__dirname, '..', 'dist');
const outDir    = resolve(__dirname, '..', 'output');

/**
 * @param {string} domain  e.g. "intake"
 */
export async function exportPng(domain) {
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch {
    console.warn('puppeteer not installed — skipping PNG export. Run: npm install puppeteer');
    return;
  }

  const svgPath = resolve(distDir, `${domain}.svg`);
  if (!existsSync(svgPath)) {
    console.warn(`SVG not found at ${svgPath} — skipping PNG export`);
    return;
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  const page    = await browser.newPage();

  await page.goto(pathToFileURL(svgPath).href, { waitUntil: 'networkidle0' });

  // Read the SVG's intrinsic dimensions and size the viewport to match exactly,
  // so the screenshot captures the full diagram without scrollbars or clipping.
  const { width, height } = await page.evaluate(() => {
    const svg = document.querySelector('svg');
    return {
      width:  Math.ceil(svg.width.baseVal.value),
      height: Math.ceil(svg.height.baseVal.value),
    };
  });

  await page.setViewport({ width, height, deviceScaleFactor: 1 });

  mkdirSync(outDir, { recursive: true });
  const pngPath = resolve(outDir, `${domain}.png`);
  await page.screenshot({ path: pngPath, fullPage: false });
  console.log(`Wrote ${pngPath}`);

  await browser.close();
}
