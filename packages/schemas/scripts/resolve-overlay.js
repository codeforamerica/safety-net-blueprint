#!/usr/bin/env node
/**
 * Resolve OpenAPI overlays for state-specific configurations.
 *
 * This script applies OpenAPI Overlay Specification (1.0.0) transformations
 * to base schemas, producing resolved specifications.
 *
 * Two-pass processing:
 *   1. Scan all files to determine where each target path exists
 *   2. Apply actions with smart file scoping:
 *      - Target in 0 files → warning
 *      - Target in 1 file → auto-apply to that file
 *      - Target in 2+ files → require file/files property
 *
 * Usage:
 *   node scripts/resolve-overlay.js --base=./openapi --out=./resolved
 *   node scripts/resolve-overlay.js --base=./openapi --overlays=./overlays/california --out=./resolved
 *
 * Flags:
 *   --base       Path to base specs directory (required)
 *   --overlays   Path to overlay directory (optional; omit to copy base specs unchanged)
 *   --out        Output directory for resolved specs (required)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, cpSync, rmSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { applyOverlay, checkPathExists } from '../src/overlay/overlay-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    base: null,
    overlays: null,
    out: null,
    help: false
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--base=')) {
      options.base = arg.split('=')[1];
    } else if (arg.startsWith('--overlays=')) {
      options.overlays = arg.split('=')[1];
    } else if (arg.startsWith('--out=')) {
      options.out = arg.split('=')[1];
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Resolve OpenAPI Overlays

Applies overlay transformations to base specs, producing resolved output.

Usage:
  node scripts/resolve-overlay.js --base=<dir> --out=<dir> [--overlays=<dir>]

Flags:
  --base=<dir>       Path to base specs directory (required)
  --overlays=<dir>   Path to overlay directory (optional)
  --out=<dir>        Output directory for resolved specs (required)
  -h, --help         Show this help message

Without --overlays, base specs are copied to --out unchanged.

Examples:
  node scripts/resolve-overlay.js --base=./openapi --out=./resolved
  node scripts/resolve-overlay.js --base=./openapi --overlays=./overlays/california --out=./resolved
`);
}

// =============================================================================
// File Collection
// =============================================================================

/**
 * Recursively collect all YAML files with their relative paths and contents
 */
function collectYamlFiles(sourceDir, baseDir = sourceDir) {
  const files = readdirSync(sourceDir, { withFileTypes: true });
  let yamlFiles = [];

  for (const file of files) {
    const sourcePath = join(sourceDir, file.name);

    if (file.isDirectory()) {
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
 * Recursively discover all overlay YAML files in the overlays directory.
 * Each file must have `overlay: 1.0.0` at the top level to be recognized.
 */
function discoverOverlayFiles(overlaysDir) {
  if (!existsSync(overlaysDir)) {
    return [];
  }

  const overlayFiles = [];

  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.yaml')) {
        try {
          const content = readFileSync(fullPath, 'utf8');
          const parsed = yaml.load(content);
          if (parsed && parsed.overlay === '1.0.0') {
            overlayFiles.push(fullPath);
          }
        } catch {
          // Skip files that can't be parsed
        }
      }
    }
  }

  walk(overlaysDir);
  return overlayFiles.sort();
}

// =============================================================================
// Overlay Resolution
// =============================================================================

/**
 * Extract version number from a spec filename.
 * No suffix = version 1, -v2 suffix = version 2, etc.
 */
