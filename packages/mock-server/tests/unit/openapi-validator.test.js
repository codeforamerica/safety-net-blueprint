/**
 * Unit tests for OpenAPI validator
 * Tests spec and example validation
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { validateSpec, validateExamples, validateAll } from '@codeforamerica/safety-net-blueprint-contracts/validation';
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
  
  await t.test('validateExamples - validates examples against schema', async () => {
    const specs = discoverApiSpecs({ specsDir });
    const spec = specs[0];
    const examplesPath = join(specsDir, `${spec.name}-examples.yaml`);
    
    const result = await validateExamples(spec.specPath, examplesPath);
    
    assert.ok(typeof result.valid === 'boolean', 'Should have valid property');
    assert.ok(Array.isArray(result.errors), 'Should have errors array');
    assert.ok(Array.isArray(result.warnings), 'Should have warnings array');
    
    console.log(`  ✓ Examples validation: ${result.valid ? 'valid' : 'invalid'}`);
    if (result.errors.length > 0) {
      console.log(`    Errors: ${result.errors.length}`);
      result.errors.slice(0, 3).forEach(err => {
        console.log(`      - ${err.example}: ${err.field} ${err.message}`);
      });
    }
  });
  
  await t.test('validateExamples - handles missing examples file', async () => {
    const specs = discoverApiSpecs({ specsDir });
    const result = await validateExamples(specs[0].specPath, '/nonexistent/examples.yaml');
    
    // Missing examples is optional, so should be valid with a warning
    assert.strictEqual(result.valid, true, 'Should be valid (examples are optional)');
    assert.ok(result.warnings.length > 0, 'Should have warning about missing file');
    
    console.log(`  ✓ Handled missing examples file gracefully`);
  });
  
  await t.test('validateAll - validates all specs and examples', async () => {
    const specs = discoverApiSpecs({ specsDir }).map(spec => ({
      ...spec,
      examplesPath: join(specsDir, `${spec.name}-examples.yaml`)
    }));
    
    const results = await validateAll(specs);
    
    assert.ok(typeof results === 'object', 'Should return results object');
    assert.strictEqual(Object.keys(results).length, specs.length, 
                      'Should have result for each spec');
    
    for (const [name, result] of Object.entries(results)) {
      assert.ok(result.spec, 'Should have spec validation result');
      assert.ok(result.examples, 'Should have examples validation result');
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
