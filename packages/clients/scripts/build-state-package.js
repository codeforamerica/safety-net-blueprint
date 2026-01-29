#!/usr/bin/env node
/**
 * Build a state-specific npm package for publishing to npmjs.org.
 *
 * Usage:
 *   node scripts/build-state-package.js --state=california --version=1.0.0
 *
 * This script:
 * 1. Resolves the state overlay
 * 2. Bundles resolved specs into a single OpenAPI file
 * 3. Generates typed API client using @hey-api/openapi-ts
 * 4. Creates package directory with package.json
 * 5. Compiles TypeScript to JavaScript
 * 6. Outputs ready-to-publish package in dist-packages/{state}/
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

/**
 * Recursively copy a directory
 */
function copyDirRecursive(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const clientsRoot = join(__dirname, '..');
const repoRoot = join(clientsRoot, '..', '..');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = { state: null, version: null };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--state=')) {
      args.state = arg.split('=')[1];
    } else if (arg.startsWith('--version=')) {
      args.version = arg.split('=')[1];
    }
  }

  if (!args.state) {
    console.error('Error: --state is required');
    console.error('Usage: node scripts/build-state-package.js --state=california --version=1.0.0');
    process.exit(1);
  }

  if (!args.version) {
    console.error('Error: --version is required');
    console.error('Usage: node scripts/build-state-package.js --state=california --version=1.0.0');
    process.exit(1);
  }

  return args;
}

/**
 * Execute a command and return a promise
 */
function exec(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`  Running: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      cwd: options.cwd || repoRoot,
      ...options
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}`));
      } else {
        resolve();
      }
    });

    child.on('error', reject);
  });
}

/**
 * Title case a state name
 */
function titleCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Create openapi-ts config file
 */
function createOpenApiTsConfig(inputPath, outputPath) {
  const config = `// Auto-generated openapi-ts config
export default {
  input: '${inputPath}',
  output: '${outputPath}',
  plugins: [
    '@hey-api/client-axios',
    '@hey-api/typescript',
    'zod',
    {
      name: '@hey-api/sdk',
      validator: true,
    },
  ],
};
`;
  return config;
}

/**
 * Main build function
 */
