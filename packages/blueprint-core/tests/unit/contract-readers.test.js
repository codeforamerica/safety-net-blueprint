/**
 * What `extract` reads out of the blueprint-authored contract types.
 *
 * Driven through the public entry point, because these replace loaders that
 * `blueprint-mock-server` called and the point is that a consumer gets the
 * same answer without a filesystem.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';

import { discover, load, extract, validate } from '../../src/index.js';

/** Write a contract set to a temp directory and load it. */
function setOf(files) {
  const dir = mkdtempSync(join(tmpdir(), 'core-readers-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const full = join(dir, relativePath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, yaml.dump(content));
  }
  return discover(dir).map(load);
}

describe('extract(docs, "sla-types")', () => {
  test('reads the types each domain declares', () => {
    const docs = setOf({
      'workflow-sla-types.yaml': {
        $schema: 'sla-types-schema.yaml',
        domain: 'workflow',
        slaTypes: [{ id: 'review', hours: 24 }],
      },
    });

    assert.deepEqual(extract(docs, 'sla-types'), [
      { domain: 'workflow', slaTypes: [{ id: 'review', hours: 24 }], relativePath: 'workflow-sla-types.yaml' },
    ]);
  });

  test('skips a document declaring no slaTypes', () => {
    const docs = setOf({
      'workflow-sla-types.yaml': { $schema: 'sla-types-schema.yaml', domain: 'workflow' },
    });
    assert.deepEqual(extract(docs, 'sla-types'), []);
  });
});

describe('extract(docs, "metrics")', () => {
  test('reads the metrics each domain declares', () => {
    const docs = setOf({
      'workflow-metrics.yaml': {
        $schema: 'metrics-schema.yaml',
        domain: 'workflow',
        metrics: [{ id: 'tasksOpen', type: 'gauge' }],
      },
    });

    assert.deepEqual(extract(docs, 'metrics'), [
      { domain: 'workflow', metrics: [{ id: 'tasksOpen', type: 'gauge' }], relativePath: 'workflow-metrics.yaml' },
    ]);
  });
});

describe('extract(docs, "config")', () => {
  test('every top-level array is a catalog; the envelope is not', () => {
    const docs = setOf({
      'intake-config.yaml': {
        $schema: 'config-schema.yaml',
        version: '2.0',
        domain: 'intake',
        'document-types': [{ id: 'paystub' }],
        'denial-reasons': [{ id: 'overIncome' }],
        somethingScalar: 'ignored',
      },
    });

    assert.deepEqual(extract(docs, 'config'), [
      {
        domain: 'intake',
        version: '2.0',
        catalogs: {
          'document-types': [{ id: 'paystub' }],
          'denial-reasons': [{ id: 'overIncome' }],
        },
        relativePath: 'intake-config.yaml',
      },
    ]);
  });

  test('a config schema is not a config', () => {
    // discover types `-config-schema.yaml` as `schema`, so the exclusion the
    // old loader did by filename comes for free.
    const docs = setOf({
      'intake-config-schema.yaml': { domain: 'intake', items: [{ id: 'x' }] },
    });
    assert.deepEqual(extract(docs, 'config'), []);
  });
});

describe('extract(docs, "state-machines")', () => {
  const machineDoc = {
    $schema: 'state-machine-schema.yaml',
    domain: 'intake',
    apiSpec: 'intake-openapi.yaml',
    machines: [
      { object: 'Application', states: ['draft'] },
      { object: 'Document', states: ['pending'] },
    ],
  };

  test('one entry per machine, each pointing at its own machine and the document', () => {
    const entries = extract(setOf({ 'intake-state-machine.yaml': machineDoc }), 'state-machines');

    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => e.object), ['Application', 'Document']);
    assert.equal(entries[0].domain, 'intake');
    assert.equal(entries[0].apiSpec, 'intake-openapi.yaml');
    assert.deepEqual(entries[0].machine, { object: 'Application', states: ['draft'] });
    assert.equal(entries[0].stateMachine.domain, 'intake');
  });

  test('the older flat shape yields one entry whose machine is the document', () => {
    const entries = extract(
      setOf({
        'intake-state-machine.yaml': {
          $schema: 'state-machine-schema.yaml',
          domain: 'intake',
          object: 'Application',
          transitions: [{ from: 'draft', to: 'submitted' }],
        },
      }),
      'state-machines'
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0].object, 'Application');
    assert.equal(entries[0].machine, entries[0].stateMachine);
  });

  test('a machine with no object is skipped, not returned half-built', () => {
    const entries = extract(
      setOf({
        'intake-state-machine.yaml': {
          $schema: 'state-machine-schema.yaml',
          domain: 'intake',
          machines: [{ states: ['draft'] }, { object: 'Document' }],
        },
      }),
      'state-machines'
    );

    assert.deepEqual(entries.map((e) => e.object), ['Document']);
  });

  test('extends pulls in a library document — no machines, no domain', () => {
    const docs = setOf({
      'domains/platform/platform-state-machine.yaml': {
        $schema: 'state-machine-schema.yaml',
        guards: [{ id: 'callerIsCaseworker', condition: '"case_worker" in caller.roles' }],
        procedures: [{ id: 'notify', steps: [] }],
      },
      'domains/intake/intake-state-machine.yaml': {
        $schema: 'state-machine-schema.yaml',
        domain: 'intake',
        extends: '../platform/platform-state-machine.yaml',
        machines: [{ object: 'Application', states: ['draft'] }],
      },
    });

    const entries = extract(docs, 'state-machines');

    assert.equal(entries.length, 1, 'a library document yields no entry of its own');
    assert.deepEqual(entries[0].stateMachine._platformGuards, [
      { id: 'callerIsCaseworker', condition: '"case_worker" in caller.roles' },
    ]);
    assert.deepEqual(entries[0].stateMachine._platformProcedures, [{ id: 'notify', steps: [] }]);
  });

  test('extends matches on filename, so the library file can move', () => {
    const docs = setOf({
      'somewhere/else/platform-state-machine.yaml': {
        $schema: 'state-machine-schema.yaml',
        guards: [{ id: 'g' }],
      },
      'domains/intake/intake-state-machine.yaml': {
        $schema: 'state-machine-schema.yaml',
        domain: 'intake',
        extends: '../platform/platform-state-machine.yaml',
        machines: [{ object: 'Application' }],
      },
    });

    assert.deepEqual(extract(docs, 'state-machines')[0].stateMachine._platformGuards, [{ id: 'g' }]);
  });

  test('an unresolvable extends is an error, not a machine missing its guards', () => {
    // Silence here is the worst option available: an engine treats a guard it
    // cannot find as satisfied, so a document that failed to inherit its guards
    // would pass every transition those guards were gating.
    const docs = setOf({
      'intake-state-machine.yaml': {
        $schema: 'state-machine-schema.yaml',
        domain: 'intake',
        extends: '../nowhere/absent-state-machine.yaml',
        machines: [{ object: 'Application' }],
      },
    });

    assert.throws(() => extract(docs, 'state-machines'), (err) => {
      assert.match(err.message, /no state machine named "absent-state-machine\.yaml"/);
      assert.match(err.message, /treated as satisfied/);
      return true;
    });
  });

  test('an unresolvable action schema $ref is an error', () => {
    const docs = setOf({
      'intake-state-machine.yaml': {
        $schema: 'state-machine-schema.yaml',
        domain: 'intake',
        machines: [
          {
            object: 'Application',
            actions: [{ id: 'submit', schema: { request: { $ref: './gone.yaml#/$defs/Submit' } } }],
          },
        ],
      },
    });

    assert.throws(() => extract(docs, 'state-machines'), /names nothing in the contract set/);
  });

  test('a document declaring machines without a domain is reported by validate', () => {
    // The reader drops it either way — anything indexing by domain must. The
    // point is that validate now says so, instead of it surfacing later as a
    // missing endpoint.
    const docs = setOf({
      'intake-state-machine.yaml': {
        $schema: 'state-machine-schema.yaml',
        version: '1.0',
        machines: [{ object: 'Application' }],
      },
    });

    assert.deepEqual(extract(docs, 'state-machines'), [], 'the reader still skips it');
    assert.ok(
      validate(docs).results.flatMap((d) => d.errors ?? []).some((e) => /domain/.test(e.message)),
      'validate must report the missing domain'
    );
  });

  test('a library document needs no domain to be valid', () => {
    const docs = setOf({
      'platform-state-machine.yaml': {
        $schema: 'state-machine-schema.yaml',
        version: '1.0',
        guards: [{ id: 'g', condition: 'true' }],
      },
    });

    assert.ok(
      !validate(docs).results.flatMap((d) => d.errors ?? []).some((e) => /domain/.test(e.message)),
      'a document with no machines is a library and needs no domain'
    );
  });
});

