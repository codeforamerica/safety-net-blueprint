#!/usr/bin/env node
/**
 * Build a state-specific npm package for publishing to npmjs.org.
 *
 * Usage:
 *   node scripts/build-state-package.js --state=california --version=1.0.0
 *
 * This script:
 * 1. Resolves the state overlay
 * 2. Generates modular TypeScript types using OpenAPI Generator
 * 3. Generates Zod schemas from TypeScript types using ts-to-zod
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
 * Generate TypeScript types and API client using OpenAPI Generator
 */
async function generateWithOpenAPIGenerator(specPath, outputPath) {
  await exec('npx', [
    '@openapitools/openapi-generator-cli', 'generate',
    '-i', specPath,
    '-g', 'typescript-axios',
    '-o', outputPath,
    '--skip-validate-spec',
    '--additional-properties=withSeparateModelsAndApi=true,modelPackage=models,apiPackage=api,withNodeImports=true'
  ]);
}

/**
 * Convert OpenAPI schema to Zod schema code
 */
function schemaToZod(schema, schemaName, depth = 0, allSchemas = {}, seenRefs = new Set()) {
  if (!schema) return 'z.unknown()';

  // Handle $ref
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop();

    // Prevent infinite recursion
    if (seenRefs.has(refName)) {
      return `z.lazy(() => ${refName}Schema)`;
    }

    // For top-level schema refs, just reference the schema name
    return `${refName}Schema`;
  }

  // Handle basic types
  if (schema.type === 'string') {
    let zod = 'z.string()';
    if (schema.format === 'date') zod += '.regex(/^\\d{4}-\\d{2}-\\d{2}$/, "Invalid date format")';
    if (schema.format === 'date-time') zod += '.datetime()';
    if (schema.format === 'email') zod += '.email()';
    if (schema.format === 'uuid') zod += '.uuid()';
    if (schema.minLength) zod += `.min(${schema.minLength})`;
    if (schema.maxLength) zod += `.max(${schema.maxLength})`;
    if (schema.pattern) zod += `.regex(/${schema.pattern}/)`;
    if (schema.enum) {
      const values = schema.enum.map(v => `"${v}"`).join(', ');
      zod = `z.enum([${values}])`;
    }
    return zod;
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    let zod = schema.type === 'integer' ? 'z.number().int()' : 'z.number()';
    if (schema.minimum !== undefined) zod += `.min(${schema.minimum})`;
    if (schema.maximum !== undefined) zod += `.max(${schema.maximum})`;
    return zod;
  }

  if (schema.type === 'boolean') {
    return 'z.boolean()';
  }

  if (schema.type === 'array') {
    const itemsZod = schemaToZod(schema.items, null, depth + 1, allSchemas, seenRefs);
    return `z.array(${itemsZod})`;
  }

  if (schema.type === 'object' || schema.properties) {
    const props = [];
    const required = schema.required || [];

    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      const propZod = schemaToZod(propSchema, null, depth + 1, allSchemas, seenRefs);
      const isRequired = required.includes(key);
      const zodProp = isRequired ? propZod : `${propZod}.optional()`;
      props.push(`  "${key}": ${zodProp}`);
    }

    let objectSchema = `z.object({\n${props.join(',\n')}\n})`;

    if (schema.additionalProperties === true) {
      objectSchema += '.passthrough()';
    } else if (schema.additionalProperties === false) {
      objectSchema += '.strict()';
    }

    return objectSchema;
  }

  // Handle allOf
  if (schema.allOf) {
    const schemas = schema.allOf.map(s => schemaToZod(s, null, depth, allSchemas, seenRefs));
    return schemas.length === 1 ? schemas[0] : `z.intersection(${schemas.join(', ')})`;
  }

  // Handle oneOf
  if (schema.oneOf) {
    const schemas = schema.oneOf.map(s => schemaToZod(s, null, depth, allSchemas, seenRefs));
    return `z.union([${schemas.join(', ')}])`;
  }

  // Handle anyOf
  if (schema.anyOf) {
    const schemas = schema.anyOf.map(s => schemaToZod(s, null, depth, allSchemas, seenRefs));
    return `z.union([${schemas.join(', ')}])`;
  }

  return 'z.unknown()';
}

/**
 * Generate Zod schemas from OpenAPI spec
 */
