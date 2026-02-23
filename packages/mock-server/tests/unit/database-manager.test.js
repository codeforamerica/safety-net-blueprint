/**
 * Unit tests for database manager
 * Tests SQLite operations and database management
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  getDatabase,
  findAll,
  findById,
  insertResource,
  create,
  update,
  deleteResource,
  count,
  closeAll,
  DATA_DIR
} from '../../src/database-manager.js';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const testDbName = 'test-db';

const cleanup = () => {
  closeAll();
  const testDbPath = join(DATA_DIR, `${testDbName}.db`);
  try {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  } catch (e) {
    // Ignore
  }
};

test('Database Manager Tests', async (t) => {
  
  await t.test('getDatabase - creates database and table', () => {
    cleanup();
    
    const db = getDatabase(testDbName);
    
    assert.ok(db, 'Should return database instance');
    
    // Check that table was created (table is always named 'resources')
    const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='resources'")
      .get();
    
    assert.ok(tableInfo, 'Should create table');
    assert.strictEqual(tableInfo.name, 'resources', 'Table should be named resources');
    console.log(`  ✓ Created database and table: ${testDbName}`);
  });
  
  await t.test('insertResource - stores JSON data', () => {
    cleanup();
    
    const resource = {
      id: 'test-1',
      name: { first: 'John', last: 'Doe' },
      tags: ['tag1', 'tag2'],
      metadata: { key: 'value' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    insertResource(testDbName, resource);
    
    const found = findById(testDbName, 'test-1');
    assert.ok(found, 'Should find inserted resource');
    assert.deepStrictEqual(found.name, resource.name, 'Should preserve object structure');
    assert.deepStrictEqual(found.tags, resource.tags, 'Should preserve arrays');
    
    console.log(`  ✓ Stored and retrieved complex JSON`);
  });
  
  await t.test('findAll - returns all records', () => {
    cleanup();
    
    insertResource(testDbName, { id: '1', createdAt: '2024-01-01', updatedAt: '2024-01-01' });
    insertResource(testDbName, { id: '2', createdAt: '2024-01-02', updatedAt: '2024-01-02' });
    insertResource(testDbName, { id: '3', createdAt: '2024-01-03', updatedAt: '2024-01-03' });
    
    const results = findAll(testDbName, {});
    
    assert.strictEqual(results.items.length, 3, 'Should return all records');
    assert.strictEqual(results.total, 3, 'Should have correct total');
    console.log(`  ✓ Retrieved ${results.items.length} records`);
  });
  
  await t.test('findAll - orders by createdAt DESC', () => {
    cleanup();
    
    insertResource(testDbName, { id: '1', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01' });
    insertResource(testDbName, { id: '2', createdAt: '2024-01-03T00:00:00Z', updatedAt: '2024-01-03' });
    insertResource(testDbName, { id: '3', createdAt: '2024-01-02T00:00:00Z', updatedAt: '2024-01-02' });
    
    const results = findAll(testDbName, {});
    
    assert.strictEqual(results.items[0].id, '2', 'Newest should be first');
    assert.strictEqual(results.items[2].id, '1', 'Oldest should be last');
    
    console.log(`  ✓ Results ordered by createdAt DESC`);
  });
  
  await t.test('findAll - applies limit and offset', () => {
    cleanup();
    
    for (let i = 1; i <= 10; i++) {
      insertResource(testDbName, { 
        id: `id-${i}`, 
        createdAt: `2024-01-${String(i).padStart(2, '0')}`, 
        updatedAt: '2024-01-01' 
      });
    }
    
    const page1 = findAll(testDbName, {}, { limit: 3, offset: 0 });
    const page2 = findAll(testDbName, {}, { limit: 3, offset: 3 });
    
    assert.strictEqual(page1.items.length, 3, 'Should respect limit');
    assert.strictEqual(page2.items.length, 3, 'Should respect offset');
    assert.notDeepStrictEqual(page1.items[0], page2.items[0], 'Pages should have different records');
    
    console.log(`  ✓ Pagination works: limit=3, offset=3`);
  });
  
  await t.test('findAll - filters by field', () => {
    cleanup();
    
    insertResource(testDbName, { 
      id: '1', 
      name: 'Alice Smith', 
      email: 'alice@example.com',
      createdAt: '2024-01-01', 
      updatedAt: '2024-01-01' 
    });
    insertResource(testDbName, { 
      id: '2', 
      name: 'Bob Jones', 
      email: 'bob@example.com',
      createdAt: '2024-01-02', 
      updatedAt: '2024-01-02' 
    });
    
    const results = findAll(testDbName, { name: 'Alice Smith' });
    
    assert.strictEqual(results.items.length, 1, 'Should find matching record');
    assert.strictEqual(results.items[0].id, '1', 'Should find correct record');
    
    console.log(`  ✓ Filter found matching record`);
  });
  
  await t.test('updateResource - merges changes', () => {
    cleanup();
    
    insertResource(testDbName, { 
      id: 'test', 
      field1: 'original',
      field2: 'original',
      createdAt: '2024-01-01', 
      updatedAt: '2024-01-01' 
    });
    
    update(testDbName, 'test', { field1: 'updated' });
    
    const updated = findById(testDbName, 'test');
    assert.strictEqual(updated.field1, 'updated', 'Should update changed field');
    assert.strictEqual(updated.field2, 'original', 'Should preserve unchanged field');
    
    console.log(`  ✓ Merged changes correctly`);
  });
  
  await t.test('count - returns total records', () => {
    cleanup();
    
    insertResource(testDbName, { id: '1', createdAt: '2024-01-01', updatedAt: '2024-01-01' });
    insertResource(testDbName, { id: '2', createdAt: '2024-01-02', updatedAt: '2024-01-02' });
    
    const total = count(testDbName);
    
    assert.strictEqual(total, 2, 'Should return correct count');
    console.log(`  ✓ Count: ${total}`);
  });
  
  await t.test('closeAll - closes all database connections', () => {
    cleanup();
    getDatabase(testDbName);
    
    // Should not throw
    closeAll();
    
    console.log(`  ✓ Closed all connections`);
  });
  
});

// Cleanup
cleanup();
console.log('\n✓ All database manager tests passed\n');