describe('extract dispatch', () => {
  test('an unknown type names the ones that exist', () => {
    assert.throws(() => extract([], 'nonsense'), (err) => {
      assert.match(err.message, /unknown type "nonsense"/);
      for (const known of ['relationships', 'state-machines', 'sla-types', 'metrics', 'config']) {
        assert.ok(err.message.includes(known), `should list ${known}`);
      }
      return true;
    });
  });

  test('an empty set reads as empty rather than throwing', () => {
    for (const type of ['state-machines', 'sla-types', 'metrics', 'config']) {
      assert.deepEqual(extract([], type), [], type);
    }
  });
});

describe('extends on a library document', () => {
  test('an unresolvable extends is an error even on a document that yields no entry', () => {
    // The one kind of document whose whole purpose is to be referenced is also
    // the one this used to skip, because it resolved extends only for
    // documents that became entries.
    const dir = mkdtempSync(join(tmpdir(), 'core-readers-'));
    writeFileSync(
      join(dir, 'shared-state-machine.yaml'),
      yaml.dump({
        $schema: 'state-machine-schema.yaml',
        version: '1.0',
        extends: './absent-state-machine.yaml',
        guards: [{ id: 'g', condition: 'true' }],
      })
    );

    assert.throws(
      () => extract(discover(dir).map(load), 'state-machines'),
      /no state machine named "absent-state-machine\.yaml"/
    );
  });
});

