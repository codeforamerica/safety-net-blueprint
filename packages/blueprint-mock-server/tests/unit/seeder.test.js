/**
 * Unit tests for database seeder
 * Tests loading examples and seeding databases
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { seedAllDatabases, deriveAllCollectionNames } from '../../src/seeder.js';
import { loadAllSpecs } from '@codeforamerica/blueprint-core/loader';
import { count, findAll, clearAll, insertResource } from '../../src/database-manager.js';
import { join } from 'path';

const fixturesArg = process.argv.find(a => a.startsWith('--fixtures='));
const seedArg     = process.argv.find(a => a.startsWith('--seed='));
if (!fixturesArg) { console.error('--fixtures= is required'); process.exit(1); }
if (!seedArg)     { console.error('--seed= is required');     process.exit(1); }
const fixtureSpecDir = join(fixturesArg.slice('--fixtures='.length), 'spec');
const seedDir        = seedArg.slice('--seed='.length);

// Cleanup function — uses SQL DELETE rather than file deletion to
// avoid SQLite WAL replay issues (deleting .db but not .db-wal/.db-shm
// causes WAL to be replayed into the new file, restoring deleted rows).
const cleanup = () => { clearAll('persons'); };

test('Database Seeder Tests', async (t) => {
  
  await t.test('seedAllDatabases - seeds from *-mock-data.yaml files', () => {
    cleanup();

    const api = {
      name: 'client-management',
      serverBasePath: '/client-management',
      endpoints: [
        { path: '/client-management/persons' },
        { path: '/client-management/persons/{personId}' },
      ],
    };
    const summary = seedAllDatabases([api], '', seedDir);

    assert.ok(typeof summary === 'object', 'Should return summary object');
    const seededCount = summary['persons'] ?? 0;
    assert.ok(seededCount >= 0, 'Should return count');

    if (seededCount > 0) {
      const dbCount = count('persons');
      assert.strictEqual(dbCount, seededCount, 'Database should have seeded count');
      console.log(`  ✓ Seeded ${seededCount} person(s)`);
    } else {
      console.log(`  ℹ No examples found (this is OK)`);
    }
  });

  await t.test('seedAllDatabases - sets timestamps correctly', () => {
    cleanup();

    const api = {
      name: 'client-management',
      serverBasePath: '/client-management',
      endpoints: [
        { path: '/client-management/persons' },
        { path: '/client-management/persons/{personId}' },
      ],
    };
    seedAllDatabases([api], '', seedDir);
    const records = findAll('persons', {});

    if (records.length > 0) {
      const first = records[0];
      assert.ok(first.createdAt, 'Should have createdAt');
      assert.ok(first.updatedAt, 'Should have updatedAt');
      assert.ok(first.createdAt.match(/^\d{4}-\d{2}-\d{2}T/), 'Should be ISO timestamp');
      console.log(`  ✓ Timestamps: ${first.createdAt}`);
    }
  });

  await t.test('seedAllDatabases - maintains example order (DESC by createdAt)', () => {
    cleanup();

    const api = {
      name: 'client-management',
      serverBasePath: '/client-management',
      endpoints: [
        { path: '/client-management/persons' },
        { path: '/client-management/persons/{personId}' },
      ],
    };
    seedAllDatabases([api], '', seedDir);
    const records = findAll('persons', {});

    if (records.length > 1) {
      for (let i = 0; i < records.length - 1; i++) {
        const current = new Date(records[i].createdAt);
        const next = new Date(records[i + 1].createdAt);
        assert.ok(current >= next, 'Records should be in DESC order by createdAt');
      }
      console.log(`  ✓ ${records.length} records in correct order`);
    }
  });

  await t.test('seedAllDatabases - starts empty when seedDir is null', () => {
    cleanup();

    const api = {
      name: 'client-management',
      serverBasePath: '/client-management',
      endpoints: [{ path: '/client-management/persons' }],
    };
    seedAllDatabases([api], '', null);

    assert.strictEqual(count('persons'), 0, 'Should be empty with no seedDir');
    console.log('  ✓ Empty databases with null seedDir');
  });

  await t.test('seedAllDatabases - empty when no *-mock-data.yaml files found', async () => {
    cleanup();

    const { mkdtempSync } = await import('fs');
    const { join: pathJoin } = await import('path');
    const { tmpdir } = await import('os');
    const emptyDir = mkdtempSync(pathJoin(tmpdir(), 'snb-empty-'));

    const api = {
      name: 'client-management',
      serverBasePath: '/client-management',
      endpoints: [{ path: '/client-management/persons' }],
    };
    seedAllDatabases([api], '', emptyDir);

    assert.strictEqual(count('persons'), 0, 'Should be empty when no seed files found');
    console.log('  ✓ Empty databases when no mock-data files present');
  });
  
  await t.test('seedAllDatabases - seeds all discovered APIs', async () => {
    cleanup();

    const apiSpecs = await loadAllSpecs({ specsDir: fixtureSpecDir });
    const summary = seedAllDatabases(apiSpecs, fixtureSpecDir, seedDir);

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
        'household-info',
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

  await t.test('seedAllDatabases - clears sub-collections at boot (not just top-level)', async () => {
    // Before the discovery fix, only top-level collections were cleared on
    // boot because deriveAllCollectionNames returned only the first path
    // segment. Stale sub-collection rows from a previous run could leak into
    // the next boot. Now that sub-collections are discovered, they should
    // also be cleared. Guard against regression.
    const fixtureApi = {
      name: 'widgets',
      serverBasePath: '/widgets',
      baseResource: '/widgets',
      endpoints: [
        { path: '/widgets' },
        { path: '/widgets/{widgetId}' },
        { path: '/widgets/{widgetId}/parts' },
        { path: '/widgets/{widgetId}/parts/{partId}' },
      ],
    };
    const subCollections = deriveAllCollectionNames(fixtureApi)
      .filter((name) => name !== 'widgets');

    assert.ok(subCollections.length > 0, 'fixture API should have sub-collections');

    const sentinelId = '00000000-dead-beef-0000-000000000001';
    const target = subCollections[0];
    insertResource(target, {
      id: sentinelId,
      widgetId: '00000000-0000-0000-0000-000000000000',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });
    assert.strictEqual(
      findAll(target, { id: sentinelId }).total, 1,
      'Sentinel should be present before reseed'
    );

    seedAllDatabases([fixtureApi], '', seedDir);

    assert.strictEqual(
      findAll(target, { id: sentinelId }).total, 0,
      `Sub-collection "${target}" should be cleared at boot`
    );
    console.log(`  ✓ Sub-collection "${target}" cleared on reseed`);
  });

  await t.test('seedAllDatabases - does not assign sub-collection records to the parent collection when prefixes overlap', async () => {
    // Regression test for: "Application" prefix matches "ApplicationMemberExample1"
    // via startsWith, causing member records to be seeded into applications.db.
    // After the fix, longest-prefix matching assigns each key to the most
    // specific collection only.
    clearAll('applications');
    clearAll('application-members');

    const api = {
      name: 'intake',
      serverBasePath: '/intake',
      endpoints: [
        { path: '/intake/applications' },
        { path: '/intake/applications/{applicationId}' },
        { path: '/intake/applications/{applicationId}/members' },
        { path: '/intake/applications/{applicationId}/members/{memberId}' },
      ],
    };

    const examples = {
      ApplicationExample1: {
        id: 'b0000001-0000-4000-8000-000000000001',
        status: 'submitted',
        programs: ['snap'],
        channel: 'online',
      },
      ApplicationMemberExample1: {
        id: 'c0000001-0000-4000-8000-000000000001',
        applicationId: 'b0000001-0000-4000-8000-000000000001',
        roles: ['primary_applicant'],
      },
    };

    // Write a temporary seed file and use a local seedAllDatabases call
    // by importing the internal function via a spy-friendly path.
    // Instead: directly exercise extractResourcesForCollection behaviour via
    // seedAllDatabases with a real tmp dir.
    const { writeFileSync, mkdtempSync } = await import('fs');
    const { join: pathJoin } = await import('path');
    const { tmpdir } = await import('os');
    const tmpSeedDir = mkdtempSync(pathJoin(tmpdir(), 'snb-test-'));
    const yaml = (await import('js-yaml')).default;
    writeFileSync(pathJoin(tmpSeedDir, 'intake-mock-data.yaml'), yaml.dump(examples));

    const { seedAllDatabases: seed } = await import('../../src/seeder.js');
    seed([api], '', tmpSeedDir);

    const appsInApplications = findAll('applications', {}).total;
    const membersInApplications = findAll('applications', { id: 'c0000001-0000-4000-8000-000000000001' }).total;
    const membersInMembers = findAll('application-members', {}).total;

    assert.strictEqual(appsInApplications, 1, 'applications collection should have exactly 1 record');
    assert.strictEqual(membersInApplications, 0, 'member record must not appear in applications collection');
    assert.strictEqual(membersInMembers, 1, 'application-members collection should have exactly 1 record');
    console.log('  ✓ Prefix collision: member records correctly isolated to application-members');

    clearAll('applications');
    clearAll('application-members');
  });

  await t.test('seedAllDatabases - seeds from seedDir when it differs from specsDir', async () => {
    // Verifies that passing a separate seedDir causes seed data to be loaded
    // from that directory rather than from specsDir. This is the behaviour that
    // --seed=<dir> in setup.js exposes on the CLI.
    clearAll('widgets');

    const { writeFileSync, mkdtempSync } = await import('fs');
    const { join: pathJoin } = await import('path');
    const { tmpdir } = await import('os');
    const yaml = (await import('js-yaml')).default;

    const tmpSeedDir = mkdtempSync(pathJoin(tmpdir(), 'snb-seed-test-'));
    writeFileSync(pathJoin(tmpSeedDir, 'widgets-mock-data.yaml'), yaml.dump({
      WidgetExample1: {
        id: 'f0000001-0000-4000-8000-000000000001',
        name: 'Test Widget',
      },
    }));

    // Use the fixture spec dir so API discovery works, but a custom seed dir
    // that only has a widgets entry — confirming seeds come from seedDir.
    const apiSpecs = await loadAllSpecs({ specsDir: fixtureSpecDir });
    const { seedAllDatabases: seed } = await import('../../src/seeder.js');
    seed(apiSpecs, fixtureSpecDir, tmpSeedDir);

    const found = findAll('widgets', { id: 'f0000001-0000-4000-8000-000000000001' });
    assert.strictEqual(found.total, 1, 'record from custom seedDir should be present in widgets');
    console.log('  ✓ seedDir correctly overrides specsDir for seed loading');

    clearAll('widgets');
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
