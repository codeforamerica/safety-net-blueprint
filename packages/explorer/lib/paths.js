/**
 * Shared filesystem paths for all explorer build scripts.
 */

import { readdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to packages/resolved/ — the authoritative source for all explorer builds. */
export const resolvedDir = resolve(__dirname, '../../resolved');

const LABEL_MAP = {
  'openapi':       'API spec',
  'asyncapi':      'Async API',
  'state-machine': 'State machine',
};

// These suffixes are shown first (in order), everything else is alphabetical after them.
const PRIORITY = ['openapi', 'state-machine'];

/**
 * Dynamically discover all resolved source files for a domain slug.
 * Returns [['Label', 'packages/resolved/{file}']] — API spec and state machine first,
 * then remaining files alphabetically. annotations-docs is merged into annotations.
 *
 * @param {string} slug  - domain slug, e.g. 'intake'
 * @param {{ include?: string[], exclude?: string[] }} [opts]
 *   include — only show these suffixes (e.g. ['openapi', 'state-machine']); if omitted, show all
 *   exclude — suffixes to omit (ignored when include is set)
 */
export function resolvedSourcePairs(slug, { include, exclude = [] } = {}) {
  if (!existsSync(resolvedDir)) return [];

  // Collect the raw suffix set for this slug.
  const allSuffixes = readdirSync(resolvedDir)
    .filter(f => f.startsWith(`${slug}-`) && f.endsWith('.yaml'))
    .map(f => f.slice(slug.length + 1, -5))
    .filter(s => include ? include.includes(s) : !exclude.includes(s));

  // If both 'annotations' and 'annotations-docs' exist, drop the -docs variant
  // (the real annotations file takes priority). If only -docs exists, keep it
  // but display as "Annotations".
  const suffixes = new Set(allSuffixes);
  if (suffixes.has('annotations') && suffixes.has('annotations-docs')) {
    suffixes.delete('annotations-docs');
  }

  const suffixMap = new Map();
  for (const suffix of suffixes) {
    const normalized = suffix === 'annotations-docs' ? 'annotations' : suffix;
    suffixMap.set(normalized, `${slug}-${suffix}.yaml`);
  }

  // Priority suffixes first (in declared order), then the rest alphabetically.
  const priorityEntries = PRIORITY.flatMap(p => suffixMap.has(p) ? [[p, suffixMap.get(p)]] : []);
  const restEntries = [...suffixMap.entries()]
    .filter(([s]) => !PRIORITY.includes(s))
    .sort(([a], [b]) => a.localeCompare(b));

  return [...priorityEntries, ...restEntries].map(([suffix, f]) => {
    const label = LABEL_MAP[suffix] ?? suffix.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return [label, `packages/resolved/${f}`];
  });
}