describe('extract(docs, "registries")', () => {

  test('groups entries by the type each registry claims', () => {
    const docs = setOf({
      'registries/policies.yaml': {
        $schema: 'https://blueprint.codeforamerica.org/schemas/registry-schema.yaml',
        type: 'policies',
        entries: {
          'snap-gross-income': { title: 'SNAP gross income limit' },
          'snap-net-income': { title: 'SNAP net income limit' },
        },
      },
      'registries/queues.yaml': {
        $schema: 'https://blueprint.codeforamerica.org/schemas/registry-schema.yaml',
        type: 'taskQueues',
        entries: { intake: { title: 'Intake queue' } },
      },
    });

    const registries = extract(docs, 'registries');
    assert.deepEqual(Object.keys(registries).sort(), ['policies', 'taskQueues']);
    assert.equal(Object.keys(registries.policies).length, 2);
    assert.equal(registries.policies['snap-gross-income'].title, 'SNAP gross income limit');
    assert.equal(registries.taskQueues.intake.title, 'Intake queue');
  });

  test('merges entries declared across documents, later winning', () => {
    // How an overlay adds to a registry it did not author. Order is discovery
    // order, so a set holding two documents of one type gets both.
    const docs = setOf({
      'registries/a-policies.yaml': {
        $schema: 'https://blueprint.codeforamerica.org/schemas/registry-schema.yaml',
        type: 'policies',
        entries: { shared: { title: 'from a' }, onlyA: { title: 'a' } },
      },
      'registries/b-policies.yaml': {
        $schema: 'https://blueprint.codeforamerica.org/schemas/registry-schema.yaml',
        type: 'policies',
        entries: { shared: { title: 'from b' }, onlyB: { title: 'b' } },
      },
    });

    const { policies } = extract(docs, 'registries');
    assert.deepEqual(Object.keys(policies).sort(), ['onlyA', 'onlyB', 'shared']);
    assert.equal(policies.shared.title, 'from b', 'the later document wins');
  });

  test('does not require a domain, since platform registries are cross-domain', () => {
    // The other readers filter on `content.domain`. Policies and task queues
    // belong to the platform rather than to one domain, so requiring it would
    // silently drop every registry that prompted this reader.
    const docs = setOf({
      'registries/policies.yaml': {
        $schema: 'https://blueprint.codeforamerica.org/schemas/registry-schema.yaml',
        type: 'policies',
        entries: { x: { title: 'X' } },
      },
    });
    assert.equal(Object.keys(extract(docs, 'registries').policies).length, 1);
  });

  describe('skips what it cannot key', () => {
    const cases = [
      ['a registry with no type', { entries: { x: {} } }],
      ['a registry with an empty type', { type: '', entries: { x: {} } }],
      ['a registry with a non-string type', { type: 42, entries: { x: {} } }],
    ];
    for (const [name, extra] of cases) {
      test(name, () => {
        const docs = setOf({
          'registries/odd.yaml': {
            $schema: 'https://blueprint.codeforamerica.org/schemas/registry-schema.yaml',
            ...extra,
          },
        });
        assert.deepEqual(extract(docs, 'registries'), {});
      });
    }
  });

  test('a registry declaring no entries contributes its type and nothing else', () => {
    const docs = setOf({
      'registries/empty.yaml': {
        $schema: 'https://blueprint.codeforamerica.org/schemas/registry-schema.yaml',
        type: 'policies',
      },
    });
    assert.deepEqual(extract(docs, 'registries'), { policies: {} });
  });

  test('an empty set reads as no registries', () => {
    assert.deepEqual(extract([], 'registries'), {});
  });
});