async function main() {
  const { state, version } = parseArgs();
  const stateTitle = titleCase(state);
  const outputDir = join(clientsRoot, 'dist-packages', state);
  const srcDir = join(outputDir, 'src');
  const templatesDir = join(clientsRoot, 'templates');
  const resolvedDir = join(repoRoot, 'packages', 'schemas', 'openapi', 'resolved');

  console.log(`\nBuilding package for ${stateTitle}...`);
  console.log(`  State: ${state}`);
  console.log(`  Version: ${version}`);
  console.log(`  Output: ${outputDir}\n`);

  // Clean output directory
  if (existsSync(outputDir)) {
    console.log('Cleaning previous build...');
    rmSync(outputDir, { recursive: true });
  }
  mkdirSync(srcDir, { recursive: true });

  // Step 1: Resolve overlay for this state
  console.log('\n1. Resolving state overlay...');
  await exec('npm', ['run', 'overlay:resolve', '-w', '@safety-net/schemas', '--', `--state=${state}`]);

  // Step 2: Generate client for each domain spec
  console.log('\n2. Generating domain clients...');
  const specFiles = readdirSync(resolvedDir).filter(f => f.endsWith('.yaml') && !f.startsWith('.'));

  if (specFiles.length === 0) {
    throw new Error('No resolved spec files found');
  }

  console.log(`  Found specs: ${specFiles.join(', ')}`);
  const domains = [];

  for (const file of specFiles) {
    const domain = file.replace('.yaml', '');
    domains.push(domain);
    const specPath = join(resolvedDir, file);
    const domainBundled = join(outputDir, `${domain}-bundled.yaml`);
    const domainSrcDir = join(srcDir, domain);
    const domainConfigPath = join(outputDir, `${domain}.config.js`);

    console.log(`\n  Processing ${domain}...`);

    // Bundle spec (dereference $refs)
    await exec('npx', [
      '@apidevtools/swagger-cli', 'bundle',
      specPath,
      '-o', domainBundled,
      '--dereference'
    ]);

    // Generate client for this domain
    mkdirSync(domainSrcDir, { recursive: true });
    const configContent = createOpenApiTsConfig(domainBundled, domainSrcDir);
    writeFileSync(domainConfigPath, configContent);

    await exec('npx', ['@hey-api/openapi-ts', '-f', domainConfigPath], { cwd: outputDir });

    // Post-process: Remove unused @ts-expect-error directives
    const clientGenPath = join(domainSrcDir, 'client', 'client.gen.ts');
    if (existsSync(clientGenPath)) {
      let content = readFileSync(clientGenPath, 'utf8');
      content = content.replace(/^\s*\/\/\s*@ts-expect-error\s*$/gm, '');
      writeFileSync(clientGenPath, content);
    }

    // Clean up temp files
    rmSync(domainBundled, { force: true });
    rmSync(domainConfigPath, { force: true });

    console.log(`    Generated: ${domain}`);
  }

  // Step 3: Copy resolved OpenAPI specs to package
  console.log('\n3. Copying OpenAPI specs...');
  const openapiDir = join(outputDir, 'openapi');
  copyDirRecursive(resolvedDir, openapiDir);
  console.log(`  Copied resolved specs to openapi/`);

  // Step 4: Extract JSON schemas from bundled specs
  console.log('\n4. Extracting JSON schemas...');
  const jsonSchemaDir = join(outputDir, 'json-schema');
  for (const file of specFiles) {
    const domain = file.replace('.yaml', '');
    const specPath = join(resolvedDir, file);
    const domainBundled = join(outputDir, `${domain}-bundled.yaml`);
    const domainSchemaDir = join(jsonSchemaDir, domain);

    // Bundle spec (dereference $refs) for JSON schema extraction
    await exec('npx', [
      '@apidevtools/swagger-cli', 'bundle',
      specPath,
      '-o', domainBundled,
      '--dereference'
    ]);

    // Extract schemas from bundled spec
    const bundledContent = readFileSync(domainBundled, 'utf8');
    const bundledSpec = yaml.load(bundledContent);
    const schemas = bundledSpec.components?.schemas || {};

    mkdirSync(domainSchemaDir, { recursive: true });
    for (const [schemaName, schema] of Object.entries(schemas)) {
      const jsonSchemaPath = join(domainSchemaDir, `${schemaName}.json`);
      writeFileSync(jsonSchemaPath, JSON.stringify(schema, null, 2));
    }
    console.log(`  Extracted ${Object.keys(schemas).length} schemas for ${domain}`);

    // Clean up temp bundled file
    rmSync(domainBundled, { force: true });
  }

  // Step 5: Create index.ts that re-exports all domains and search helpers
  console.log('\n5. Creating index exports...');
  const domainExports = domains.map(d => `export * as ${d} from './${d}/index.js';`).join('\n');
  const indexContent = `${domainExports}
export { q, search } from './search-helpers.js';
`;
  writeFileSync(join(srcDir, 'index.ts'), indexContent);
  console.log('  Created index.ts');

  // Copy search helpers
  const searchHelpersSource = join(templatesDir, 'search-helpers.ts');
  const searchHelpersDest = join(srcDir, 'search-helpers.ts');
  copyFileSync(searchHelpersSource, searchHelpersDest);
  console.log('  Copied search-helpers.ts');

  // Step 6: Generate package.json from template
  console.log('\n6. Generating package.json...');
  const packageTemplate = readFileSync(join(templatesDir, 'package.template.json'), 'utf8');
  const packageJson = packageTemplate
    .replace(/\{\{STATE\}\}/g, state)
    .replace(/\{\{VERSION\}\}/g, version)
    .replace(/\{\{STATE_TITLE\}\}/g, stateTitle);
  writeFileSync(join(outputDir, 'package.json'), packageJson);
  console.log('  Generated package.json');

  // Step 7: Create tsconfig for compilation
  console.log('\n7. Setting up TypeScript compilation...');
  const tsconfig = {
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'bundler',
      declaration: true,
      outDir: 'dist',
      rootDir: 'src',
      skipLibCheck: true,
      esModuleInterop: true,
      strict: false,
      noEmitOnError: false
    },
    include: ['src/**/*.ts']
  };
  writeFileSync(join(outputDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  console.log('  Created tsconfig.json');

  // Step 8: Install build dependencies (peer deps needed for type checking)
  console.log('\n8. Installing build dependencies...');
  await exec('npm', ['install', 'zod@^4.3.5', 'axios@^1.6.0', '--save-dev'], { cwd: outputDir });
  console.log('  Dependencies installed');

  // Step 9: Compile TypeScript
  console.log('\n9. Compiling TypeScript...');
  try {
    await exec('npx', ['tsc'], { cwd: outputDir });
  } catch (error) {
    // Check if dist files were still generated despite type errors
    if (existsSync(join(outputDir, 'dist', 'index.js'))) {
      console.log('  Compilation complete (with type warnings in generated code)');
    } else {
      throw error;
    }
  }
  console.log('  Compilation complete');

  // Summary
  console.log('\n========================================');
  console.log(`Package built successfully!`);
  console.log(`  Name: @codeforamerica/safety-net-${state}`);
  console.log(`  Version: ${version}`);
  console.log(`  Location: ${outputDir}`);
  console.log('========================================\n');
}

main().catch((error) => {
  console.error('\nBuild failed:', error.message);
  process.exit(1);
});