function getVersionFromFilename(relativePath) {
  const basename = relativePath.replace(/\.yaml$/, '').split('/').pop();
  const match = basename.match(/-v(\d+)$/);
  return match ? parseInt(match[1], 10) : 1;
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

    // Find all files where the full target path exists, with metadata
    const matchingFiles = [];
    for (const { relativePath, spec } of yamlFiles) {
      const pathCheck = checkPathExists(spec, target);
      if (pathCheck.fullPathExists) {
        matchingFiles.push({
          relativePath,
          apiId: spec.info?.['x-api-id'] || null,
          version: getVersionFromFilename(relativePath)
        });
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
 * Determine which files each action should apply to, generating warnings as needed.
 * Supports disambiguation via:
 *   - file/files: explicit file paths
 *   - target-api: match spec's info.x-api-id
 *   - target-version: match filename version suffix (no suffix = 1, -v2 = 2)
 */
function resolveActionTargets(actionFileMap) {
  const warnings = [];
  const actionTargets = new Map();

  for (const [actionIndex, info] of actionFileMap) {
    const { action, matchingFiles, explicitFile, explicitFiles } = info;
    const actionDesc = action.description || action.target;
    const targetApi = action['target-api'];
    const targetVersion = action['target-version'];

    // Handle explicit file/files specification
    if (explicitFile || explicitFiles) {
      const specifiedFiles = explicitFiles || [explicitFile];
      const matchPaths = matchingFiles.map(m => m.relativePath);
      const validFiles = specifiedFiles.filter(f => matchPaths.includes(f));
      const invalidFiles = specifiedFiles.filter(f => !matchPaths.includes(f));

      if (invalidFiles.length > 0) {
        warnings.push(`Target ${action.target} does not exist in specified file(s): ${invalidFiles.join(', ')} (action: "${actionDesc}")`);
      }

      actionTargets.set(actionIndex, validFiles);
      continue;
    }

    // Apply target-api and target-version filters
    let filtered = matchingFiles;

    if (targetApi) {
      filtered = filtered.filter(m => m.apiId === targetApi);
    }

    if (targetVersion !== undefined && targetVersion !== null) {
      const ver = parseInt(targetVersion, 10);
      filtered = filtered.filter(m => m.version === ver);
    }

    const filteredPaths = filtered.map(m => m.relativePath);

    // Auto-resolve based on filtered matches
    if (filteredPaths.length === 0) {
      if (matchingFiles.length === 0) {
        warnings.push(`Target ${action.target} does not exist in any file (action: "${actionDesc}")`);
      } else {
        warnings.push(`Target ${action.target} matched ${matchingFiles.length} file(s) but none passed target-api/target-version filters (action: "${actionDesc}")`);
      }
      actionTargets.set(actionIndex, []);
    } else if (filteredPaths.length === 1) {
      actionTargets.set(actionIndex, filteredPaths);
    } else {
      warnings.push(`Target ${action.target} exists in multiple files (${filteredPaths.join(', ')}). Use file, target-api, or target-version to disambiguate (action: "${actionDesc}")`);
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

      const singleOverlay = { actions: [action] };
      const { result } = applyOverlay(spec, singleOverlay, { overlayDir, silent: true });
      results.set(relativePath, result);

      if (action.description) {
        console.log(`  - Applied: ${action.description} -> ${relativePath}`);
      }
    }
  }

  return results;
}

// =============================================================================
// Output
// =============================================================================

/**
 * Write resolved specs to target directory
 */
function writeResolvedSpecs(results, targetDir) {
  for (const [relativePath, spec] of results) {
    const targetPath = join(targetDir, relativePath);
    const targetDirPath = dirname(targetPath);

    mkdirSync(targetDirPath, { recursive: true });

    const output = yaml.dump(spec, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false
    });
    writeFileSync(targetPath, output);
  }
}

/**
 * Copy base specs to output directory unchanged
 */
function copyBaseSpecs(baseDir, outDir) {
  const files = readdirSync(baseDir, { withFileTypes: true });
  for (const file of files) {
    const source = join(baseDir, file.name);
    const target = join(outDir, file.name);

    if (file.isDirectory()) {
      cpSync(source, target, { recursive: true });
    } else {
      cpSync(source, target);
    }
  }
}

// =============================================================================
// Main
// =============================================================================

function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (!options.base || !options.out) {
    console.error('Error: --base and --out are required.\n');
    showHelp();
    process.exit(1);
  }

  const baseDir = resolve(options.base);
  const outDir = resolve(options.out);

  if (!existsSync(baseDir)) {
    console.error(`Error: Base directory does not exist: ${baseDir}`);
    process.exit(1);
  }

  // Clean and recreate output directory
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true });
  }
  mkdirSync(outDir, { recursive: true });

  if (!options.overlays) {
    // No overlays - copy base specs as-is
    console.log('No --overlays specified, copying base specs unchanged');
    copyBaseSpecs(baseDir, outDir);
    console.log(`Base specs copied to ${outDir}`);
    return;
  }

  const overlaysDir = resolve(options.overlays);

  if (!existsSync(overlaysDir)) {
    console.error(`Error: Overlays directory does not exist: ${overlaysDir}`);
    process.exit(1);
  }

  // Discover overlay files
  const overlayFiles = discoverOverlayFiles(overlaysDir);
  if (overlayFiles.length === 0) {
    console.log('No overlay files found, copying base specs unchanged');
    copyBaseSpecs(baseDir, outDir);
    console.log(`Base specs copied to ${outDir}`);
    return;
  }

  console.log(`Base specs: ${baseDir}`);
  console.log(`Overlays:   ${overlaysDir}`);
  console.log(`Output:     ${outDir}`);
  console.log('');

  // Collect base YAML files
  const yamlFiles = collectYamlFiles(baseDir);

  // Apply each overlay file
  let allWarnings = [];
  let currentResults = null;

  for (const overlayPath of overlayFiles) {
    const overlayContent = readFileSync(overlayPath, 'utf8');
    const overlay = yaml.load(overlayContent);

    console.log(`Overlay: ${overlay.info?.title || relative(overlaysDir, overlayPath)}`);
    if (overlay.info?.version) {
      console.log(`Version: ${overlay.info.version}`);
    }
    console.log('');

    // Use current results as input (for chaining multiple overlays)
    const inputFiles = currentResults
      ? [...currentResults.entries()].map(([relativePath, spec]) => ({ relativePath, spec }))
      : yamlFiles;

    const actionFileMap = analyzeTargetLocations(overlay, inputFiles);
    const { actionTargets, warnings } = resolveActionTargets(actionFileMap);
    allWarnings = allWarnings.concat(warnings);

    currentResults = applyOverlayWithTargets(inputFiles, overlay, actionTargets, overlaysDir);
  }

  // Write resolved specs
  writeResolvedSpecs(currentResults, outDir);

  // Display warnings if any
  if (allWarnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of allWarnings) {
      console.log(`  ! ${warning}`);
    }
  }

  console.log('');
  console.log(`Resolved specs written to ${outDir}`);
}

// Export for testing
export {
  discoverOverlayFiles,
  analyzeTargetLocations,
  resolveActionTargets,
  getVersionFromFilename
};

// Run main when executed directly
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main();
}
