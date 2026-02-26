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
 *   node scripts/resolve.js --spec=./openapi --out=./resolved
 *   node scripts/resolve.js --spec=./openapi --overlay=./overlays/california --out=./resolved
 *   node scripts/resolve.js --spec=./my-spec.yaml --overlay=./my-overlay.yaml --out=./resolved
 *
 * Flags:
 *   --spec       Path to base spec file or directory (required)
 *   --overlay    Path to overlay file or directory (optional; omit to copy base specs unchanged)
 *   --out        Output directory for resolved specs (required)
 *   --env        Target environment for x-environments filtering (optional)
 *   --env-file   Path to env file with key=value pairs for placeholder substitution (optional)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, cpSync, rmSync, realpathSync, statSync } from 'fs';
import { join, dirname, relative, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { applyOverlay, checkPathExists } from '../src/overlay/overlay-resolver.js';
import { bundleSpec } from '../src/bundle.js';
import { discoverStateMachines, extractItemEndpoint, generateOverlay } from './generate-rpc-overlay.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    spec: 'packages/contracts',
    overlay: null,
    out: 'packages/resolved',
    env: null,
    envFile: null,
    bundle: false,
    reconcileExamples: false,
    help: false
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--bundle') {
      options.bundle = true;
    } else if (arg.startsWith('--spec=')) {
      options.spec = arg.split('=')[1];
    } else if (arg.startsWith('--overlay=')) {
      options.overlay = arg.split('=')[1];
    } else if (arg.startsWith('--out=')) {
      options.out = arg.split('=')[1];
    } else if (arg.startsWith('--env=')) {
      options.env = arg.split('=')[1];
    } else if (arg.startsWith('--env-file=')) {
      options.envFile = arg.split('=')[1];
    } else if (arg === '--reconcile-examples') {
      options.reconcileExamples = true;
    } else {
      console.error(`Error: Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Resolve OpenAPI Specifications

Bundles, applies overlays, and resolves specs into self-contained output.

Usage:
  npm run resolve [-- <flags>]

Flags:
  --spec=<path>      Path to base spec file or directory (default: packages/contracts)
  --overlay=<path>   Path to overlay file or directory (optional)
  --out=<dir>        Output directory for resolved specs (default: packages/resolved)
  --bundle           Inline all external $refs to produce self-contained specs
  --env=<env>        Target environment for x-environments filtering (optional)
  --env-file=<file>  Path to env file for \${VAR} placeholder substitution (optional)
  --reconcile-examples  Reconcile examples against resolved schemas after output
  -h, --help         Show this help message

Without --overlay, base specs are copied to --out unchanged.
With --bundle, all external $ref references are dereferenced inline.
With --env, nodes whose x-environments array doesn't include the target env are removed.
With --env-file, \${VAR} placeholders in string values are substituted (process.env overrides file values).
With --reconcile-examples, example data is reconciled against the resolved schemas after output.

Examples:
  npm run resolve
  npm run resolve -- --bundle --out=/tmp/demo
  npm run resolve -- --overlay=packages/contracts/overlays/california --out=./resolved
  npm run resolve -- --spec=eligibility-openapi.yaml --overlay=my-overlay.yaml --out=./resolved
  npm run resolve -- --bundle --overlay=packages/contracts/overlays/california --out=./resolved
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
// Environment Filtering
// =============================================================================

/**
 * Recursively filter a spec tree by x-environments.
 * Removes nodes whose x-environments array doesn't include the target env.
 * Strips x-environments from surviving nodes.
 * Returns the filtered tree (or null if the root node itself should be removed).
 */
function filterByEnvironment(node, targetEnv) {
  if (node === null || node === undefined || typeof node !== 'object') {
    return node;
  }

  if (Array.isArray(node)) {
    return node
      .filter(item => {
        if (item && typeof item === 'object' && !Array.isArray(item) && item['x-environments']) {
          return item['x-environments'].includes(targetEnv);
        }
        return true;
      })
      .map(item => filterByEnvironment(item, targetEnv));
  }

  // Check if this node should be removed
  if (node['x-environments']) {
    if (!node['x-environments'].includes(targetEnv)) {
      return null;
    }
  }

  // Recurse into object properties
  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'x-environments') continue; // Strip from surviving nodes

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const filtered = filterByEnvironment(value, targetEnv);
      if (filtered !== null) {
        result[key] = filtered;
      }
    } else if (Array.isArray(value)) {
      result[key] = filterByEnvironment(value, targetEnv);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// =============================================================================
// Placeholder Substitution
// =============================================================================

/**
 * Parse an env file (key=value pairs, one per line).
 * Ignores blank lines and comments (lines starting with #).
 * Supports quoted values (single or double quotes are stripped).
 */
function parseEnvFile(filePath) {
  const vars = {};
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

/**
 * Recursively substitute ${VAR} placeholders in all string values.
 * Returns { result, warnings } where warnings lists unresolved variables.
 */
function substitutePlaceholders(node, vars, warnings = []) {
  if (typeof node === 'string') {
    const substituted = node.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      if (varName in vars) {
        return vars[varName];
      }
      if (!warnings.includes(varName)) {
        warnings.push(varName);
      }
      return match; // Leave unresolved placeholder as-is
    });
    return substituted;
  }

  if (node === null || node === undefined || typeof node !== 'object') {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map(item => substitutePlaceholders(item, vars, warnings));
  }

  const result = {};
  for (const [key, value] of Object.entries(node)) {
    result[key] = substitutePlaceholders(value, vars, warnings);
  }
  return result;
}

// =============================================================================
// RPC Overlay Auto-Generation
// =============================================================================

/**
 * Detect the $ref prefix used for external component references in a spec.
 * Walks the spec tree looking for $ref strings containing 'components/',
 * then extracts whatever precedes 'components/' (e.g., './' or '../../contracts/').
 * Returns './' as the default if no external component refs are found.
 */
function detectComponentPrefix(spec) {
  function findRefPrefix(node) {
    if (node === null || node === undefined || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findRefPrefix(item);
        if (found !== null) return found;
      }
      return null;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        // Match external file refs like ./components/ or ../../contracts/components/
        // Skip internal refs (#/components/...)
        const match = value.match(/^(?!#)(.*?)components\//);
        if (match) return match[1];
      }
      if (typeof value === 'object') {
        const found = findRefPrefix(value);
        if (found !== null) return found;
      }
    }
    return null;
  }

  return findRefPrefix(spec) || './';
}

/**
 * Rewrite $ref paths in an overlay, replacing one prefix with another.
 * Used to align generated overlay refs with the target spec's conventions.
 */
function rewriteOverlayRefs(overlay, fromPrefix, toPrefix) {
  if (fromPrefix === toPrefix) return overlay;

  function walk(node) {
    if (node === null || node === undefined || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);

    const result = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith(fromPrefix + 'components/')) {
        result[key] = toPrefix + value.substring(fromPrefix.length);
      } else {
        result[key] = (typeof value === 'object') ? walk(value) : value;
      }
    }
    return result;
  }

  return walk(overlay);
}

/**
 * Discover state machines and generate in-memory RPC overlays.
 * Returns an array of { overlay, stateMachine } ready for application.
 */
function generateRpcOverlays(specPath, yamlFiles) {
  const machines = discoverStateMachines(specPath);
  if (machines.length === 0) return [];

  const overlays = [];

  for (const { stateMachine } of machines) {
    const apiSpecFile = stateMachine.apiSpec;
    if (!apiSpecFile) continue;

    const endpointInfo = extractItemEndpoint(specPath, apiSpecFile);
    if (!endpointInfo) continue;

    let overlay = generateOverlay(stateMachine, endpointInfo);

    // Detect the component $ref prefix used by the target spec and rewrite if needed
    const targetFile = yamlFiles.find(f => f.relativePath === apiSpecFile);
    if (targetFile) {
      const prefix = detectComponentPrefix(targetFile.spec);
      overlay = rewriteOverlayRefs(overlay, './', prefix);
    }

    overlays.push({ overlay, stateMachine });
  }

  return overlays;
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
  const skip = new Set(['package.json', 'node_modules', 'overlays']);
  const files = readdirSync(baseDir, { withFileTypes: true });
  for (const file of files) {
    if (skip.has(file.name)) continue;

    const source = join(baseDir, file.name);
    const target = join(outDir, file.name);

    // Skip the output directory itself (when outDir is inside baseDir)
    if (resolve(source) === resolve(outDir)) continue;

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

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const specPath = resolve(options.spec);
  const outDir = resolve(options.out);

  if (!existsSync(specPath)) {
    console.error(`Error: Spec path does not exist: ${specPath}`);
    process.exit(1);
  }

  const specIsFile = statSync(specPath).isFile();

  // Clean and recreate output directory
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true });
  }
  mkdirSync(outDir, { recursive: true });

  // Discover state machines for RPC auto-generation (directory mode only)
  const stateMachines = !specIsFile ? discoverStateMachines(specPath) : [];

  if (!options.overlay && !options.env && !options.envFile && !options.bundle && !options.reconcileExamples && stateMachines.length === 0) {
    // No processing needed - copy base specs as-is
    console.log('No flags specified, copying base specs unchanged');
    if (specIsFile) {
      cpSync(specPath, join(outDir, basename(specPath)));
    } else {
      copyBaseSpecs(specPath, outDir);
    }
    console.log(`Base specs copied to ${outDir}`);
    return;
  }

  console.log(`Spec:   ${specPath}`);
  console.log(`Output: ${outDir}`);

  // Collect base YAML files
  let yamlFiles;
  if (specIsFile) {
    const content = readFileSync(specPath, 'utf8');
    const spec = yaml.load(content);
    yamlFiles = [{ relativePath: basename(specPath), sourcePath: specPath, spec }];
  } else {
    yamlFiles = collectYamlFiles(specPath);
  }

  let allWarnings = [];
  let currentResults = null;

  // Auto-generate and apply RPC overlays from state machine files (before explicit overlays)
  if (stateMachines.length > 0) {
    const rpcOverlays = generateRpcOverlays(specPath, yamlFiles);

    for (const { overlay, stateMachine } of rpcOverlays) {
      const inputFiles = currentResults
        ? [...currentResults.entries()].map(([relativePath, spec]) => ({ relativePath, spec }))
        : yamlFiles;

      const actionFileMap = analyzeTargetLocations(overlay, inputFiles);
      const { actionTargets, warnings } = resolveActionTargets(actionFileMap);
      allWarnings = allWarnings.concat(warnings);

      currentResults = applyOverlayWithTargets(inputFiles, overlay, actionTargets, specPath);

      const transitionCount = stateMachine.transitions?.length || 0;
      console.log(`  \u2713 Auto-generated: ${stateMachine.domain} RPC Overlay (${transitionCount} transitions)`);
    }
  }

  // Apply overlays if specified
  if (options.overlay) {
    const overlayInput = resolve(options.overlay);

    if (!existsSync(overlayInput)) {
      console.error(`Error: Overlay path does not exist: ${overlayInput}`);
      process.exit(1);
    }

    const overlayIsFile = statSync(overlayInput).isFile();
    const overlayFiles = overlayIsFile ? [overlayInput] : discoverOverlayFiles(overlayInput);
    const overlayDir = overlayIsFile ? dirname(overlayInput) : overlayInput;

    if (overlayFiles.length === 0) {
      console.log('No overlay files found');
    } else {
      console.log(`Overlay: ${overlayInput}`);
      console.log('');

      for (const overlayPath of overlayFiles) {
        const overlayContent = readFileSync(overlayPath, 'utf8');
        const overlay = yaml.load(overlayContent);

        console.log(`Overlay: ${overlay.info?.title || relative(overlayDir, overlayPath)}`);
        if (overlay.info?.version) {
          console.log(`Version: ${overlay.info.version}`);
        }
        console.log('');

        const inputFiles = currentResults
          ? [...currentResults.entries()].map(([relativePath, spec]) => ({ relativePath, spec }))
          : yamlFiles;

        const actionFileMap = analyzeTargetLocations(overlay, inputFiles);
        const { actionTargets, warnings } = resolveActionTargets(actionFileMap);
        allWarnings = allWarnings.concat(warnings);

        currentResults = applyOverlayWithTargets(inputFiles, overlay, actionTargets, overlayDir);
      }
    }
  }

  // Build final results map (from overlays or original files)
  if (!currentResults) {
    currentResults = new Map();
    for (const { relativePath, spec } of yamlFiles) {
      currentResults.set(relativePath, JSON.parse(JSON.stringify(spec)));
    }
  }

  // Filter by environment if --env specified
  if (options.env) {
    console.log(`Environment: ${options.env}`);
    for (const [relativePath, spec] of currentResults) {
      currentResults.set(relativePath, filterByEnvironment(spec, options.env));
    }
  }

  // Substitute placeholders if --env-file specified or process.env has values
  if (options.envFile) {
    const envFilePath = resolve(options.envFile);
    if (!existsSync(envFilePath)) {
      console.error(`Error: Env file does not exist: ${envFilePath}`);
      process.exit(1);
    }

    const fileVars = parseEnvFile(envFilePath);
    // process.env overrides file values
    const vars = { ...fileVars, ...process.env };

    console.log(`Env file:   ${envFilePath}`);

    const placeholderWarnings = [];
    for (const [relativePath, spec] of currentResults) {
      currentResults.set(relativePath, substitutePlaceholders(spec, vars, placeholderWarnings));
    }

    if (placeholderWarnings.length > 0) {
      for (const varName of placeholderWarnings) {
        allWarnings.push(`Unresolved placeholder: \${${varName}}`);
      }
    }
  }

  // Remove overlay files from output (they've been applied)
  for (const [relativePath] of currentResults) {
    if (relativePath.startsWith('overlays/') || relativePath.startsWith('overlays\\')) {
      currentResults.delete(relativePath);
    }
  }

  // Write resolved specs
  writeResolvedSpecs(currentResults, outDir);

  // Bundle: dereference all external $refs to produce self-contained specs
  // Done after overlays so that $ref targets reflect overlay changes
  if (options.bundle) {
    console.log('\nBundling: inlining external $refs...');
    for (const [relativePath] of currentResults) {
      if (!relativePath.endsWith('-openapi.yaml')) continue;
      const filePath = join(outDir, relativePath);
      const dereferenced = await bundleSpec(filePath);
      const output = yaml.dump(dereferenced, {
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false
      });
      writeFileSync(filePath, output);
      console.log(`  ✓ ${relativePath}`);
    }

    // Remove shared component files (they've been inlined)
    for (const [relativePath] of currentResults) {
      if (!relativePath.endsWith('-openapi.yaml') && !relativePath.endsWith('-openapi-examples.yaml')) {
        const filePath = join(outDir, relativePath);
        if (existsSync(filePath)) {
          rmSync(filePath, { recursive: true });
        }
      }
    }
    // Remove empty component directories
    const outEntries = readdirSync(outDir, { withFileTypes: true });
    for (const entry of outEntries) {
      if (entry.isDirectory()) {
        const dirPath = join(outDir, entry.name);
        const contents = readdirSync(dirPath);
        if (contents.length === 0) {
          rmSync(dirPath, { recursive: true });
        }
      }
    }
  }

  // Reconcile examples against resolved schemas
  if (options.reconcileExamples) {
    console.log('\nReconciling examples against resolved schemas...');
    const { reconcileAllExamples } = await import('./reconcile-examples.js');
    await reconcileAllExamples({ specsDir: outDir });
  }

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
  getVersionFromFilename,
  filterByEnvironment,
  parseEnvFile,
  substitutePlaceholders,
  applyOverlayWithTargets,
  detectComponentPrefix,
  rewriteOverlayRefs,
  generateRpcOverlays
};

// Run main when executed directly
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
if (isDirectRun) {
  main();
}
