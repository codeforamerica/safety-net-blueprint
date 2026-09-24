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
 *   --env-target     Environment to filter x-environments down to (optional)
 *   --env-variables  Path to a file of key=value pairs for ${VAR} substitution (optional)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, cpSync, rmSync, realpathSync, statSync } from 'fs';
import { join, dirname, relative, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { bundleSpec } from './lib/bundle.js';
import {
  baseContractsDir,
  discover,
  load,
  generate,
  resolve as coreResolve,
  validate,
} from '@codeforamerica/blueprint-core';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    spec: null,
    overlay: null,
    out: null,
    envTarget: null,
    envVariables: null,
    bundle: false,
    reconcileExamples: false,
    resolve: false,
    verbose: false,
    help: false
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--bundle') {
      options.bundle = true;
    } else if (arg === '--resolve') {
      options.resolve = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg.startsWith('--spec=')) {
      options.spec = arg.split('=')[1];
    } else if (arg.startsWith('--overlay=')) {
      options.overlay = arg.split('=')[1];
    } else if (arg.startsWith('--out=')) {
      options.out = arg.split('=')[1];
    } else if (arg.startsWith('--env-target=')) {
      options.envTarget = arg.split('=')[1];
    } else if (arg.startsWith('--env-variables=')) {
      options.envVariables = arg.split('=')[1];
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
  --out=<dir>        Output directory for resolved specs (default: resolved)
  --bundle           Inline all external $refs to produce self-contained specs
  --resolve          Run relationship resolution even without an overlay
  --env-target=<env>      Environment to filter x-environments down to (optional)
  --env-variables=<file>  File of key=value pairs for \${VAR} substitution (optional)
  --verbose          Print a per-schema relationship-resolution summary
  -h, --help         Show this help message

Without --overlay, base specs are copied to --out unchanged (unless --resolve is specified).
With --bundle, all external $ref references are dereferenced inline.
With --env-target, nodes whose x-environments array doesn't include it are removed.
With --env-variables, \${VAR} placeholders are substituted (process.env overrides file values).

Examples:
  npm run resolve
  npm run resolve -- --bundle --out=/tmp/demo
  npm run resolve -- --overlay=packages/contracts/overlays/california --out=./resolved
  npm run resolve -- --spec=eligibility-openapi.yaml --overlay=my-overlay.yaml --out=./resolved
  npm run resolve -- --bundle --overlay=packages/contracts/overlays/california --out=./resolved
`);
}

// =============================================================================
// Event Type Prefix Injection
// =============================================================================

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
      if (file.name === 'node_modules') continue;
      yamlFiles = yamlFiles.concat(collectYamlFiles(sourcePath, baseDir));
    } else if (file.name.endsWith('.yaml')) {
      const relativePath = relative(baseDir, sourcePath);
      const content = readFileSync(sourcePath, 'utf8');
      const spec = yaml.load(content, { schema: yaml.CORE_SCHEMA });
      if (spec?.info?.['x-status'] === 'deprecated') continue;
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
          const parsed = yaml.load(content, { schema: yaml.CORE_SCHEMA });
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

// =============================================================================
// File Type Predicates
// =============================================================================
//
// Asset type is identified from the spec content itself — $schema field for
// blueprint YAML files, openapi/asyncapi fields for API specs — rather than
// from filename patterns. This is more robust: the content explicitly declares
// its type, independent of the naming convention used by a given deployment.
//
// Filename-based checks remain only where no parsed spec is available (e.g.,
// the pre-parse quick check at startup to decide whether generators will run).

// =============================================================================
// Environment Filtering
// =============================================================================

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

// =============================================================================
// Canonical URI rewriting
// =============================================================================

const BLUEPRINT_BASE_URI = 'https://blueprint.codeforamerica.org/base/';

/**
 * Rewrite blueprint canonical URI refs in a spec to real relative paths for the output file.
 *
 * https://blueprint.codeforamerica.org/base/schemas/enums.yaml#/$defs/RoleType becomes
 * a path relative from the spec's output location to {outDir}/base/schemas/enums.yaml.
 *
 * @param {object} spec - The spec object to rewrite
 * @param {string} specRelativePath - The relative output path of this spec file
 */
function rewriteBaseRefs(spec, specRelativePath) {
  function walk(node) {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);
    const result = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith(BLUEPRINT_BASE_URI)) {
        const rest = value.slice(BLUEPRINT_BASE_URI.length);
        const [filePart, fragment] = rest.split('#');
        const targetRelPath = `base/${filePart}`.replace(/\\/g, '/');
        const specDir = dirname(specRelativePath);
        const rel = relative(specDir || '.', targetRelPath).replace(/\\/g, '/');
        result[key] = fragment ? `${rel}#${fragment}` : rel;
      } else {
        result[key] = typeof value === 'object' ? walk(value) : value;
      }
    }
    return result;
  }
  return walk(spec);
}


