#!/usr/bin/env node
/**
 * API Update Tool
 *
 * Adds a new entity (paths, schemas, parameters, tag, examples) to an
 * existing OpenAPI spec.
 *
 * Usage:
 *   npm run api:update -- --name workflow --resource Queue
 *   npm run api:update -- workflow Queue
 *
 * The spec file must already exist (use api:new to create a new one).
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync, realpathSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { bundleSpec } from '../src/bundle.js';
import {
  parseArgs,
  toKebabCase,
  toPascalCase,
  generateApiSpec,
  generateExamples
} from './generate-api.js';

// =============================================================================
// Help
// =============================================================================

function showHelp() {
  console.log(`
API Update Tool

Adds a new entity (paths, schemas, parameters, tag) to an existing OpenAPI spec.

Usage:
  npm run api:update -- --name <api-name> --resource <ResourceName>
  npm run api:update -- <api-name> <ResourceName>

Options:
  -n, --name <name>        API name in kebab-case (e.g., "workflow", "scheduling")
  -r, --resource <name>    Resource name in PascalCase (e.g., "Queue", "Schedule")
  -o, --out <dir>          Directory containing the spec (default: packages/contracts/)
      --bundle             Inline all external $refs to produce a self-contained spec
  -h, --help               Show this help message

Examples:
  npm run api:update -- --name workflow --resource Queue
  npm run api:update -- workflow Queue
  npm run api:update -- --name scheduling --resource Schedule --out /tmp
`);
}

// =============================================================================
// URL prefix detection
// =============================================================================

/**
 * Detect a URL prefix from existing paths.
 *
 * If paths look like "/workflow/tasks", the prefix is "/workflow".
 * If paths look like "/tasks", the prefix is "".
 */
function detectUrlPrefix(existingPaths) {
  const pathKeys = Object.keys(existingPaths);
  if (pathKeys.length === 0) return '';

  // Find the shortest path (collection endpoint, e.g., "/workflow/tasks")
  const shortest = pathKeys.reduce((a, b) =>
    a.split('/').length <= b.split('/').length ? a : b
  );

  const segments = shortest.split('/').filter(Boolean);
  if (segments.length > 1) {
    // Has prefix: everything except the last segment
    return '/' + segments.slice(0, -1).join('/');
  }
  return '';
}

// =============================================================================
// Merge logic
// =============================================================================

/**
 * Merge a new resource into an existing parsed OpenAPI spec.
 *
 * Generates a full spec template for the resource, parses it, and extracts
 * paths/schemas/parameters/tag to merge into the existing spec.
 */
function mergeResource(existingSpec, name, resource) {
  const kebabName = toKebabCase(name);

  // Check resource doesn't already exist
  if (existingSpec.components?.schemas?.[resource]) {
    throw new Error(
      `Resource "${resource}" already exists in the spec (found in components.schemas).`
    );
  }

  // Generate a full spec for the new resource and parse it
  const generatedYaml = generateApiSpec(kebabName, resource);
  const generatedSpec = yaml.load(generatedYaml);

  // Detect URL prefix from existing paths
  const prefix = detectUrlPrefix(existingSpec.paths || {});

  // Merge tag
  if (!existingSpec.tags) existingSpec.tags = [];
  existingSpec.tags.push(generatedSpec.tags[0]);

  // Merge paths with prefix rewriting
  if (!existingSpec.paths) existingSpec.paths = {};
  for (const [path, pathItem] of Object.entries(generatedSpec.paths)) {
    const prefixedPath = prefix + path;
    existingSpec.paths[prefixedPath] = pathItem;
  }

  // Merge parameters
  if (!existingSpec.components) existingSpec.components = {};
  if (!existingSpec.components.parameters)
    existingSpec.components.parameters = {};
  Object.assign(
    existingSpec.components.parameters,
    generatedSpec.components.parameters
  );

  // Merge schemas
  if (!existingSpec.components.schemas) existingSpec.components.schemas = {};
  Object.assign(
    existingSpec.components.schemas,
    generatedSpec.components.schemas
  );

  return existingSpec;
}

// =============================================================================
// Examples append
// =============================================================================

/**
 * Append new examples to existing examples content, stripping the header
 * comment lines from the new examples text.
 */
function appendExamples(existingContent, newExamplesText) {
  const dataOnly = newExamplesText
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim();
  return existingContent.trimEnd() + '\n\n' + dataOnly + '\n';
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

  if (!options.name || !options.resource) {
    console.error('Error: Both --name and --resource are required.\n');
    showHelp();
    process.exit(1);
  }

  const name = toKebabCase(options.name);
  const resource = toPascalCase(options.resource);

  // Output to --out dir, or packages/contracts/ by default
  const contractsDir = resolve(import.meta.dirname, '..');
  const outDir = options.out || contractsDir;
  const specFile = `${name}-openapi.yaml`;
  const examplesFile = `${name}-openapi-examples.yaml`;
  const specPath = join(outDir, specFile);
  const examplesPath = join(outDir, examplesFile);

  // Spec file must exist
  if (!existsSync(specPath)) {
    console.error(
      `Error: ${specPath} not found. Use api:new to create a new spec.`
    );
    process.exit(1);
  }

  console.log(`\nUpdating API: ${name}`);
  console.log(`Adding resource: ${resource}\n`);

  // Parse existing spec
  const existingContent = await readFile(specPath, 'utf8');
  const existingSpec = yaml.load(existingContent);

  // Merge new resource
  mergeResource(existingSpec, name, resource);

  // Write updated spec
  const output = yaml.dump(existingSpec, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false
  });
  await writeFile(specPath, output);
  console.log(`   Updated ${specPath}`);

  // Handle bundle
  if (options.bundle) {
    console.log('   Bundling (inlining external $refs)...');
    const bundled = await bundleSpec(specPath);
    const bundledOutput = yaml.dump(bundled, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false
    });
    await writeFile(specPath, bundledOutput);
    console.log(`   ${specPath} (bundled)`);
  }

  // Append examples
  const newExamples = generateExamples(name, resource);
  if (existsSync(examplesPath)) {
    const existingExamplesContent = await readFile(examplesPath, 'utf8');
    await writeFile(examplesPath, appendExamples(existingExamplesContent, newExamples));
  } else {
    await writeFile(examplesPath, newExamples);
  }
  console.log(`   Updated ${examplesPath}`);

  console.log(`
Done! Resource "${resource}" added to ${specFile}.

Next steps:
  1. Edit ${specFile} to customize the ${resource} schema
  2. Update ${examplesFile} with realistic example data
  3. Run validation: npm run validate
`);
}

// Export for testing
export { detectUrlPrefix, mergeResource, appendExamples };

// Run main when executed directly
const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
if (isDirectRun) {
  main().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}
