#!/usr/bin/env node

/**
 * Builds README.md for each workspace package by combining a shared template
 * with per-package content and metadata from package.json.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const packages = ['contracts', 'mock-server', 'clients'];
const templatePath = join(__dirname, 'templates', 'README.template.md');
const template = readFileSync(templatePath, 'utf8');

for (const pkg of packages) {
  const pkgDir = join(rootDir, 'packages', pkg);
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const content = readFileSync(join(pkgDir, 'README.content.md'), 'utf8');

  const readme = template
    .replaceAll('{{packageName}}', pkgJson.name)
    .replaceAll('{{description}}', pkgJson.description)
    .replaceAll('{{version}}', pkgJson.version)
    .replace('{{content}}', content);

  writeFileSync(join(pkgDir, 'README.md'), readme);
  console.log(`  Generated ${pkg}/README.md`);
}

console.log('Done.');
