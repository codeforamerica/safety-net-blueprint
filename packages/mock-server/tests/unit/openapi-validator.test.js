/**
 * Unit tests for OpenAPI validator
 * Tests spec and example validation
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { validateSpec, validateAll } from '@codeforamerica/safety-net-blueprint-contracts/validation';
import { discoverApiSpecs } from '@codeforamerica/safety-net-blueprint-contracts/loader';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const specsDir = join(__dirname, '../../../contracts');

test('OpenAPI Validator Tests', async (t) => {

  await t.test('validateSpec - validates OpenAPI spec', async () => {
    const specs = discoverApiSpecs({ specsDir });
    assert.ok(specs.length > 0, 'Need at least one spec to test');
    
    const result = await validateSpec(specs[0].specPath);
    
    assert.ok(typeof result.valid === 'boolean', 'Should have valid property');
    assert.ok(Array.isArray(result.errors), 'Should have errors array');
    assert.ok(Array.isArray(result.warnings), 'Should have warnings array');
    
    console.log(`  ✓ Validation result: ${result.valid ? 'valid' : 'invalid'}`);
    if (result.errors.length > 0) {
      console.log(`    Errors: ${result.errors.length}`);
    }
    if (result.warnings.length > 0) {
      console.log(`    Warnings: ${result.warnings.length}`);
    }
  });
  
  await t.test('validateSpec - detects missing file', async () => {
    const result = await validateSpec('/nonexistent/spec.yaml');
    
    assert.strictEqual(result.valid, false, 'Should be invalid');
    assert.ok(result.errors.length > 0, 'Should have errors');
    assert.ok(result.errors[0].message.includes('does not exist'), 
              'Error should mention missing file');
    
    console.log(`  ✓ Detected missing file`);
  });
  
  await t.test('validateAll - validates all specs', async () => {
    const specs = discoverApiSpecs({ specsDir });

    const results = await validateAll(specs);

    assert.ok(typeof results === 'object', 'Should return results object');
    assert.strictEqual(Object.keys(results).length, specs.length,
                      'Should have result for each spec');

    for (const [name, result] of Object.entries(results)) {
      assert.ok(result.spec, 'Should have spec validation result');
      assert.ok(typeof result.valid === 'boolean', 'Should have overall valid flag');
    }

    const validCount = Object.values(results).filter(r => r.valid).length;
    console.log(`  ✓ Validated ${specs.length} API(s), ${validCount} valid`);
  });
  
  await t.test('validation errors have required structure', async () => {
    const specs = discoverApiSpecs({ specsDir });
    const result = await validateSpec('/nonexistent.yaml');
    
    assert.ok(result.errors.length > 0, 'Should have errors');
    const error = result.errors[0];
    
    assert.ok(error.type, 'Error should have type');
    assert.ok(error.path, 'Error should have path');
    assert.ok(error.message, 'Error should have message');
    
    console.log(`  ✓ Error structure: ${error.type} - ${error.message}`);
  });
  
});

console.log('\n✓ All OpenAPI validator tests passed\n');
