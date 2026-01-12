#!/usr/bin/env node
/**
 * Resolve OpenAPI overlays for state-specific configurations.
 *
 * This script applies OpenAPI Overlay Specification (1.0.0) transformations
 * to base schemas, producing state-specific resolved specifications.
 *
 * Two-pass processing:
 *   1. Scan all files to determine where each target path exists
 *   2. Apply actions with smart file scoping:
 *      - Target in 0 files → warning
 *      - Target in 1 file → auto-apply to that file
 *      - Target in 2+ files → require file/files property
 *
 * Usage:
 *   STATE=california node scripts/resolve-overlay.js
 *   node scripts/resolve-overlay.js --state=colorado
 *
 * The resolved specs are written to openapi/resolved/ and used by
 * the mock server, client generators, and other tooling.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, cpSync, rmSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { applyOverlay, checkPathExists } from '../src/overlay/overlay-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const openapiDir = join(rootDir, 'openapi');
const overlaysDir = join(openapiDir, 'overlays');
const resolvedDir = join(openapiDir, 'resolved');

/**
 * Get the state from environment or CLI args
 */
function getState() {
  // Check CLI args first
  const stateArg = process.argv.find(arg => arg.startsWith('--state='));
  if (stateArg) {
    return stateArg.split('=')[1];
  }

  // Fall back to environment variable
  return process.env.STATE || null;
}

/**
 * List available state overlays
 */
function listAvailableStates() {
  if (!existsSync(overlaysDir)) {
    return [];
  }

  return readdirSync(overlaysDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(overlaysDir, entry.name, 'modifications.yaml')))
    .map(entry => entry.name);
}

/**
 * Recursively collect all YAML files with their relative paths and contents
 */
function collectYamlFiles(sourceDir, baseDir = sourceDir) {
  const files = readdirSync(sourceDir, { withFileTypes: true });
  let yamlFiles = [];

  for (const file of files) {
    const sourcePath = join(sourceDir, file.name);

    if (file.isDirectory()) {
      // Skip overlays and resolved directories
      if (file.name === 'overlays' || file.name === 'resolved') {
        continue;
      }
      yamlFiles = yamlFiles.concat(collectYamlFiles(sourcePath, baseDir));
    } else if (file.name.endsWith('.yaml')) {
      const relativePath = relative(baseDir, sourcePath);
      const content = readFileSync(sourcePath, 'utf8');
      const spec = yaml.load(content);
      yamlFiles.push({ relativePath, sourcePath, spec });
    }
  }

  return yamlFiles;
}

/**
 * For each action, find which files contain the full target path
 */
function analyzeTargetLocations(overlay, yamlFiles) {
  const actionFileMap = new Map();

  if (!overlay.actions || !Array.isArray(overlay.actions)) {
    return actionFileMap;
  }

  for (let i = 0; i < overlay.actions.length; i++) {
    const action = overlay.actions[i];
    const { target } = action;

    if (!target) continue;

    // Find all files where the full target path exists
    const matchingFiles = [];
    for (const { relativePath, spec } of yamlFiles) {
      const pathCheck = checkPathExists(spec, target);
      if (pathCheck.fullPathExists) {
        matchingFiles.push(relativePath);
      }
    }

    actionFileMap.set(i, {
      action,
      matchingFiles,
      explicitFile: action.file,
      explicitFiles: action.files
    });
  }

  return actionFileMap;
}

/**
 * Determine which files each action should apply to, generating warnings as needed
 */
function resolveActionTargets(actionFileMap) {
  const warnings = [];
  const actionTargets = new Map(); // actionIndex -> array of file paths to apply to

  for (const [actionIndex, info] of actionFileMap) {
    const { action, matchingFiles, explicitFile, explicitFiles } = info;
    const actionDesc = action.description || action.target;

    // Handle explicit file/files specification
    if (explicitFile || explicitFiles) {
      const specifiedFiles = explicitFiles || [explicitFile];
      // Validate specified files exist in matching files
      const validFiles = specifiedFiles.filter(f => matchingFiles.includes(f));
      const invalidFiles = specifiedFiles.filter(f => !matchingFiles.includes(f));

      if (invalidFiles.length > 0) {
        warnings.push(`Target ${action.target} does not exist in specified file(s): ${invalidFiles.join(', ')} (action: "${actionDesc}")`);
      }

      actionTargets.set(actionIndex, validFiles);
      continue;
    }

    // Auto-resolve based on matching files
    if (matchingFiles.length === 0) {
      warnings.push(`Target ${action.target} does not exist in any file (action: "${actionDesc}")`);
      actionTargets.set(actionIndex, []);
    } else if (matchingFiles.length === 1) {
      // Exactly one file - auto-apply
      actionTargets.set(actionIndex, matchingFiles);
    } else {
      // Multiple files - require explicit specification
      warnings.push(`Target ${action.target} exists in multiple files (${matchingFiles.join(', ')}). Specify 'file' or 'files' to disambiguate (action: "${actionDesc}")`);
      actionTargets.set(actionIndex, []);
    }
  }

  return { actionTargets, warnings };
}

