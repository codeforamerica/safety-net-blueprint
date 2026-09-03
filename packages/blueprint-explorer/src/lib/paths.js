/**
 * Shared filesystem paths for all explorer build scripts.
 */

import { readdirSync, existsSync } from 'fs';
import { dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the resolved contracts directory.
 *  Provided via --resolved=<path>; null if not supplied. */
const resolvedArg = process.argv.find(a => a.startsWith('--resolved='));
export const resolvedDir = resolvedArg
  ? resolve(process.cwd(), resolvedArg.slice('--resolved='.length))
  : null;

const LABEL_MAP = {
  'openapi':       'API spec',
  'asyncapi':      'Async API',
  'state-machine': 'State machine',
};

// These suffixes are shown first (in order), everything else is alphabetical after them.
const PRIORITY = ['openapi', 'state-machine'];

/**
 * Build a source file link from repo config and a path relative to the resolved dir.
 * Returns null if repo.url is not configured.
 *
 * @param {object|null} repo  - The repo object from config.yaml
 * @param {string} relPath    - Path relative to the resolved contracts dir (mirrors source structure)
 * @returns {string|null}
 */
export function buildSpecLink(repo, relPath) {
  if (!repo?.url) return null;
  const template = repo.link_template ?? '{url}/blob/{branch}/{spec_path}';
  const branch = repo.branch ?? 'main';
  const normalized = relPath.replace(/\\/g, '/');
  const fullPath = repo.spec_path ? `${repo.spec_path}/${normalized}` : normalized;
  return template
    .replace('{url}', repo.url)
    .replace('{branch}', branch)
    .replace('{spec_path}', fullPath);
}

/**
 * Dynamically discover all resolved source files for a domain slug.
 * Returns [label, filename, href?] tuples — href present when repo config is provided.
 * API spec and state machine first, then remaining files alphabetically.
 * annotations-docs is merged into annotations.
 *
 * @param {string} slug  - domain slug, e.g. 'intake'
 * @param {{ include?: string[], exclude?: string[] }} [opts]
 *   include — only show these suffixes (e.g. ['openapi', 'state-machine']); if omitted, show all
 *   exclude — suffixes to omit (ignored when include is set)
 * @param {object|null} [repo] - repo config from config.yaml; if provided, pairs include a link href
 */
export function resolvedSourcePairs(slug, { include, exclude = [] } = {}, repo = null) {
  if (!existsSync(resolvedDir)) return [];

  // Collect all matching relative paths — search recursively since resolved
  // files now live under domains/ subdirectories.
  const allRelPaths = readdirSync(resolvedDir, { recursive: true })
    .filter(f => typeof f === 'string' && basename(f).startsWith(`${slug}-`) && f.endsWith('.yaml'));

  // Build suffix → relPath map (normalized forward-slash paths for URL use).
  // 'annotations-docs' is normalized to 'annotations'.
  const suffixMap = new Map();
  for (const relPath of allRelPaths) {
    const suffix = basename(relPath).slice(slug.length + 1, -5);
    if (include ? !include.includes(suffix) : exclude.includes(suffix)) continue;
    const normalized = suffix === 'annotations-docs' ? 'annotations' : suffix;
    // Prefer non-docs variant if both exist
    if (normalized === 'annotations' && suffixMap.has('annotations') && suffix !== 'annotations-docs') {
      suffixMap.set(normalized, relPath.replace(/\\/g, '/'));
    } else if (!suffixMap.has(normalized)) {
      suffixMap.set(normalized, relPath.replace(/\\/g, '/'));
    }
  }

  // Priority suffixes first (in declared order), then the rest alphabetically.
  const priorityEntries = PRIORITY.flatMap(p => suffixMap.has(p) ? [[p, suffixMap.get(p)]] : []);
  const restEntries = [...suffixMap.entries()]
    .filter(([s]) => !PRIORITY.includes(s))
    .sort(([a], [b]) => a.localeCompare(b));

  return [...priorityEntries, ...restEntries].map(([suffix, relPath]) => {
    const label = LABEL_MAP[suffix] ?? suffix.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const filename = basename(relPath);
    const href = buildSpecLink(repo, relPath);
    return href ? [label, filename, href] : [label, filename];
  });
}