// =============================================================================
// x-enum-source Injection
// =============================================================================

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
  const skipByName = new Set(['package.json', 'node_modules', 'overlays']);
  const files = readdirSync(baseDir, { withFileTypes: true });
  for (const file of files) {
    if (skipByName.has(file.name)) continue;

    const source = join(baseDir, file.name);
    const target = join(outDir, file.name);

    // Skip the output directory itself (when outDir is inside baseDir)
    if (resolve(source) === resolve(outDir)) continue;

    if (file.isDirectory()) {
      copyBaseSpecs(source, target);
    } else if (file.name.endsWith('.yaml')) {
      mkdirSync(dirname(target), { recursive: true });
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

  if (!options.spec) { console.error('Error: --spec is required'); process.exit(1); }
  if (!options.out) { console.error('Error: --out is required'); process.exit(1); }

  const specPath = resolve(options.spec);
  const outDir = resolve(options.out);

  if (!existsSync(specPath)) {
    console.error(`Error: Spec path does not exist: ${specPath}`);
    process.exit(1);
  }

  const specIsFile = statSync(specPath).isFile();

  // Clean and recreate output directory (skip when resolving in place)
  if (resolve(specPath) !== resolve(outDir)) {
    if (existsSync(outDir)) {
      rmSync(outDir, { recursive: true });
    }
  }
  mkdirSync(outDir, { recursive: true });

  // Quick check (no YAML parsing) whether generators will produce anything
  const hasStateMachines = !specIsFile && readdirSync(specPath, { recursive: true }).filter(f => typeof f === 'string').some(f => f.endsWith('-state-machine.yaml'));
  const hasCompositions = !specIsFile && readdirSync(specPath, { recursive: true }).filter(f => typeof f === 'string').some(f => f.endsWith('-compositions.yaml'));
  const hasRules = !specIsFile && readdirSync(specPath, { recursive: true }).filter(f => typeof f === 'string').some(f => f.endsWith('-rules.yaml'));

  if (!options.overlay && !options.envTarget && !options.envVariables && !options.bundle && !options.reconcileExamples && !options.resolve && !hasStateMachines && !hasCompositions && !hasRules) {
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

  // Load the contract set. Deprecated specs are kept for consumers still on
  // them but are not resolved — discover reports every file and leaving them
  // out is the caller's decision, not core's.

  let docs;
  if (specIsFile) {
    docs = [load({ path: specPath, relativePath: basename(specPath) })];
  } else {
    docs = discover(specPath)
      .map(load)

  }

  // Always include blueprint-core base contracts in the output
  if (!existsSync(baseContractsDir)) {
    console.error(`Error: blueprint-core base-contracts directory not found: ${baseContractsDir}`);
    console.error('This usually means blueprint-core was installed from an incomplete tarball. Re-install @codeforamerica/blueprint-core.');
    process.exit(1);
  }

  const baseDocs = discover(baseContractsDir)
    .map((file) => load({ ...file, relativePath: `base/${file.relativePath}` }))

  docs.push(...baseDocs);
  console.log(`Base contracts: ${baseContractsDir} (${baseDocs.length} file(s))`);

  let allWarnings = [];

  // Everything from here to the write is the core pipeline. The CLI's job is
  // to find the inputs, decide the output location, and report — not to
  // reimplement contract transformation.
  const authoredOverlays = [];

  if (options.overlay) {
    const overlayInput = resolve(options.overlay);

    if (!existsSync(overlayInput)) {
      console.error(`Error: Overlay path does not exist: ${overlayInput}`);
      process.exit(1);
    }

    const overlayIsFile = statSync(overlayInput).isFile();
    const overlayFiles = overlayIsFile ? [overlayInput] : discoverOverlayFiles(overlayInput);

    for (const file of overlayFiles) {
      const doc = load({ path: file, relativePath: relative(overlayIsFile ? dirname(overlayInput) : overlayInput, file) });
      if (Array.isArray(doc.content?.actions)) authoredOverlays.push(doc.content);
    }

    console.log(`Overlay: ${overlayInput} (${authoredOverlays.length} document(s))`);
  }

  const generatedOverlays = generate(docs, 'overlay');
  const graphs = generate(docs, 'graph');

  const resolved = coreResolve(docs, {
    overlays: [...authoredOverlays, ...generatedOverlays],
    envTarget: options.envTarget,
    envVariables: options.envVariables ? readEnvVariables(options.envVariables) : {},
  });

  allWarnings = allWarnings.concat(resolved.warnings);
  if (options.verbose) resolved.applied.forEach((line) => console.log(`  ${line}`));

  // Whether to write and whether to succeed are separate decisions.
  //
  // Schema conformance is a precondition: it can only be checked here, after
  // overlays and while canonical URIs still resolve, and every transform below
  // is meaningless on documents that fail it. So it blocks the write.
  //
  // Every other check describes the output rather than the input, and works
  // just as well on the written files — that is what `npm run validate` does.
  // Blocking on those would make resolve unusable on a contract set that is
  // mid-edit, and would hide the very artifacts you need to see to understand
  // why they are wrong. They are written, reported, and the command still
  // exits non-zero so CI cannot mistake them for good.
  const validation = validate(resolved.docs);
  console.log('');
  console.log(validation.report);

  const errors = validation.results.flatMap((result) => result.errors);
  const conformance = errors.filter((error) => error.rule === 'schema-conformance');

  if (conformance.length > 0) {
    console.error('\nSchema validation failed. Fix the errors above before resolving.');
    process.exit(1);
  }

  let currentResults = new Map(resolved.docs.map((doc) => [doc.relativePath, doc.content]));

  // Compiled rules graphs are written alongside the contracts they came from.
  // They join the write map rather than the document set: they are generated
  // output, not contracts being resolved and validated.
  for (const { path: graphPath, graph } of graphs) {
    currentResults.set(graphPath, graph);
  }

  // Remove overlay files from output (they've been applied)
  for (const [relativePath] of currentResults) {
    if (relativePath.startsWith('overlays/') || relativePath.startsWith('overlays\\')) {
      currentResults.delete(relativePath);
    }
  }

  // Rewrite canonical blueprint URIs to real relative paths before writing
  for (const [relativePath, spec] of currentResults) {
    currentResults.set(relativePath, rewriteBaseRefs(spec, relativePath));
  }

  // Write resolved specs
  writeResolvedSpecs(currentResults, outDir);

  // Bundle: dereference all external $refs to produce self-contained specs
  // Done after overlays so that $ref targets reflect overlay changes
  if (options.bundle) {
    console.log('\nBundling: inlining external $refs...');
    for (const [relativePath, spec] of currentResults) {
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

    // Remove base/ component files — these were added solely as $ref targets
    // and are now inlined into every spec that referenced them.
    for (const [relativePath] of currentResults) {
      if (relativePath.startsWith('base/') || relativePath.startsWith('base\\')) {
        const filePath = join(outDir, relativePath);
        if (existsSync(filePath)) {
          rmSync(filePath, { recursive: true });
        }
      }
    }
    // Remove empty directories left behind after file cleanup (walk bottom-up).
    const removeEmptyDirs = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) removeEmptyDirs(join(dir, entry.name));
      }
      if (readdirSync(dir).length === 0 && dir !== outDir) {
        rmSync(dir, { recursive: true });
      }
    };
    removeEmptyDirs(outDir);
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

  // The artifacts are on disk either way; the exit code is what tells CI
  // whether they are trustworthy.
  if (errors.length > 0) {
    console.error(`\n${errors.length} validation error(s) — see the report above.`);
    process.exit(1);
  }
}

// Exported for testing. Only what remains the CLI's own concern: finding
// files, reading an env file, and rewriting canonical URIs to relative paths
// at write time. Everything else moved to blueprint-core and is tested there.
export {
  discoverOverlayFiles,
  parseEnvFile,
  rewriteBaseRefs,
};

// Run main when executed directly
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
if (isDirectRun) {
  main();
}

/**
 * Read `${VAR}` values from an env file, with process.env taking precedence.
 *
 * @param {string} path
 * @returns {Record<string, string>}
 */
function readEnvVariables(path) {
  const envFilePath = resolve(path);
  if (!existsSync(envFilePath)) {
    console.error(`Error: Env file does not exist: ${envFilePath}`);
    process.exit(1);
  }
  console.log(`Env file:   ${envFilePath}`);
  return { ...parseEnvFile(envFilePath), ...process.env };
}
