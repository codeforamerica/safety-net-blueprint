/**
 * Step 2: Federal CSV → federal annotation overlay YAML
 *
 * Parses the federal CSV and generates an OpenAPI overlay with x- extensions
 * for source, statute, OBBBA, and per-program requirement annotations.
 *
 * Output: generated/overlays/federal-annotations.overlay.yaml
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import yaml from 'js-yaml';
import { parseCSV } from './csv-parser.js';
import {
  INCLUDED_ENTITIES,
  SYSTEM_FIELDS,
  FEDERAL_PROGRAM_MAP,
  FEDERAL_PROGRAM_COLUMNS,
  openapiFieldPath,
} from './entity-map.js';

/**
 * @param {string} csvPath - Path to federal CSV
 * @param {string} outPath - Path for output YAML
 */
export function generateFederalOverlay(csvPath, outPath) {
  const text = readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(text);

  const actions = [];

  for (const row of rows) {
    const entity = row.Entity;
    if (!INCLUDED_ENTITIES.includes(entity)) continue;
    if (!row.Field || row.Field.startsWith('(')) continue;
    if (SYSTEM_FIELDS.has(row.Field)) continue;

    const update = {};

    // Source
    if (row.Source) {
      update['x-source'] = row.Source;
    }

    // Statute
    const statute = row['Policy/Statute'];
    if (statute) {
      update['x-statute'] = statute;
    }

    // OBBBA
    const obbba = row['OBBBA (H.R.1)'];
    if (obbba) {
      update['x-obbba'] = obbba;
    }

    // Federal program columns
    for (const col of FEDERAL_PROGRAM_COLUMNS) {
      const value = row[col];
      if (value) {
        const key = FEDERAL_PROGRAM_MAP[col];
        update[key] = value;
      }
    }

    if (Object.keys(update).length === 0) continue;

    const target = openapiFieldPath(entity, row.Field);
    actions.push({
      target,
      description: `${entity}.${row.Field}`,
      update,
    });
  }

  const overlay = {
    overlay: '1.0.0',
    info: {
      title: 'Federal Benefits Data Model — Annotations',
      version: '1.0.0',
    },
    actions,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, yaml.dump(overlay, { lineWidth: 120, noRefs: true }));

  console.log(`  ${actions.length} annotation actions generated`);

  return overlay;
}
