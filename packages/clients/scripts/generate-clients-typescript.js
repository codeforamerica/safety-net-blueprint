#!/usr/bin/env node
/**
 * Generate TypeScript clients from resolved OpenAPI specs.
 * For use in state application repositories.
 *
 * Usage:
 *   safety-net-generate-clients --spec=./resolved --out=./src/api
 *   node scripts/generate-clients-typescript.js --spec=./resolved --out=./src/api
 *
 * This script:
 * 1. Discovers all OpenAPI spec files in --spec file or directory
 * 2. Generates typed API client using @hey-api/openapi-ts for each domain
 * 3. Creates search helper utilities
 * 4. Creates index.ts that re-exports all domains
 * 5. Outputs directly to --out directory (no package structure)
 *
 * Output structure:
 *   {out}/
 *     index.ts                  # Re-exports all domains and annotations
 *     search-helpers.ts         # Query string builder utilities
 *     annotations.ts            # Typed annotation exports (if annotation files found)
 *     persons/
 *       index.ts                # SDK functions + types
 *       sdk.gen.ts              # getPerson, createPerson, etc.
 *       types.gen.ts            # TypeScript interfaces
 *       zod.gen.ts              # Zod schemas for validation
 *       client/                 # HTTP client utilities
 *     applications/
 *     households/
 *     incomes/
 *     users/
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync, realpathSync } from 'fs';
import { join, dirname, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const clientsRoot = join(__dirname, '..');
const utilityDIr = join(clientsRoot, 'utility');

/**
 * Parse command line arguments
 */
function parseArgs(argv = process.argv.slice(2)) {
  const args = { spec: null, out: null, help: false };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg.startsWith('--spec=')) {
      args.spec = arg.split('=')[1];
    } else if (arg.startsWith('--out=')) {
      args.out = arg.split('=')[1];
    }
  }

  return args;
}

function showHelp() {
  console.log(`
Generate TypeScript Clients

Generates TypeScript SDK with Zod schemas from resolved OpenAPI specs.

Usage:
  safety-net-generate-clients --spec=<file-or-dir> --out=<dir>
  node scripts/generate-clients-typescript.js --spec=<file-or-dir> --out=<dir>

Flags:
  --spec=<file-or-dir>  Path to resolved spec file or directory (required)
  --out=<dir>           Output directory for generated clients (required)
  -h, --help            Show this help message

Example:
  # From state application repo
  safety-net-generate-clients --spec=./resolved --out=./src/api

Output structure:
  {out}/
    index.ts                  # Re-exports all domains and annotations
    search-helpers.ts         # Query string builder utilities
    annotations.ts            # Typed annotation exports (when annotation files are present)
    persons/
      index.ts                # SDK functions + types
      sdk.gen.ts              # getPerson, createPerson, etc.
      types.gen.ts            # TypeScript interfaces
      zod.gen.ts              # Zod schemas for validation
      client/                 # HTTP client utilities
    applications/
    households/
    incomes/
    users/
`);
}

/**
 * Execute a command and return a promise
 */
