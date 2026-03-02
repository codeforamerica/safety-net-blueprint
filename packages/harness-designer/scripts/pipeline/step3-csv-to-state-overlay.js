/**
 * Step 3: State CSV → state overlay YAML
 *
 * Parses a state benefits overlay CSV and generates an OpenAPI overlay
 * with actions based on OverlayAction (update, remove, add, add_program).
 *
 * Supports California, Colorado, and future state overlays via configurable
 * program maps and column prefixes.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import yaml from 'js-yaml';
import { parseCSV } from './csv-parser.js';
import {
  INCLUDED_ENTITIES,
  CA_PROGRAM_MAP,
  CA_PROGRAM_COLUMNS,
  CO_PROGRAM_MAP,
  CO_PROGRAM_COLUMNS,
  openapiFieldPath,
  csvTypeToOpenAPI,
} from './entity-map.js';

/**
 * State-specific configuration for overlay generation.
 */
const STATE_CONFIG = {
  california: {
    programMap: CA_PROGRAM_MAP,
    programColumns: CA_PROGRAM_COLUMNS,
    statuteCol: 'CA Policy/Statute',
    notesCol: 'CA Notes',
    labelCol: 'CA Label',
    dataTypeCol: 'CA DataType',
    enumCol: 'CA EnumValues',
    sourceCol: 'CA Source',
    statuteKey: 'x-ca-statute',
    notesKey: 'x-ca-notes',
    overlayTitle: 'California Benefits Overlay',
    prefix: 'CA',
  },
  colorado: {
    programMap: CO_PROGRAM_MAP,
    programColumns: CO_PROGRAM_COLUMNS,
    statuteCol: 'CO Policy/Statute',
    notesCol: 'CO Notes',
    labelCol: 'CO Label',
    dataTypeCol: 'CO DataType',
    enumCol: 'CO EnumValues',
    sourceCol: 'CO Source',
    statuteKey: 'x-co-statute',
    notesKey: 'x-co-notes',
    overlayTitle: 'Colorado Benefits Overlay',
    prefix: 'CO',
  },
};

/**
 * @param {string} csvPath - Path to state CSV
 * @param {string} outPath - Path for output YAML
 * @param {string} [stateName='california'] - State key for configuration
 */
export function generateStateOverlay(csvPath, outPath, stateName = 'california') {
  const cfg = STATE_CONFIG[stateName];
  if (!cfg) throw new Error(`Unknown state: ${stateName}`);

  const text = readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(text);

  const actions = [];
  let updateCount = 0, removeCount = 0, addCount = 0, addProgramCount = 0, skippedCount = 0;

  for (const row of rows) {
    const action = row.OverlayAction;
    const entity = row.Entity;

    // Skip add_program rows (they define state-only programs, not field changes)
    if (action === 'add_program') {
      addProgramCount++;
      continue;
    }

    // Skip entities not in scope
    if (!INCLUDED_ENTITIES.includes(entity)) {
      skippedCount++;
      continue;
    }

    if (!row.Field) continue;

    if (action === 'update') {
      const update = {};

      // State-specific metadata
      const statute = row[cfg.statuteCol];
      if (statute) update[cfg.statuteKey] = statute;

      const notes = row[cfg.notesCol];
      if (notes) update[cfg.notesKey] = notes;

      // State program columns
      for (const col of cfg.programColumns) {
        const value = row[col];
        if (value) {
          const key = cfg.programMap[col];
          update[key] = value;
        }
      }

      // Enum override (e.g., preferredLanguage with additional state languages)
      if (row[cfg.enumCol]) {
        const values = row[cfg.enumCol].split('|').map(v => v.trim()).filter(Boolean);
        update.enum = values;
      }

      if (Object.keys(update).length === 0) continue;

      const target = openapiFieldPath(entity, row.Field);
      actions.push({
        target,
        description: `${cfg.prefix} update: ${entity}.${row.Field}`,
        update,
      });
      updateCount++;

    } else if (action === 'remove') {
      const target = openapiFieldPath(entity, row.Field);
      actions.push({
        target,
        description: `${cfg.prefix} remove: ${entity}.${row.Field}`,
        remove: true,
      });
      removeCount++;

    } else if (action === 'add') {
      // Add a new field to the entity
      const typeInfo = csvTypeToOpenAPI(row[cfg.dataTypeCol], row[cfg.enumCol]);

      if (row[cfg.labelCol]) {
        typeInfo.description = row[cfg.labelCol];
      }

      // State-specific metadata on the new field
      const statute = row[cfg.statuteCol];
      if (statute) typeInfo[cfg.statuteKey] = statute;

      const notes = row[cfg.notesCol];
      if (notes) typeInfo[cfg.notesKey] = notes;

      const source = row[cfg.sourceCol];
      if (source) typeInfo['x-source'] = source;

      // State program columns
      for (const col of cfg.programColumns) {
        const value = row[col];
        if (value) {
          const key = cfg.programMap[col];
          typeInfo[key] = value;
        }
      }

      const target = `$.components.schemas.${entity}.properties`;
      actions.push({
        target,
        description: `${cfg.prefix} add: ${entity}.${row.Field}`,
        update: { [row.Field]: typeInfo },
      });
      addCount++;
    }
  }

  const overlay = {
    overlay: '1.0.0',
    info: {
      title: cfg.overlayTitle,
      version: '1.0.0',
    },
    actions,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, yaml.dump(overlay, { lineWidth: 120, noRefs: true }));

  console.log(`  ${actions.length} actions: ${updateCount} update, ${removeCount} remove, ${addCount} add`);
  console.log(`  ${addProgramCount} add_program rows (state-only programs, metadata only)`);
  if (skippedCount) console.log(`  ${skippedCount} rows skipped (entities not in scope)`);

  return overlay;
}
