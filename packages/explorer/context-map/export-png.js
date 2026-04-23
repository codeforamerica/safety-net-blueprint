#!/usr/bin/env node
/**
 * export-png.js
 *
 * Uses Puppeteer to render each context map view as a PNG, then packages
 * them into a zip file for easy sharing.
 *
 * Usage:
 *   node export-png.js [output-dir]
 *
 * Output:
 *   output/<view>.png          — one PNG per view
 *   output/context-map-export.zip — all PNGs in a zip
 */

import puppeteer from 'puppeteer';
import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(__dirname, 'output');

const htmlPath = resolve(outDir, 'context-map.html');
const fileUrl = pathToFileURL(htmlPath).href;

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

// 1400px viewport makes fitDiagram() compute scale=1 (no transform distortion).
// deviceScaleFactor:2 produces retina-quality output.
await page.setViewport({ width: 1400, height: 1100, deviceScaleFactor: 2 });
await page.goto(fileUrl, { waitUntil: 'networkidle0' });

const keys = await page.evaluate(() => Object.keys(CONTENT));

const zip = new JSZip();
const folder = zip.folder('context-map');

for (let i = 0; i < keys.length; i++) {
  const key = keys[i];
  process.stdout.write(`  [${i + 1}/${keys.length}] ${key}...`);

  await page.evaluate(id => navigate(id), key);
  // Let the layout settle after navigation
  await new Promise(r => setTimeout(r, 150));

  const el = await page.$('#map-wrapper');
  const png = await el.screenshot({ type: 'png' });

  const filename = key + '.png';
  writeFileSync(resolve(outDir, filename), png);
  folder.file(filename, png);

  process.stdout.write(' done\n');
}

await browser.close();

const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
const zipPath = resolve(outDir, 'context-map-export.zip');
writeFileSync(zipPath, zipBuffer);
console.log(`Written: ${zipPath}`);