function exec(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`  Running: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      stdio: 'inherit',
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
 * Create openapi-ts config file
 */
function createOpenApiTsConfig(inputPath, outputPath) {
  const config = `// Auto-generated openapi-ts config
export default {
  input: '${inputPath}',
  output: {
    path: '${outputPath}',
  },
  plugins: [
    {
      name: '@hey-api/typescript',
      enums: 'javascript',
      style: 'PascalCase',
    },
    {
      name: '@hey-api/sdk',
      validator: true,
    },
    {
      name: 'zod',
      dates: { offset: true },
    },
    {
      name: '@hey-api/client-axios',
    },
  ],
  types: {
    dates: 'types+transform',
    enums: 'javascript',
  },
};
`;
  return config;
}

/**
 * Convert a kebab-case domain name to a PascalCase export name.
 * e.g. 'intake' → 'IntakeAnnotations', 'case-management' → 'CaseManagementAnnotations'
 * @param {string} domain
 */
function domainToAnnotationExportName(domain) {
  return domain
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('') + 'Annotations';
}

/**
 * Look for annotation YAML files in `specsDir` and emit `annotations.ts` with
 * one typed `as const` export per domain. Policy data is served by the platform
 * API (`GET /platform/registry/policies`) rather than baked into the client.
 *
 * Populates `annotationExportNames` with the export names written to annotations.ts.
 *
 * @param {string} specsDir
 * @param {string} outputDir
 * @param {string[]} annotationExportNames - mutated in place
 * @returns {Promise<void>}
 */
async function generateAnnotationsAndPolicies(specsDir, outputDir, annotationExportNames) {
  const allFiles = readdirSync(specsDir);

  // ── Annotations ───────────────────────────────────────────────────────────

  const annotationFiles = allFiles.filter(f => f.endsWith('-annotations.yaml')).sort();

  if (annotationFiles.length > 0) {
    // Group files by domain (everything before the first "-annotations" suffix)
    const domainMap = new Map();
    for (const f of annotationFiles) {
      const domain = f.replace(/-annotations.*\.yaml$/, '');
      if (!domainMap.has(domain)) domainMap.set(domain, []);
      domainMap.get(domain).push(f);
    }

    const blocks = [];
    for (const [domain, files] of domainMap) {
      const merged = { schema: {}, operations: {}, events: {} };
      for (const f of files) {
        const data = yaml.load(readFileSync(join(specsDir, f), 'utf8'));
        Object.assign(merged.schema, data.schema || {});
        Object.assign(merged.operations, data.operations || {});
        Object.assign(merged.events, data.events || {});
      }
      const exportName = domainToAnnotationExportName(domain);
      annotationExportNames.push(exportName);
      blocks.push(`export const ${exportName} = ${JSON.stringify(merged, null, 2)} as const;`);
    }

    writeFileSync(join(outputDir, 'annotations.ts'), blocks.join('\n\n') + '\n');
    console.log(`  ✓ Generated annotations.ts (${annotationExportNames.join(', ')})`);
  } else {
    console.log('  No annotation files found, skipping annotations.ts');
  }
}

/**
 * Recursively walk a parsed YAML object and collect names of any properties
 * declared with nullable: true. Handles allOf/anyOf/oneOf nesting.
 *
 * @param {unknown} obj
 * @param {Set<string>} result - mutated in place
 */
function walkForNullable(obj, result) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) walkForNullable(item, result);
    return;
  }
  if (obj.properties) {
    for (const [name, schema] of Object.entries(obj.properties)) {
      if (schema && schema.nullable === true) result.add(name);
    }
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') walkForNullable(val, result);
  }
}

/**
 * Walk all YAML files in a spec directory (recursively) and collect the names
 * of any schema properties declared with nullable: true.
 *
 * Catches nullable annotations in both the main OpenAPI spec and referenced
 * schema files, including overlay-applied values in resolved specs.
 *
 * @param {string} specDir - path to the resolved spec directory
 * @returns {Set<string>} field names that should be nullable
 */
function collectNullableFieldNames(specDir) {
  const result = new Set();
  const files = readdirSync(specDir, { recursive: true });
  for (const file of files) {
    if (typeof file !== 'string') continue;
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    try {
      const content = yaml.load(readFileSync(join(specDir, file), 'utf8'));
      walkForNullable(content, result);
    } catch {
      // Skip unreadable or non-YAML files silently
    }
  }
  return result;
}

/**
 * Post-process a generated zod.gen.ts to add .nullable() to optional fields
 * that @hey-api/openapi-ts missed — specifically, fields declared nullable: true
 * on an allOf-wrapped $ref, which the generator does not translate correctly.
 *
 * Transforms:
 *   fieldName: z.optional(X),  →  fieldName: z.optional(X.nullable()),
 *
 * Uses balanced-paren matching so nested schemas (e.g. z.array(z.string()))
 * are handled correctly without truncation.
 *
 * @param {string} zodGenPath - absolute path to zod.gen.ts
 * @param {Set<string>} nullableFields - field names that need .nullable()
 */
function patchZodGenForNullable(zodGenPath, nullableFields) {
  if (nullableFields.size === 0) return;
  const lines = readFileSync(zodGenPath, 'utf8').split('\n');
  let patched = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s+)(\w+):\s*z\.optional\(/);
    if (!match) continue;
    const fieldName = match[2];
    if (!nullableFields.has(fieldName)) continue;

    // Find the matching closing paren for z.optional( using balanced-paren scan
    const optStart = line.indexOf('z.optional(') + 'z.optional('.length;
    let depth = 1;
    let pos = optStart;
    while (pos < line.length && depth > 0) {
      if (line[pos] === '(') depth++;
      else if (line[pos] === ')') depth--;
      pos++;
    }
    const closePos = pos - 1; // index of the matching )

    // Skip if already patched (idempotent)
    if (line.slice(optStart, closePos).endsWith('.nullable()')) continue;

    lines[i] = line.slice(0, closePos) + '.nullable()' + line.slice(closePos);
    patched = true;
    console.log(`    nullable patch: ${fieldName}`);
  }

  if (patched) writeFileSync(zodGenPath, lines.join('\n'));
}

/**
 * Main generation function
 */
async function main() {
  const { spec, out, help } = parseArgs();

  if (help) {
    showHelp();
    process.exit(0);
  }

  if (!spec || !out) {
    console.error('Error: --spec and --out are required.\n');
    showHelp();
    process.exit(1);
  }

  const specsDir = resolvePath(spec);
  const outputDir = resolvePath(out);

  if (!existsSync(specsDir)) {
    console.error(`Error: Specs directory does not exist: ${specsDir}`);
    process.exit(1);
  }

  console.log(`\nGenerating TypeScript clients...`);
  console.log(`  Specs:  ${specsDir}`);
  console.log(`  Output: ${outputDir}\n`);

  // Clean output directory
  if (existsSync(outputDir)) {
    console.log('Cleaning previous build...');
    rmSync(outputDir, { recursive: true });
  }
  mkdirSync(outputDir, { recursive: true });

  // Discover all OpenAPI spec files (match *-openapi.yaml convention), skipping deprecated specs
  const specFiles = readdirSync(specsDir).filter(f => {
    if (!f.endsWith('-openapi.yaml')) return false;
    try {
      return !readFileSync(join(specsDir, f), 'utf8').includes('x-status: deprecated');
    } catch {
      return true;
    }
  });

  if (specFiles.length === 0) {
    console.error(`Error: No OpenAPI spec files found in ${specsDir}`);
    console.error('Expected files like: persons-openapi.yaml, applications-openapi.yaml, etc.');
    process.exit(1);
  }

  console.log(`Found ${specFiles.length} API specs: ${specFiles.join(', ')}\n`);

  const domains = [];

  // Generate client for each domain
  for (const file of specFiles) {
    const domain = file.replace('-openapi.yaml', '');
    domains.push(domain);
    const specPath = join(specsDir, file);
    const domainOutputDir = join(outputDir, domain);
    const configPath = join(outputDir, `${domain}.config.js`);

    console.log(`Generating ${domain}...`);

    // Create domain output directory
    mkdirSync(domainOutputDir, { recursive: true });

    // Create openapi-ts config
    const configContent = createOpenApiTsConfig(specPath, domainOutputDir);
    writeFileSync(configPath, configContent);

    // Generate client using @hey-api/openapi-ts
    await exec('npx', ['@hey-api/openapi-ts', '-f', configPath], { cwd: outputDir });

    // Post-process: add .nullable() to fields the generator missed.
    // @hey-api/openapi-ts does not translate nullable: true on allOf-wrapped $ref
    // fields to Zod .nullable() — this patch reads it from the resolved spec.
    const zodGenPath = join(domainOutputDir, 'zod.gen.ts');
    if (existsSync(zodGenPath)) {
      const nullableFields = collectNullableFieldNames(specsDir);
      if (nullableFields.size > 0) patchZodGenForNullable(zodGenPath, nullableFields);
    }

    // Post-process: Remove unused @ts-expect-error directives
    const clientGenPath = join(domainOutputDir, 'client', 'client.gen.ts');
    if (existsSync(clientGenPath)) {
      let content = readFileSync(clientGenPath, 'utf8');
      content = content.replace(/^\s*\/\/\s*@ts-expect-error\s*$/gm, '');
      writeFileSync(clientGenPath, content);
    }

    // Clean up config file
    rmSync(configPath, { force: true });

    console.log(`  ✓ Generated ${domain}`);
  }

  // Generate annotation TypeScript files when present in the spec dir
  console.log('\nGenerating annotation exports...');
  const annotationExports = [];
  await generateAnnotationsAndPolicies(specsDir, outputDir, annotationExports);

  // Create index.ts that re-exports all domains and annotations
  console.log('\nCreating index exports...');
  const domainExports = domains.map(d => `export * as ${d} from './${d}/index.js';`).join('\n');
  const annotationIndexExports = annotationExports.map(n => `export { ${n} } from './annotations.js';`).join('\n');
  const indexParts = [
    domainExports,
    annotationIndexExports,
    `export { q, search } from './search-helpers.js';`,
  ].filter(Boolean);
  writeFileSync(join(outputDir, 'index.ts'), indexParts.join('\n') + '\n');
  console.log('  ✓ Created index.ts');

  // Copy search helpers
  const searchHelpersSource = join(utilityDIr, 'search-helpers.ts');
  console.log(searchHelpersSource);
  if (existsSync(searchHelpersSource)) {
    const searchHelpersDest = join(outputDir, 'search-helpers.ts');
    copyFileSync(searchHelpersSource, searchHelpersDest);
    console.log('  ✓ Copied search-helpers.ts');
  } else {
    console.warn('  ⚠ Warning: search-helpers.ts template not found, skipping');
  }

  console.log(`\nDone! Generated clients in ${outputDir}`);
  console.log(`\nYou can now import from your API clients:`);
  console.log(`  import { ${domains[0]} } from '@/api';`);
  console.log(`  import { getPerson } from '@/api/${domains[0]}';`);
}

// Export for testing
export { parseArgs, createOpenApiTsConfig, exec, domainToAnnotationExportName, collectNullableFieldNames, patchZodGenForNullable };

// Run main function only if this is the entry point
if (import.meta.url === `file://${realpathSync(process.argv[1])}`) {
  main().catch(err => {
    console.error('\nError:', err.message);
    process.exit(1);
  });
}
