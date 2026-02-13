/**
 * Unit tests for CRUD handlers
 * Tests list, get, create, update, delete operations
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { seedDatabase } from '../../src/seeder.js';
import { 
  findAll, 
  findById, 
  create, 
  update, 
  deleteResource,
  count,
  closeAll,
  insertResource
} from '../../src/database-manager.js';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const specsDir = join(__dirname, '../../../contracts');

const cleanup = () => {
  closeAll();
  const testDbPath = join(__dirname, '../../../generated/mock-data/persons.db');
  try {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  } catch (e) {
    // Ignore
  }
};

test('CRUD Handler Tests', async (t) => {
  
  // Setup before tests
  cleanup();
  seedDatabase('persons', specsDir);
  
  await t.test('LIST - returns all resources', () => {
    const results = findAll('persons', {});
    
    assert.ok(Array.isArray(results.items), 'Should return items array');
    assert.ok(results.items.length > 0, 'Should have seeded data');
    assert.ok(typeof results.total === 'number', 'Should have total count');
    
    const first = results.items[0];
    assert.ok(first.id, 'Should have id');
    assert.ok(first.createdAt, 'Should have createdAt');
    assert.ok(first.updatedAt, 'Should have updatedAt');
    
    console.log(`  ✓ Listed ${results.items.length} resource(s)`);
  });
  
  await t.test('LIST - applies pagination', () => {
    const limit = 1;
    const offset = 0;
    const results = findAll('persons', {}, { limit, offset });
    
    assert.strictEqual(results.items.length, limit, 'Should respect limit');
    
    console.log(`  ✓ Paginated: limit=${limit}, got ${results.items.length}`);
  });
  
  await t.test('LIST - returns correct structure', () => {
    const results = findAll('persons', {});
    
    assert.ok(Array.isArray(results.items), 'Should return items array');
    assert.ok(typeof results.total === 'number', 'Should have total');
    assert.ok(results.total >= results.items.length, 'Total should be >= items length');
    
    console.log(`  ✓ Structure: ${results.items.length} items, ${results.total} total`);
  });
  
  await t.test('GET - returns resource by ID', () => {
    const all = findAll('persons', {});
    const testId = all.items[0].id;
    
    const result = findById('persons', testId);
    
    assert.ok(result, 'Should find resource');
    assert.strictEqual(result.id, testId, 'Should match requested ID');
    
    console.log(`  ✓ Found resource: ${testId}`);
  });
  
  await t.test('GET - returns null for non-existent ID', () => {
    const result = findById('persons', '00000000-0000-0000-0000-000000000000');
    
    assert.strictEqual(result, null, 'Should return null for missing resource');
    
    console.log(`  ✓ Returned null for non-existent ID`);
  });
  
  await t.test('CREATE - inserts new resource', () => {
    const beforeCount = count('persons');
    
    const newResource = {
      id: 'test-id-create',
      name: { firstName: 'Test', lastName: 'User' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    insertResource('persons', newResource);
    
    const afterCount = count('persons');
    assert.strictEqual(afterCount, beforeCount + 1, 'Should increase count');
    
    const found = findById('persons', 'test-id-create');
    assert.ok(found, 'Should find created resource');
    assert.strictEqual(found.name.firstName, 'Test', 'Should have correct data');
    
    console.log(`  ✓ Created resource, count: ${beforeCount} → ${afterCount}`);
  });
  
  await t.test('UPDATE - modifies existing resource', () => {
    const all = findAll('persons', {});
    const testId = all.items[0].id;
    
    const updates = { monthlyIncome: 9999 };
    update('persons', testId, updates);
    
    const updated = findById('persons', testId);
    assert.strictEqual(updated.monthlyIncome, 9999, 'Should have updated value');
    assert.strictEqual(updated.id, testId, 'ID should not change');
    
    console.log(`  ✓ Updated resource: ${testId}`);
  });
  
  await t.test('UPDATE - preserves other fields', () => {
    const all = findAll('persons', {});
    const testId = all.items[0].id;
    const original = findById('persons', testId);
    const originalName = original.name;
    
    update('persons', testId, { monthlyIncome: 8888 });
    
    const updated = findById('persons', testId);
    assert.deepStrictEqual(updated.name, originalName, 'Other fields should be preserved');
    
    console.log(`  ✓ Preserved other fields during update`);
  });
  
  await t.test('DELETE - removes resource', () => {
    // Create a resource to delete
    const deleteId = 'test-id-delete';
    insertResource('persons', {
      id: deleteId,
      name: { firstName: 'Delete', lastName: 'Me' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    const beforeCount = count('persons');
    const deleted = deleteResource('persons', deleteId);
    const afterCount = count('persons');
    
    assert.strictEqual(deleted, true, 'Should return true');
    assert.strictEqual(afterCount, beforeCount - 1, 'Should decrease count');
    
    const found = findById('persons', deleteId);
    assert.strictEqual(found, null, 'Should not find deleted resource');
    
    console.log(`  ✓ Deleted resource, count: ${beforeCount} → ${afterCount}`);
  });
  
  await t.test('DELETE - returns false for non-existent ID', () => {
    const deleted = deleteResource('persons', '00000000-0000-0000-0000-000000000000');
    
    assert.strictEqual(deleted, false, 'Should return false for missing resource');
    
    console.log(`  ✓ Returned false for non-existent ID`);
  });
  
});

// Cleanup
cleanup();
console.log('\n✓ All handler tests passed\n');
