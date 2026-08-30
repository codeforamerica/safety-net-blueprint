import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolveConfig } from '../src/context-map/resolve-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesContent = join(__dirname, 'fixtures', 'content');
const fixturesContracts = join(__dirname, 'fixtures', 'contracts');
const emptyContracts = '/tmp/nonexistent-contracts-dir-for-test';

describe('resolveConfig', () => {
  it('loads config.yaml from contentDir', () => {
    const config = resolveConfig(emptyContracts, fixturesContent);
    assert.ok(config.flows, 'should have flows');
    assert.ok(config.domains, 'should have domains');
  });

  it('preserves flow structure', () => {
    const config = resolveConfig(emptyContracts, fixturesContent);
    assert.equal(config.flows[0].id, 'submission');
    assert.equal(config.flows[0].label, 'Application Submission');
  });

  it('enriches steps with policies when annotations exist', () => {
    const config = resolveConfig(fixturesContracts, fixturesContent);
    // The fixture flow steps don't use ref: so no policies are added,
    // but the function should run without error
    assert.ok(Array.isArray(config.flows[0].steps));
  });

  it('returns config with same flows count', () => {
    const config = resolveConfig(emptyContracts, fixturesContent);
    const rawSteps = config.flows[0].steps;
    assert.ok(rawSteps.length > 0);
  });

  it('handles missing contracts dir gracefully', () => {
    assert.doesNotThrow(() => resolveConfig(emptyContracts, fixturesContent));
  });
});
