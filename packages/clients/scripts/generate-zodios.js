#!/usr/bin/env node
import { readdir, writeFile, unlink, mkdir } from 'fs/promises';
import { join, basename, extname } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { validateSpec } from '@safety-net/schemas/validation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = join(__dirname, '..');
const schemasRoot = join(__dirname, '..', '..', 'schemas');

/**
 * Executes a command and returns a promise
 */
function executeCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      cwd: workspaceRoot
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}`));
      } else {
        resolve();
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Finds all OpenAPI specification files in the root of the openapi directory
 * (excludes subdirectories)
 */
async function findOpenAPISpecs(directory) {
  const specs = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      // Check for YAML or JSON OpenAPI specs
      if (ext === '.yaml' || ext === '.yml' || ext === '.json') {
        const fullPath = join(directory, entry.name);
        specs.push(fullPath);
      }
    }
  }

  return specs;
}

/**
 * Generates a Zodios client for a given OpenAPI spec
 */
async function generateClient(specPath) {
  const specName = basename(specPath, extname(specPath));
  const outputPath = join(workspaceRoot, 'generated', 'clients', 'zodios', `${specName}.ts`);
  const tempSpecPath = join(workspaceRoot, 'generated', 'clients', 'zodios', `.${specName}.dereferenced.json`);
  
  console.log(`\n📝 Generating client for: ${specName}`);
  console.log(`   Input:  ${specPath}`);
  console.log(`   Output: ${outputPath}`);

  try {
    // Validate spec first
    console.log(`   ✓ Validating specification...`);
    const validation = await validateSpec(specPath);
    
    if (!validation.valid) {
      console.error(`   ❌ Specification validation failed:`);
      for (const error of validation.errors) {
        console.error(`      - ${error.message}`);
      }
      throw new Error('Specification validation failed');
    }
    
    if (validation.warnings.length > 0) {
      console.log(`   ⚠️  ${validation.warnings.length} warning(s):`);
      for (const warning of validation.warnings.slice(0, 3)) {
        console.log(`      - ${warning.message}`);
      }
    }
    
    // Dereference the spec to resolve all external $ref
    console.log(`   🔗 Dereferencing external references...`);
    const dereferencedSpec = await $RefParser.dereference(specPath, {
      dereference: {
        circular: 'ignore'
      }
    });
    
    // Ensure output directory exists
    await mkdir(dirname(tempSpecPath), { recursive: true });

    // Write dereferenced spec to temp file
    await writeFile(tempSpecPath, JSON.stringify(dereferencedSpec, null, 2));
    
    // Generate client from dereferenced spec
    await executeCommand('npx', [
      'openapi-zod-client',
      tempSpecPath,
      '-o',
      outputPath,
      '--export-schemas'
    ]);
    
    console.log(`✅ Successfully generated client for: ${specName}`);
  } catch (error) {
    console.error(`❌ Failed to generate client for: ${specName}`);
    console.error(error.message);
    throw error;
  } finally {
    // Clean up temp file
    try {
      await unlink(tempSpecPath);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Main function to generate all clients
 */
async function main() {
  const openAPIDir = join(workspaceRoot, '..', 'schemas', 'openapi', 'resolved');

  console.log('🚀 Starting Zodios API client generation...');
  console.log(`📂 Searching for OpenAPI specs in: ${openAPIDir}\n`);

  try {
    const specs = await findOpenAPISpecs(openAPIDir);
    
    if (specs.length === 0) {
      console.log('⚠️  No OpenAPI specifications found.');
      return;
    }

    console.log(`📋 Found ${specs.length} specification(s):`);
    specs.forEach(spec => console.log(`   - ${spec}`));

    const results = { success: [], failed: [] };
    
    for (const spec of specs) {
      try {
        await generateClient(spec);
        results.success.push(basename(spec));
      } catch (error) {
        results.failed.push(basename(spec));
        // Continue with next spec instead of exiting
      }
    }

    console.log(`\n✨ Generation complete!`);
    console.log(`   ✅ Successful: ${results.success.length}/${specs.length}`);
    if (results.success.length > 0) {
      console.log(`      ${results.success.join(', ')}`);
    }
    if (results.failed.length > 0) {
      console.log(`   ❌ Failed: ${results.failed.length}/${specs.length}`);
      console.log(`      ${results.failed.join(', ')}`);
    }
    console.log(`\n💡 Clients are available in: ${join(workspaceRoot, 'generated', 'clients', 'zodios')}`);
    
    if (results.failed.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Generation failed:', error.message);
    process.exit(1);
  }
}

main();
