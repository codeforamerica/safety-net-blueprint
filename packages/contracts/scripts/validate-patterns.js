#!/usr/bin/env node
/**
 * API Pattern Validation Script
 *
 * Validates that OpenAPI specs follow our established API design patterns:
 * - Search: List endpoints must use SearchQueryParam
 * - Pagination: List endpoints must have LimitParam and OffsetParam
 * - List Response: Must have items, total, limit, offset, hasNext
 * - Consistent HTTP methods and response codes
 *
 * This complements Spectral's OpenAPI linting with business-specific rules.
 */

import { readdir } from 'fs/promises';
import { statSync } from 'fs';
import { join, basename, extname, resolve } from 'path';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { validateSpec } from '../src/validation/pattern-validator.js';

// =============================================================================
// Main Script
// =============================================================================

async function findOpenAPISpecs(directory) {
  const specs = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (ext === '.yaml' || ext === '.yml' || ext === '.json') {
        specs.push(join(directory, entry.name));
      }
    }
  }

  return specs;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Validate API Design Patterns

Checks that OpenAPI specs follow established design patterns (search, pagination,
list response shape, HTTP methods, response codes).

Usage:
  node scripts/validate-patterns.js --spec=<file|dir>

Flags:
  --spec=<path>  Path to spec file or directory of specs (required)
  -h, --help     Show this help message
`);
    process.exit(0);
  }

  // Check for unknown arguments
  const unknown = args.filter(a => a !== '--help' && a !== '-h' && !a.startsWith('--spec='));
  if (unknown.length > 0) {
    console.error(`Error: Unknown argument(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  // Parse --spec flag
  const specArg = args.find(a => a.startsWith('--spec='));
  if (!specArg) {
    console.error('Error: --spec=<file|dir> is required.\n');
    console.error('Usage: node scripts/validate-patterns.js --spec=<file|dir>');
    process.exit(1);
  }
  const specDir = resolve(specArg.split('=')[1]);
  const isSingleFile = statSync(specDir).isFile();

  console.log('🔍 Validating API design patterns...\n');
  console.log(`   ${isSingleFile ? 'File' : 'Directory'}: ${specDir}\n`);

  try {
    const specPaths = isSingleFile ? [specDir] : await findOpenAPISpecs(specDir);

    if (specPaths.length === 0) {
      console.log('⚠️  No OpenAPI specifications found.');
      return;
    }

    let allErrors = [];
    let allWarnings = [];

    for (const specPath of specPaths) {
      const specName = basename(specPath);
      console.log(`📋 Checking ${specName}...`);

      try {
        // Parse spec (without full dereferencing to keep $refs visible)
        const spec = await $RefParser.parse(specPath);
        const issues = validateSpec(spec, specName);

        const errors = issues.filter(i => i.severity === 'error');
        const warnings = issues.filter(i => i.severity === 'warn');

        allErrors.push(...errors);
        allWarnings.push(...warnings);

        if (errors.length === 0 && warnings.length === 0) {
          console.log(`   ✅ All patterns valid\n`);
        } else {
          if (errors.length > 0) {
            console.log(`   ❌ ${errors.length} error(s)`);
          }
          if (warnings.length > 0) {
            console.log(`   ⚠️  ${warnings.length} warning(s)`);
          }
          console.log('');
        }
      } catch (error) {
        console.error(`   ❌ Failed to parse: ${error.message}\n`);
        allErrors.push({
          spec: specName,
          rule: 'parse-error',
          message: error.message,
          severity: 'error'
        });
      }
    }

    // Summary
    console.log('─'.repeat(60));
    console.log('📊 Summary\n');

    if (allErrors.length > 0) {
      console.log('❌ Errors:\n');
      for (const error of allErrors) {
        console.log(`   [${error.spec}] ${error.rule}`);
        console.log(`   ${error.message}`);
        if (error.path) {
          console.log(`   Path: ${error.path}`);
        }
        console.log('');
      }
    }

    if (allWarnings.length > 0) {
      console.log('⚠️  Warnings:\n');
      for (const warning of allWarnings) {
        console.log(`   [${warning.spec}] ${warning.rule}`);
        console.log(`   ${warning.message}`);
        if (warning.path) {
          console.log(`   Path: ${warning.path}`);
        }
        console.log('');
      }
    }

    if (allErrors.length === 0 && allWarnings.length === 0) {
      console.log('✅ All API design patterns are valid!\n');
    }

    console.log(`Total: ${allErrors.length} error(s), ${allWarnings.length} warning(s)`);

    if (allErrors.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Validation failed:', error.message);
    process.exit(1);
  }
}

main();