async function generateZodSchemas(specPath, domainSrcDir, domain, outputDir) {
  const schemasDir = join(domainSrcDir, 'schemas');
  mkdirSync(schemasDir, { recursive: true });

  // Bundle spec (dereference $refs) for Zod generation
  const bundledPath = join(outputDir, `${domain}-bundled-for-zod.yaml`);
  await exec('npx', [
    '@apidevtools/swagger-cli', 'bundle',
    specPath,
    '-o', bundledPath,
    '--dereference'
  ]);

  // Read bundled spec
  const content = readFileSync(bundledPath, 'utf8');
  const spec = yaml.load(content);

  // Clean up temp file
  rmSync(bundledPath, { force: true });

  const schemas = [];
  const allSchemas = spec.components?.schemas || {};

  // Process component schemas
  if (spec.components && spec.components.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      const zodCode = schemaToZod(schema, name, 0, allSchemas, new Set());

      schemas.push(`
/**
 * ${schema.description || name}
 */
export const ${name}Schema = ${zodCode};
`);
    }
  }

  // Generate the module content
  const schemasContent = `/**
 * Zod validation schemas for ${domain} domain
 * Auto-generated from OpenAPI specification
 */

import { z } from 'zod';

${schemas.join('\n')}
`;

  writeFileSync(join(schemasDir, 'index.ts'), schemasContent);
  console.log(`    Generated ${Object.keys(spec.components?.schemas || {}).length} Zod schemas`);
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
    const domainSrcDir = join(srcDir, domain);

    console.log(`\n  Processing ${domain}...`);

    // Generate TypeScript types and API client using OpenAPI Generator
    console.log('    Generating TypeScript types and API client...');
    await generateWithOpenAPIGenerator(specPath, domainSrcDir);

    // Create api/index.ts that re-exports all API files
    const apiDir = join(domainSrcDir, 'api');
    if (existsSync(apiDir)) {
      const apiFiles = readdirSync(apiDir)
        .filter(f => f.endsWith('-api.ts'))
        .map(f => f.replace('.ts', ''));

      const apiIndexContent = `// Auto-generated API exports for ${domain}\n` +
        apiFiles.map(f => `export * from './${f}.js';`).join('\n') + '\n';

      writeFileSync(join(apiDir, 'index.ts'), apiIndexContent);
      console.log(`    Created api/index.ts with ${apiFiles.length} API exports`);
    }

    // Generate Zod schemas from OpenAPI spec
    console.log('    Generating Zod schemas...');
    await generateZodSchemas(specPath, domainSrcDir, domain, outputDir);

    // Create domain index that re-exports models, schemas, and API
    const domainIndexContent = `// Auto-generated exports for ${domain}
export * from './models/index.js';
export * from './schemas/index.js';
export * from './api/index.js';
`;
    writeFileSync(join(domainSrcDir, 'index.ts'), domainIndexContent);

    console.log(`    ✅ Generated: ${domain}`);
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

  // Step 7: Generate README.md from template
  console.log('\n7. Generating README.md...');
  const readMeTemplate = readFileSync(join(templatesDir, 'README.template.md'), 'utf8');
  const readMeContent = readMeTemplate
    .replace(/\{\{STATE\}\}/g, state)
    .replace(/\{\{VERSION\}\}/g, version)
    .replace(/\{\{STATE_TITLE\}\}/g, stateTitle);
  writeFileSync(join(outputDir, 'README.md'), readMeContent);
  console.log('  Generated README.md');

  // Step 8: Create tsconfig for compilation
  console.log('\n8. Setting up TypeScript compilation...');
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

  // Step 9: Install build dependencies (peer deps needed for type checking)
  console.log('\n9. Installing build dependencies...');
  await exec('npm', ['install', 'zod@^4.3.5', 'axios@^1.6.0', '--save-dev'], { cwd: outputDir });
  console.log('  Dependencies installed');

  // Step 10: Compile TypeScript
  console.log('\n10. Compiling TypeScript...');
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
  console.log(`  Name: @codeforamerica/safety-net-apis-${state}`);
  console.log(`  Version: ${version}`);
  console.log(`  Location: ${outputDir}`);
  console.log('========================================\n');
}

main().catch((error) => {
  console.error('\nBuild failed:', error.message);
  process.exit(1);
});
