/**
 * Step 4: Apply overlays to base OpenAPI schema
 *
 * Loads the base schema and overlay files, applies them sequentially using the
 * existing overlay-resolver library from packages/contracts.
 *
 * The resolver's setAtPath does shallow object merge, so CA x-extensions merge
 * alongside federal ones on existing fields.
 *
 * Output: generated/openapi/{state}-benefits-schema.yaml
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, basename } from 'path';
import yaml from 'js-yaml';
import { applyOverlay } from '@codeforamerica/safety-net-blueprint-contracts/overlay';

/**
 * @param {string} basePath - Path to base OpenAPI schema
 * @param {string[]} overlayPaths - Paths to overlay YAML files (applied in order)
 * @param {string} outPath - Path for resolved output
 */
export function applyOverlays(basePath, overlayPaths, outPath) {
  const baseText = readFileSync(basePath, 'utf-8');
  let spec = yaml.load(baseText);

  let totalActions = 0;
  let totalWarnings = 0;

  for (const overlayPath of overlayPaths) {
    const overlayText = readFileSync(overlayPath, 'utf-8');
    const overlay = yaml.load(overlayText);

    const actionCount = overlay.actions?.length || 0;
    const title = overlay.info?.title || overlayPath;
    console.log(`  Applying: ${title} (${actionCount} actions)`);

    const { result, warnings } = applyOverlay(spec, overlay, { silent: true });
    spec = result;
    totalActions += actionCount;

    if (warnings.length > 0) {
      totalWarnings += warnings.length;
      for (const w of warnings) {
        console.log(`    ! ${w}`);
      }
    }
  }

  // Stamp x-api-id to match the output filename (e.g. "california-benefits-schema")
  const apiId = basename(outPath, '.yaml');
  spec.info = { ...spec.info, 'x-api-id': apiId };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, yaml.dump(spec, { lineWidth: 120, noRefs: true }));

  console.log(`  ${totalActions} total actions applied, ${totalWarnings} warnings`);

  return spec;
}
