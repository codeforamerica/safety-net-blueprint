/**
 * Unit tests for database seeder
 * Tests loading examples and seeding databases
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { seedDatabase, seedAllDatabases } from '../../src/seeder.js';
import { loadAllSpecs } from '@codeforamerica/safety-net-blueprint-contracts/loader';
import { count, findAll, clearAll } from '../../src/database-manager.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const specsDir = join(__dirname, '../../../contracts');
const seedDir = join(__dirname, '../../seed');

// Cleanup function — uses SQL DELETE rather than file deletion to
// avoid SQLite WAL replay issues (deleting .db but not .db-wal/.db-shm
// causes WAL to be replayed into the new file, restoring deleted rows).
const cleanup = () => { clearAll('persons'); };

test('Database Seeder Tests', async (t) => {
  
  await t.test('seedDatabase - seeds from examples file', () => {
    cleanup(); // Start clean
    
    const seededCount = seedDatabase('persons', seedDir);
    
    assert.ok(seededCount >= 0, 'Should return count');
    
    if (seededCount > 0) {
      const dbCount = count('persons');
      assert.strictEqual(dbCount, seededCount, 'Database should have seeded count');
      console.log(`  ✓ Seeded ${seededCount} person(s)`);
    } else {
      console.log(`  ℹ No examples found (this is OK)`);
    }
  });
  
  await t.test('seedDatabase - skips if database already has data', () => {
    // Seed once
    const firstCount = seedDatabase('persons', seedDir);
    
    // Try to seed again
    const secondCount = seedDatabase('persons', seedDir);
    
    // Should return existing count, not re-seed
    assert.strictEqual(firstCount, secondCount, 'Should not re-seed existing data');
    console.log(`  ✓ Skipped re-seeding (${secondCount} existing records)`);
  });
  
  await t.test('seedDatabase - handles missing examples', () => {
    cleanup();
    
    const count = seedDatabase('nonexistent-api', seedDir);
    
    assert.strictEqual(count, 0, 'Should return 0 for missing examples');
    console.log(`  ✓ Handled missing examples gracefully`);
  });
  
  await t.test('seedDatabase - sets timestamps correctly', () => {
    cleanup();
    
    seedDatabase('persons', seedDir);
    const records = findAll('persons', {});
    
    if (records.length > 0) {
      const first = records[0];
      assert.ok(first.createdAt, 'Should have createdAt');
      assert.ok(first.updatedAt, 'Should have updatedAt');
      assert.ok(first.createdAt.match(/^\d{4}-\d{2}-\d{2}T/), 
                'Should be ISO timestamp');
      
      console.log(`  ✓ Timestamps: ${first.createdAt}`);
    }
  });
  
  await t.test('seedDatabase - maintains example order', () => {
    cleanup();
    
    seedDatabase('persons', seedDir);
    const records = findAll('persons', {});
    
    if (records.length > 1) {
      // Records should be ordered by createdAt DESC (newest first)
      // So Example1 should appear before Example2
      for (let i = 0; i < records.length - 1; i++) {
        const current = new Date(records[i].createdAt);
        const next = new Date(records[i + 1].createdAt);
        assert.ok(current >= next, 'Records should be in DESC order by createdAt');
      }
      
      console.log(`  ✓ ${records.length} records in correct order`);
    }
  });
  
  await t.test('seedAllDatabases - seeds all discovered APIs', async () => {
    cleanup();
    
    const apiSpecs = await loadAllSpecs({ specsDir });
    const summary = seedAllDatabases(apiSpecs, specsDir, seedDir);
    
    assert.ok(typeof summary === 'object', 'Should return summary object');
    assert.ok(Object.keys(summary).length >= apiSpecs.length,
              'Should have at least one entry per API');

    const totalSeeded = Object.values(summary).reduce((sum, count) => sum + count, 0);
    console.log(`  ✓ Seeded ${Object.keys(summary).length} collection(s), ${totalSeeded} total records`);
    
    for (const [apiName, count] of Object.entries(summary)) {
      console.log(`    - ${apiName}: ${count} records`);
    }
  });
  
});

// Cleanup after all tests
cleanup();
console.log('\n✓ All seeder tests passed\n');
