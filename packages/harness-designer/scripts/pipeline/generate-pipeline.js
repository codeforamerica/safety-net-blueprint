#!/usr/bin/env node
/**
 * Pipeline Orchestrator
 *
 * Runs the full CSV-to-overlay pipeline:
 *   1. Federal CSV → OpenAPI schema (once)
 *   2. Federal CSV → federal annotation overlay (once)
 *   3. State CSV → state overlay (per state)
 *   4. Apply overlays → state OpenAPI spec (per state)
 *   5. Resolved spec → Zod schemas (per state → generated/schemas/)
 *   6a. Base schema → federal annotations (once → generated/annotations/federal.yaml)
 *   6b. Resolved spec → state annotations (per state → generated/annotations/{state}.yaml)
 *
 * Usage: node scripts/pipeline/generate-pipeline.js
 */

import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { generateOpenAPISchema } from './step1-csv-to-openapi.js';
import { generateFederalOverlay } from './step2-csv-to-federal-overlay.js';
import { generateStateOverlay } from './step3-csv-to-state-overlay.js';
import { applyOverlays } from './step4-apply-overlays.js';
import { generateZodSchemas } from './step5-openapi-to-zod.js';
import { generateFederalAnnotations, generateStateAnnotations } from './step6-openapi-to-annotations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');

// ─── Federal paths (shared) ─────────────────────────────────────────────────

const FEDERAL_CSV   = join(ROOT, 'authored', 'csv', 'federal-benefits-data-model.csv');
const BASE_SCHEMA   = join(ROOT, 'generated', 'openapi', 'federal-benefits-schema.yaml');
const FED_OVERLAY   = join(ROOT, 'generated', 'overlays', 'federal-annotations.overlay.yaml');
const FED_ANNOTATIONS = join(ROOT, 'generated', 'annotations', 'federal.yaml');

// ─── State configurations ────────────────────────────────────────────────────

const STATES = [
  {
    name: 'california',
    csv:          join(ROOT, 'authored', 'csv', 'states', 'california-benefits-overlay.csv'),
    overlay:      join(ROOT, 'generated', 'overlays', 'california.overlay.yaml'),
    resolvedSpec: join(ROOT, 'generated', 'openapi', 'california-benefits-schema.yaml'),
    zodOut:       join(ROOT, 'generated', 'schemas', 'application-california.ts'),
    annotations:  join(ROOT, 'generated', 'annotations', 'california.yaml'),
  },
  {
    name: 'colorado',
    csv:          join(ROOT, 'authored', 'csv', 'states', 'colorado-benefits-overlay.csv'),
    overlay:      join(ROOT, 'generated', 'overlays', 'colorado.overlay.yaml'),
    resolvedSpec: join(ROOT, 'generated', 'openapi', 'colorado-benefits-schema.yaml'),
    zodOut:       join(ROOT, 'generated', 'schemas', 'application-colorado.ts'),
    annotations:  join(ROOT, 'generated', 'annotations', 'colorado.yaml'),
  },
];

// ─── Run ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('=== CSV-to-Overlay Pipeline ===\n');

  console.log('Step 1: Federal CSV → OpenAPI schema');
  generateOpenAPISchema(FEDERAL_CSV, BASE_SCHEMA);
  console.log(`  → ${BASE_SCHEMA}\n`);

  console.log('Step 2: Federal CSV → federal annotation overlay');
  generateFederalOverlay(FEDERAL_CSV, FED_OVERLAY);
  console.log(`  → ${FED_OVERLAY}\n`);

  for (const state of STATES) {
    console.log(`\n--- ${state.name.toUpperCase()} ---\n`);

    console.log(`Step 3: ${state.name} CSV → state overlay`);
    generateStateOverlay(state.csv, state.overlay, state.name);
    console.log(`  → ${state.overlay}\n`);

    console.log(`Step 4: Apply overlays → resolved spec`);
    applyOverlays(BASE_SCHEMA, [FED_OVERLAY, state.overlay], state.resolvedSpec);
    console.log(`  → ${state.resolvedSpec}\n`);

    console.log(`Step 5: Resolved spec → Zod schemas`);
    generateZodSchemas(state.resolvedSpec, state.zodOut);
    console.log(`  → ${state.zodOut}\n`);

    console.log(`Step 6: Resolved spec → state annotations`);
    generateStateAnnotations(state.resolvedSpec, state.annotations, state.name);
  }

  // Federal annotations extracted from the first state's resolved spec
  // (federal x-extensions are identical across all state-resolved specs)
  console.log('\nStep 6: Federal annotations (from resolved spec)');
  generateFederalAnnotations(STATES[0].resolvedSpec, FED_ANNOTATIONS);

  console.log('\n=== Pipeline complete ===');
}

main();
