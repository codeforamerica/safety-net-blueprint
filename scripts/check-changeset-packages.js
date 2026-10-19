#!/usr/bin/env node
/**
 * Lists pending changesets that name more than one package.
 *
 * A changeset's text goes into the release notes of every package it names,
 * at that package's bump — so an entry about state machines lands under the
 * CLI's patch changes if the changeset names the CLI too. Some changesets do
 * apply to several packages, so this reports them for a person to look at
 * rather than failing. Prints nothing when there are none.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const dir = '.changeset';
for (const file of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()) {
  const front = readFileSync(join(dir, file), 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const packages = [...front.matchAll(/^["']?([^"':\s]+)["']?\s*:\s*(major|minor|patch)\s*$/gm)].map(([, name, bump]) => `${name} (${bump})`);
  if (packages.length > 1) console.log(`${file}: ${packages.join(', ')}`);
}
