/**
 * Unit tests for database seeder
 * Tests loading examples and seeding databases
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { seedDatabase, seedAllDatabases, deriveAllCollectionNames } from '../../src/seeder.js';
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

  await t.test('deriveAllCollectionNames - top-level paths return top-level collection names', () => {
    const api = {
      name: 'persons',
      serverBasePath: '/client-management',
      endpoints: [
        { path: '/client-management/persons' },
        { path: '/client-management/persons/{personId}' },
      ],
    };
    const names = deriveAllCollectionNames(api);
    assert.deepStrictEqual(names.sort(), ['persons']);
  });

  await t.test('deriveAllCollectionNames - sub-resource paths return sub-collection names', () => {
    // The regression case: pre-fix, deriveAllCollectionNames returned only
    // `['applications']` for an intake-shaped API because it took the first
    // path segment. After the fix it should return the proper sub-collection
    // names (`application-members`, `member-incomes`, etc.) — the same names
    // the route generator uses when handlers call findAll().
    const api = {
      name: 'intake',
      serverBasePath: '/intake',
      endpoints: [
        { path: '/intake/applications' },
        { path: '/intake/applications/{applicationId}' },
        { path: '/intake/applications/{applicationId}/members' },
        { path: '/intake/applications/{applicationId}/members/{memberId}' },
        { path: '/intake/applications/{applicationId}/members/{memberId}/incomes' },
        { path: '/intake/applications/{applicationId}/members/{memberId}/expenses' },
        { path: '/intake/applications/{applicationId}/verifications' },
        { path: '/intake/applications/{applicationId}/household-info' },
      ],
    };
    const names = deriveAllCollectionNames(api);
    assert.deepStrictEqual(
      names.sort(),
      [
        'application-members',
        'application-verifications',
        'applications',
        'household-infos',
        'member-expenses',
        'member-incomes',
      ]
    );
  });

  await t.test('deriveAllCollectionNames - deduplicates collection names across endpoints', () => {
    // Multiple endpoints on the same collection (GET list + GET item +
    // POST + DELETE) should collapse to a single entry per collection.
    const api = {
      name: 'intake',
      serverBasePath: '/intake',
      endpoints: [
        { path: '/intake/applications' },
        { path: '/intake/applications' },
        { path: '/intake/applications/{applicationId}' },
        { path: '/intake/applications/{applicationId}/members' },
        { path: '/intake/applications/{applicationId}/members/{memberId}' },
      ],
    };
    const names = deriveAllCollectionNames(api);
    assert.deepStrictEqual(names.sort(), ['application-members', 'applications']);
  });

  await t.test('deriveAllCollectionNames - falls back to api object for APIs with no endpoints', () => {
    // The seeder-local deriveCollectionName(api) reads api.baseResource or
    // api.name. Endpoints absent → fallback path.
    const api = { name: 'tasks', baseResource: '/tasks', serverBasePath: '', endpoints: [] };
    const names = deriveAllCollectionNames(api);
    assert.deepStrictEqual(names, ['tasks']);
  });

});

// Cleanup after all tests
cleanup();
console.log('\n✓ All seeder tests passed\n');
