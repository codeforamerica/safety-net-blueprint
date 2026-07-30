#!/usr/bin/env node
/**
 * merge-annotations.mjs
 *
 * Merges annotation layers onto a field inventory or crosswalk YAML.
 * Both inputs are flat maps keyed by field paths (dot-notation or external identifier).
 * Annotation layers are applied in order — last wins per key.
 *
 * Usage:
 *   node merge-annotations.mjs --input=field-inventory.yaml --annotations=annotations.yaml [--annotations=more.yaml] [--out=output.yaml]
 *
 * Flags:
 *   --input        Path to a field inventory or crosswalk YAML file (flat map keyed by field path).
 *   --annotations  Path to an annotation YAML file. Repeat for multiple layers (applied in order, last wins).
 *   --out          Output file path. Defaults to stdout if omitted.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname, basename } from 'path';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);

// ─── CLI ──────────────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2).filter(a => a.startsWith('--'));
const cliArgs = {};
for (const arg of rawArgs) {
  const eq = arg.indexOf('=');
  const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
  const val = eq >= 0 ? arg.slice(eq + 1) : true;
  if (key === 'annotations') {
    if (!cliArgs.annotations) cliArgs.annotations = [];
    cliArgs.annotations.push(val);
  } else {
    cliArgs[key] = val;
  }
}

const { input: inputArg, annotations: annotationArgs, out: outArg } = cliArgs;

if (!inputArg) {
  console.error('Usage: node merge-annotations.mjs --input=<file> [--annotations=<file>]... [--out=<file>]');
  process.exit(1);
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Merge annotation layers onto an input map.
 *
 * @param {Record<string, object>} input  - Flat map (field inventory or crosswalk).
 * @param {{ path: string, layer: Record<string, object> }[]} layers - Ordered annotation layers.
 * @returns {Record<string, object>} - Input entries with `annotations` block merged in.
 */
export function mergeAnnotations(input, layers) {
  const result = {};

  // Collect all field paths across input and all annotation layers
  const allPaths = new Set(Object.keys(input));
  for (const { layer } of layers) {
    for (const path of Object.keys(layer)) allPaths.add(path);
  }

  // Warn about annotation paths not present in input
  for (const { path: layerPath, layer } of layers) {
    for (const fieldPath of Object.keys(layer)) {
      if (!Object.prototype.hasOwnProperty.call(input, fieldPath)) {
        console.warn(`  Warning: annotation key "${fieldPath}" not found in input (from ${basename(layerPath)})`);
      }
    }
  }

  for (const fieldPath of [...allPaths].sort()) {
    const { annotations: _existing, ...rest } = input[fieldPath] ?? {};

    const mergedAnnotations = {};
    for (const { layer } of layers) {
      const layerAnnotations = layer[fieldPath];
      if (layerAnnotations && typeof layerAnnotations === 'object') {
        Object.assign(mergedAnnotations, layerAnnotations);
      }
    }

    result[fieldPath] = Object.keys(mergedAnnotations).length > 0
      ? { ...rest, annotations: mergedAnnotations }
      : { ...rest };
  }

  return result;
}

// ─── Main (CLI only) ──────────────────────────────────────────────────────────

if (process.argv[1] === __filename) {
  const inputPath = resolve(inputArg);
  if (!existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const input = yaml.load(readFileSync(inputPath, 'utf8')) ?? {};

  const layers = [];
  for (const annotationArg of annotationArgs ?? []) {
    const annotationPath = resolve(annotationArg);
    if (!existsSync(annotationPath)) {
      console.error(`Annotation file not found: ${annotationPath}`);
      process.exit(1);
    }
    const layer = yaml.load(readFileSync(annotationPath, 'utf8')) ?? {};
    layers.push({ path: annotationPath, layer });
  }

  if (layers.length === 0) {
    console.warn('No --annotations provided; output will match input.');
  }

  const result = mergeAnnotations(input, layers);
  const out = yaml.dump(result, { lineWidth: -1, noRefs: true });

  if (outArg) {
    writeFileSync(resolve(outArg), out, 'utf8');
    console.log(`Wrote ${resolve(outArg)}`);
  } else {
    process.stdout.write(out);
  }
}
