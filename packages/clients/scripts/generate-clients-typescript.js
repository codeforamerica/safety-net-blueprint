#!/usr/bin/env node
/**
 * Generate TypeScript clients from resolved OpenAPI specs.
 * For use in state application repositories.
 *
 * Usage:
 *   safety-net-generate-clients --specs=./resolved --out=./src/api
 *   node scripts/generate-clients-typescript.js --specs=./resolved --out=./src/api
 *
 * This script:
 * 1. Discovers all OpenAPI spec files in --specs directory
 * 2. Generates typed API client using @hey-api/openapi-ts for each domain
 * 3. Creates search helper utilities
 * 4. Creates index.ts that re-exports all domains
 * 5. Outputs directly to --out directory (no package structure)
 *
 * Output structure:
 *   {out}/
 *     index.ts                  # Re-exports all domains
 *     search-helpers.ts         # Query string builder utilities
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const clientsRoot = join(__dirname, '..');
const templatesDir = join(clientsRoot, 'templates');

/**
 * Parse command line arguments
 */
function parseArgs(argv = process.argv.slice(2)) {
  const args = { specs: null, out: null, help: false };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg.startsWith('--specs=')) {
      args.specs = arg.split('=')[1];
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
  safety-net-generate-clients --specs=<dir> --out=<dir>
  node scripts/generate-clients-typescript.js --specs=<dir> --out=<dir>

Flags:
  --specs=<dir>  Path to resolved specs directory (required)
  --out=<dir>    Output directory for generated clients (required)
  -h, --help     Show this help message

Example:
  # From state application repo
  safety-net-generate-clients --specs=./resolved --out=./src/api

Output structure:
  {out}/
    index.ts                  # Re-exports all domains
    search-helpers.ts         # Query string builder utilities
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
      shell: true,
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
 * Main generation function
 */
async function main() {
  const { specs, out, help } = parseArgs();

  if (help) {
    showHelp();
    process.exit(0);
  }

  if (!specs || !out) {
    console.error('Error: --specs and --out are required.\n');
    showHelp();
    process.exit(1);
  }

  const specsDir = resolvePath(specs);
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

  // Discover all OpenAPI spec files (match *-openapi.yaml convention)
  const specFiles = readdirSync(specsDir).filter(f => {
    return f.endsWith('-openapi.yaml');
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

  // Create index.ts that re-exports all domains
  console.log('\nCreating index exports...');
  const domainExports = domains.map(d => `export * as ${d} from './${d}/index.js';`).join('\n');
  const indexContent = `${domainExports}
export { q, search } from './search-helpers.js';
`;
  writeFileSync(join(outputDir, 'index.ts'), indexContent);
  console.log('  ✓ Created index.ts');

  // Copy search helpers
  const searchHelpersSource = join(templatesDir, 'search-helpers.ts');
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
export { parseArgs, createOpenApiTsConfig, exec };

// Run main function only if this is the entry point
if (import.meta.url === `file://${realpathSync(process.argv[1])}`) {
  main().catch(err => {
    console.error('\nError:', err.message);
    process.exit(1);
  });
}
