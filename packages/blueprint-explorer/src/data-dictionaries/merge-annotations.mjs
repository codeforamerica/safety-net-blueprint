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
 *   --spec         Path to the OpenAPI spec for the domain. Enables schema-relative annotation keys.
 *   --annotations  Path to an annotation YAML file. Repeat for multiple layers (applied in order, last wins).
 *   --out          Output file path. Defaults to stdout if omitted.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname, basename } from 'path';
import yaml from 'js-yaml';
import { load as loadDoc } from '@codeforamerica/blueprint-core';
import { findSpecRelativePaths } from '../contract-nav.js';

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

const { input: inputArg, spec: specArg, annotations: annotationArgs, out: outArg } = cliArgs;

if (!inputArg) {
  console.error('Usage: node merge-annotations.mjs --input=<file> [--spec=<file>] [--annotations=<file>]... [--out=<file>]');
  process.exit(1);
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Merge annotation layers onto an input map.
 *
 * Annotation keys may be spec-relative ("application.members[].dateOfBirth")
 * or schema-relative ("applicationMember.dateOfBirth"). Both resolve to the
 * same field — schema-relative keys are expanded to all spec-relative paths
 * where that schema appears as array items. If a schema appears in multiple
 * places, the annotation is applied to all of them.
 *
 * When a spec is provided, schema-relative resolution uses the OpenAPI
 * document directly via findSpecRelativePaths. Without one, annotation keys
 * are matched against the input inventory as-is.
 *
 * @param {Record<string, object>} input  - Flat map (field inventory or crosswalk).
 * @param {{ path: string, layer: Record<string, object> }[]} layers - Ordered annotation layers.
 * @param {{ spec?: import('@codeforamerica/blueprint-core').Doc|null }} [opts]
 * @returns {Record<string, object>} - Input entries with `annotations` block merged in.
 */
export function mergeAnnotations(input, layers, { spec = null } = {}) {
  // Resolve an annotation key to one or more spec-relative inventory paths.
  // If the spec is available, use findSpecRelativePaths for schema-relative keys.
  // Otherwise fall back to exact match.
  function resolveKey(key) {
    if (Object.prototype.hasOwnProperty.call(input, key)) return [key];
    if (spec) return findSpecRelativePaths(spec, key);
    return [key];
  }

  const result = {};

  // Collect all resolved field paths
  const allPaths = new Set(Object.keys(input));
  for (const { layer } of layers) {
    for (const key of Object.keys(layer)) {
      for (const resolved of resolveKey(key)) allPaths.add(resolved);
    }
  }

  // Warn about annotation keys that don't resolve to any inventory path
  for (const { path: layerPath, layer } of layers) {
    for (const key of Object.keys(layer)) {
      const resolved = resolveKey(key);
      if (!resolved.some(r => Object.prototype.hasOwnProperty.call(input, r))) {
        console.warn(`  Warning: annotation key "${key}" not found in input (from ${basename(layerPath)})`);
      }
    }
  }

  for (const fieldPath of [...allPaths].sort()) {
    const { annotations: _existing, ...rest } = input[fieldPath] ?? {};

    const mergedAnnotations = {};
    for (const { layer } of layers) {
      for (const [key, layerAnnotations] of Object.entries(layer)) {
        if (!resolveKey(key).includes(fieldPath)) continue;
        if (layerAnnotations && typeof layerAnnotations === 'object') {
          Object.assign(mergedAnnotations, layerAnnotations);
        }
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

  let spec = null;
  if (specArg) {
    const specPath = resolve(specArg);
    if (!existsSync(specPath)) {
      console.error(`Spec file not found: ${specPath}`);
      process.exit(1);
    }
    spec = loadDoc(specPath);
  }

  const layers = [];
  for (const annotationArg of annotationArgs ?? []) {
    const annotationPath = resolve(annotationArg);
    if (!existsSync(annotationPath)) {
      console.error(`Annotation file not found: ${annotationPath}`);
      process.exit(1);
    }
    const layer = yaml.load(readFileSync(annotationPath, 'utf8'), { schema: yaml.DEFAULT_SCHEMA }) ?? {};
    layers.push({ path: annotationPath, layer });
  }

  if (layers.length === 0) {
    console.warn('No --annotations provided; output will match input.');
  }

  const result = mergeAnnotations(input, layers, { spec });
  const out = yaml.dump(result, { lineWidth: -1, noRefs: true });

  if (outArg) {
    writeFileSync(resolve(outArg), out, 'utf8');
    console.log(`Wrote ${resolve(outArg)}`);
  } else {
    process.stdout.write(out);
  }
}
