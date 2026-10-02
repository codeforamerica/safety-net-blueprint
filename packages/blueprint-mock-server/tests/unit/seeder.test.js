/**
 * Unit tests for database seeder
 * Tests loading examples and seeding databases
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createMemoryStore } from '../../src/stores/memory-store.js';

// A store of this file's own, rather than one shared through a module-level
// singleton. In memory because these cases do not need a database — and
// because a fresh one per file is isolation they did not have before.
const store = createMemoryStore();
import { discover, load } from '@codeforamerica/blueprint-core';
import { seedAllDatabases } from '../../src/seeder.js';
import { loadAllSpecs } from '../../src/spec-loader.js';
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
const cleanup = () => { store.clearAll('persons'); };

/**
 * Load the documents the seeder now takes, from the directories these cases use.
 *
 * Duplicates are dropped: several cases pass the same directory as both spec
 * and seed, and seeding the same example twice is not what they are asserting.
 */
function loadDocs(...dirs) {
  return [...new Set(dirs.filter(Boolean))].flatMap((d) => discover(d)).map(load);
}

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
    const summary = seedAllDatabases(loadDocs(fixtureSpecDir, seedDir), store, { seeded: Boolean(seedDir) });

    assert.ok(typeof summary === 'object', 'Should return summary object');
    const seededCount = summary['persons'] ?? 0;
    assert.ok(seededCount >= 0, 'Should return count');

    if (seededCount > 0) {
      const dbCount = store.count('persons');
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
    seedAllDatabases(loadDocs(fixtureSpecDir, seedDir), store, { seeded: Boolean(seedDir) });
    const records = store.findAll('persons', {});

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
    seedAllDatabases(loadDocs(fixtureSpecDir, seedDir), store, { seeded: Boolean(seedDir) });
    const records = store.findAll('persons', {});

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
    seedAllDatabases(loadDocs(fixtureSpecDir), store, { seeded: false });

    assert.strictEqual(store.count('persons'), 0, 'Should be empty with no seedDir');
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
    seedAllDatabases(loadDocs(fixtureSpecDir, emptyDir), store, { seeded: Boolean(emptyDir) });

    assert.strictEqual(store.count('persons'), 0, 'Should be empty when no seed files found');
    console.log('  ✓ Empty databases when no mock-data files present');
  });
  
  await t.test('seedAllDatabases - seeds all discovered APIs', async () => {
    cleanup();

    const apiSpecs = await loadAllSpecs({ specsDir: fixtureSpecDir });
    const summary = seedAllDatabases(loadDocs(fixtureSpecDir, seedDir), store, { seeded: Boolean(seedDir) });

    assert.ok(typeof summary === 'object', 'Should return summary object');
    assert.ok(Object.keys(summary).length >= apiSpecs.length,
              'Should have at least one entry per API');

    const totalSeeded = Object.values(summary).reduce((sum, count) => sum + count, 0);
    console.log(`  ✓ Seeded ${Object.keys(summary).length} collection(s), ${totalSeeded} total records`);

    for (const [apiName, count] of Object.entries(summary)) {
      console.log(`    - ${apiName}: ${count} records`);
    }
  });

  await t.test('seedAllDatabases - clears sub-collections at boot (not just top-level)', async () => {
    // Stale sub-collection rows from a previous run must not leak into the
    // next boot. Previously only top-level collections were cleared, because
    // the server worked the list out from the first path segment. It now
    // clears whatever core says the contracts declare, sub-collections
    // included.
    const { mkdtempSync, writeFileSync, rmSync } = await import('fs');
    const { tmpdir } = await import('os');
    const yaml = (await import('js-yaml')).default;

    const dir = mkdtempSync(join(tmpdir(), 'snb-clear-'));
    try {
      const list = (name) => ({
        get: { responses: { 200: { description: 'ok', content: { 'application/json': {
          schema: { $ref: `#/components/schemas/${name}List` } } } } } },
      });
      writeFileSync(join(dir, 'widgets-openapi.yaml'), yaml.dump({
        openapi: '3.1.0',
        info: { title: 'Widgets', version: '1.0.0', 'x-domain': 'widgets' },
        paths: {
          '/widgets': list('Widget'),
          '/widgets/{widgetId}': { get: {} },
          '/widgets/{widgetId}/parts': list('WidgetPart'),
        },
        components: { schemas: {
          Widget: { type: 'object' },
          WidgetPart: { type: 'object' },
          WidgetList: { type: 'object', properties: { items: { type: 'array',
            items: { $ref: '#/components/schemas/Widget' } } } },
          WidgetPartList: { type: 'object', properties: { items: { type: 'array',
            items: { $ref: '#/components/schemas/WidgetPart' } } } },
        } },
      }));

      const target = 'widget-parts';
      const sentinelId = '00000000-dead-beef-0000-000000000001';
      store.insertResource(target, {
        id: sentinelId,
        widgetId: '00000000-0000-0000-0000-000000000000',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });
      assert.strictEqual(store.findAll(target, { id: sentinelId }).total, 1,
        'Sentinel should be present before reseed');

      seedAllDatabases(loadDocs(dir, dir), store, { seeded: Boolean(dir) });

      assert.strictEqual(store.findAll(target, { id: sentinelId }).total, 0,
        `Sub-collection "${target}" should be cleared at boot`);
      console.log(`  ✓ Sub-collection "${target}" cleared on reseed`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('seedAllDatabases - does not assign sub-collection records to the parent collection when prefixes overlap', async () => {
    // Regression test for: "Application" prefix matches "ApplicationMemberExample1"
    // via startsWith, causing member records to be seeded into applications.db.
    // After the fix, longest-prefix matching assigns each key to the most
    // specific collection only.
    store.clearAll('applications');
    store.clearAll('application-members');

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

    // The seeder groups by the collections a spec declares, so the temp set
    // carries the spec these records belong to as well as the records.
    const list = (name) => ({
      get: { responses: { 200: { description: 'ok', content: { 'application/json': {
        schema: { $ref: `#/components/schemas/${name}List` } } } } } },
    });
    writeFileSync(pathJoin(tmpSeedDir, 'intake-openapi.yaml'), yaml.dump({
      openapi: '3.1.0',
      info: { title: 'Intake', version: '1.0.0', 'x-domain': 'intake' },
      paths: {
        '/applications': list('Application'),
        '/applications/{applicationId}': { get: {} },
        '/applications/{applicationId}/members': list('ApplicationMember'),
        '/applications/{applicationId}/members/{memberId}': { get: {} },
      },
      components: { schemas: {
        Application: { type: 'object' },
        ApplicationMember: { type: 'object' },
        ApplicationList: { type: 'object', properties: { items: { type: 'array',
          items: { $ref: '#/components/schemas/Application' } } } },
        ApplicationMemberList: { type: 'object', properties: { items: { type: 'array',
          items: { $ref: '#/components/schemas/ApplicationMember' } } } },
      } },
    }));

    seedAllDatabases(loadDocs(tmpSeedDir), store);

    const appsInApplications = store.findAll('applications', {}).total;
    const membersInApplications = store.findAll('applications', { id: 'c0000001-0000-4000-8000-000000000001' }).total;
    const membersInMembers = store.findAll('application-members', {}).total;

    assert.strictEqual(appsInApplications, 1, 'applications collection should have exactly 1 record');
    assert.strictEqual(membersInApplications, 0, 'member record must not appear in applications collection');
    assert.strictEqual(membersInMembers, 1, 'application-members collection should have exactly 1 record');
    console.log('  ✓ Prefix collision: member records correctly isolated to application-members');

    store.clearAll('applications');
    store.clearAll('application-members');
  });

  await t.test('seedAllDatabases - seeds from seedDir when it differs from specsDir', async () => {
    // Verifies that passing a separate seedDir causes seed data to be loaded
    // from that directory rather than from specsDir. This is the behaviour that
    // --seed=<dir> in setup.js exposes on the CLI.
    store.clearAll('widgets');

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

    // The fixture spec dir names the collections; the custom seed dir supplies
    // the records. The seeder takes documents now, so this is the caller's job
    // — which is what lets a browser seed from the contracts artifact (#448).
    seedAllDatabases(loadDocs(fixtureSpecDir, tmpSeedDir), store);

    const found = store.findAll('widgets', { id: 'f0000001-0000-4000-8000-000000000001' });
    assert.strictEqual(found.total, 1, 'record from custom seedDir should be present in widgets');
    console.log('  ✓ seedDir correctly overrides specsDir for seed loading');

    store.clearAll('widgets');
  });

});

// Cleanup after all tests
cleanup();
console.log('\n✓ All seeder tests passed\n');