/**
 * Apply overlay actions to files based on resolved targets
 */
function applyOverlayWithTargets(yamlFiles, overlay, actionTargets, overlayDir) {
  const results = new Map();

  // Initialize results with original specs
  for (const { relativePath, spec } of yamlFiles) {
    results.set(relativePath, JSON.parse(JSON.stringify(spec)));
  }

  if (!overlay.actions || !Array.isArray(overlay.actions)) {
    return results;
  }

  // Apply each action to its target files
  for (let i = 0; i < overlay.actions.length; i++) {
    const action = overlay.actions[i];
    const targetFiles = actionTargets.get(i) || [];

    for (const relativePath of targetFiles) {
      const spec = results.get(relativePath);
      if (!spec) continue;

      // Apply single action
      const singleOverlay = { actions: [action] };
      const { result } = applyOverlay(spec, singleOverlay, { overlayDir, silent: true });
      results.set(relativePath, result);

      // Log application
      if (action.description) {
        console.log(`  - Applied: ${action.description} → ${relativePath}`);
      }
    }
  }

  return results;
}

/**
 * Write resolved specs to target directory
 */
function writeResolvedSpecs(results, targetDir, baseDir) {
  for (const [relativePath, spec] of results) {
    const targetPath = join(targetDir, relativePath);
    const targetDirPath = dirname(targetPath);

    mkdirSync(targetDirPath, { recursive: true });

    const output = yaml.dump(spec, {
      lineWidth: -1,  // Don't wrap lines
      noRefs: true,   // Don't use aliases
      quotingType: '"',
      forceQuotes: false
    });
    writeFileSync(targetPath, output);
  }
}

/**
 * Main execution
 */
function main() {
  const state = getState();
  const availableStates = listAvailableStates();

  // Clean and recreate resolved directory
  if (existsSync(resolvedDir)) {
    rmSync(resolvedDir, { recursive: true });
  }
  mkdirSync(resolvedDir, { recursive: true });

  if (!state) {
    // No state specified - copy base specs as-is
    console.log('No STATE specified, using base specifications');
    console.log(`Available states: ${availableStates.join(', ') || '(none)'}`);
    console.log('');

    // Copy all files except overlays and resolved
    const files = readdirSync(openapiDir, { withFileTypes: true });
    for (const file of files) {
      if (file.name === 'overlays' || file.name === 'resolved') continue;

      const source = join(openapiDir, file.name);
      const target = join(resolvedDir, file.name);

      if (file.isDirectory()) {
        cpSync(source, target, { recursive: true });
      } else {
        cpSync(source, target);
      }
    }

    console.log(`Base specs copied to ${resolvedDir}`);
    return;
  }

  // Validate state exists
  if (!availableStates.includes(state)) {
    console.error(`Error: Unknown state '${state}'`);
    console.error(`Available states: ${availableStates.join(', ') || '(none)'}`);
    process.exit(1);
  }

  // Load overlay
  const stateOverlayDir = join(overlaysDir, state);
  const overlayPath = join(stateOverlayDir, 'modifications.yaml');
  console.log(`Applying overlay: ${state}`);
  console.log(`Overlay file: ${overlayPath}`);
  console.log('');

  const overlayContent = readFileSync(overlayPath, 'utf8');
  const overlay = yaml.load(overlayContent);

  console.log(`Overlay: ${overlay.info?.title || state}`);
  console.log(`Version: ${overlay.info?.version || 'unknown'}`);
  console.log('');

  // Two-pass processing
  // Pass 1: Collect all YAML files and analyze target locations
  const yamlFiles = collectYamlFiles(openapiDir);
  const actionFileMap = analyzeTargetLocations(overlay, yamlFiles);
  const { actionTargets, warnings } = resolveActionTargets(actionFileMap);

  // Pass 2: Apply overlay actions to resolved targets
  const results = applyOverlayWithTargets(yamlFiles, overlay, actionTargets, stateOverlayDir);

  // Write resolved specs
  writeResolvedSpecs(results, resolvedDir, openapiDir);

  // Display warnings if any
  if (warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of warnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }

  console.log('');
  console.log(`Resolved specs written to ${resolvedDir}`);
  console.log(`State: ${state}`);
}

main();
