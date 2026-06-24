#!/usr/bin/env node
/**
 * Fragment $ref Validator
 *
 * Walks all *.yaml files in the given directory and checks that every $ref
 * starting with "#/" resolves to an existing node within the same document.
 *
 * External refs (e.g. "./components/responses.yaml#/...") are skipped — those
 * are checked by the OpenAPI validator. This script catches internally
 * inconsistent documents where the ref path was rewritten (e.g. from
 * #/$defs/X to #/components/schemas/X) without moving the definition.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Recursively find all .yaml files in a directory, excluding node_modules.
 */
function findYamlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const fullPath = resolve(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...findYamlFiles(fullPath));
    } else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Navigate a JSON pointer (e.g. "/components/schemas/Foo") from the root doc.
 * Returns true if the path resolves to a non-undefined value.
 */
function fragmentResolves(doc, pointer) {
  const parts = pointer.split('/').filter(Boolean);
  let cur = doc;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return false;
    const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~');
    cur = cur[decoded];
  }
  return cur !== undefined;
}

/**
 * Walk a parsed YAML value and collect all fragment $ref strings.
 * Returns an array of strings like "/components/schemas/Foo".
 */
function collectFragmentRefs(node, refs = []) {
  if (!node || typeof node !== 'object') return refs;
  if (Array.isArray(node)) {
    for (const item of node) collectFragmentRefs(item, refs);
    return refs;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#/')) {
      refs.push(value.slice(1)); // strip leading '#'
    } else {
      collectFragmentRefs(value, refs);
    }
  }
  return refs;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Fragment $ref Validator\n');
    console.log('Usage: node scripts/validate-refs.js --spec=<dir>\n');
    console.log('Checks that every fragment $ref (#/...) in each *.yaml file');
    console.log('resolves to an existing node within the same document.\n');
    console.log('Flags:');
    console.log('  --spec=<dir>   Path to directory of resolved specs (required)');
    console.log('  -h, --help     Show this help message');
    process.exit(0);
  }

  const specArg = args.find(a => a.startsWith('--spec='));
  if (!specArg) {
    console.error('Error: --spec=<dir> is required');
    process.exit(1);
  }

  const specPath = resolve(process.cwd(), specArg.slice('--spec='.length));

  let stat;
  try {
    stat = statSync(specPath);
  } catch {
    console.error(`Error: path not found: ${specPath}`);
    process.exit(1);
  }

  if (!stat.isDirectory()) {
    console.error(`Error: --spec must be a directory, not a file`);
    process.exit(1);
  }

  const files = findYamlFiles(specPath);
  const errors = [];

  for (const filePath of files) {
    let doc;
    try {
      doc = yaml.load(readFileSync(filePath, 'utf8'));
    } catch (e) {
      errors.push({ file: relative(process.cwd(), filePath), error: `Failed to parse: ${e.message}` });
      continue;
    }

    if (!doc || typeof doc !== 'object') continue;

    const refs = collectFragmentRefs(doc);
    const seen = new Set();

    for (const pointer of refs) {
      if (seen.has(pointer)) continue;
      seen.add(pointer);

      if (!fragmentResolves(doc, pointer)) {
        errors.push({
          file: relative(process.cwd(), filePath),
          ref: `#${pointer}`,
          error: 'fragment $ref does not resolve within this document'
        });
      }
    }
  }

  if (errors.length > 0) {
    console.error(`\nFragment $ref validation failed — ${errors.length} error(s):\n`);
    for (const e of errors) {
      if (e.ref) {
        console.error(`  ${e.file}\n    ${e.ref}: ${e.error}`);
      } else {
        console.error(`  ${e.file}: ${e.error}`);
      }
    }
    console.error('');
    process.exit(1);
  }

  console.log(`Fragment $refs: ${files.length} file(s) checked, all fragment refs resolve.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
