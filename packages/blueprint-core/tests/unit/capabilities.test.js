/**
 * Framework capabilities: what a set opts into, one at a time.
 *
 * Every framework file outside platform says which capability it belongs to,
 * and a set that refers to something from a capability it has not listed is
 * told which one, rather than only that the name is unknown.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../../src/discover.js';
import { load } from '../../src/load.js';
import { baseContractsDir } from '../../src/paths.js';
import { toDoc } from '../../src/doc.js';
import { validate } from '../../src/validate.js';
import { eventsAsyncapis } from '../../src/generate.js';
import { readConfigs } from '../../src/contract-readers.js';

const framework = discover(baseContractsDir).map((file) => load(file));

const api = toDoc({
  path: '/set/domains/demo/demo-openapi.yaml',
  relativePath: 'domains/demo/demo-openapi.yaml',
  type: 'openapi',
  content: {
    openapi: '3.1.0',
    info: { title: 'Demo', version: '1.0.0', 'x-domain': 'demo' },
    servers: [{ url: '/demo' }],
    paths: {},
  },
});

const scenario = (operationId) => toDoc({
  path: '/set/scenarios/s.arazzo.yaml',
  relativePath: 'scenarios/s.arazzo.yaml',
  type: 'arazzo',
  content: {
    arazzo: '1.0.1',
    info: { title: 'S', version: '1', 'x-domain': 'demo' },
    sourceDescriptions: [{ name: 'api', url: 'demo-openapi.yaml', type: 'openapi' }],
    workflows: [{ workflowId: 'w', steps: [{ stepId: 'a', operationId }] }],
  },
});

const errorsOf = (docs, rule) => validate(docs).results.flatMap((r) => r.errors).filter((e) => e.rule === rule);

describe('the framework\'s files', () => {
  test('outside platform, each declares the capability it belongs to', () => {
    const undeclared = framework
      .filter((doc) => doc.domain && doc.domain !== 'platform' && !doc.capability)
      .map((doc) => doc.relativePath);
    assert.deepEqual(undeclared, [], 'a framework file outside platform must declare its capability, or every set gets it');
  });

  test('in platform, or shared, none declares one: every set gets them', () => {
    const declared = framework
      .filter((doc) => (!doc.domain || doc.domain === 'platform') && doc.capability)
      .map((doc) => doc.relativePath);
    assert.deepEqual(declared, []);
  });

  test('transcripts are a capability of the communication domain', () => {
    const transcripts = framework.filter((doc) => doc.capability === 'transcripts');
    assert.ok(transcripts.some((doc) => doc.type === 'openapi'));
    assert.deepEqual([...new Set(transcripts.map((doc) => doc.domain))], ['communication']);
  });
});

describe('a set referring to a capability it has not listed', () => {
  test('a scenario calling its operation is told which capability that is', () => {
    const [error] = errorsOf([api, scenario('createTranscript')], 'unknown-operation');
    assert.match(error.message, /calls createTranscript, which no API in the set declares\./);
    assert.match(error.message, /"createTranscript" is declared by the framework's "transcripts" capability, which the set does not list in x-capabilities\./);
  });

  test('an operation the state machine adds is found too', () => {
    const [error] = errorsOf([api, scenario('pauseTranscript')], 'unknown-operation');
    assert.match(error.message, /"transcripts" capability/);
  });

  test('a file attaching to a domain only that capability defines is told too', () => {
    const registry = toDoc({
      path: '/set/domains/communication/communication-registry-terms.yaml',
      relativePath: 'domains/communication/communication-registry-terms.yaml',
      type: 'registry',
      content: { version: '1.0.0', domain: 'communication', type: 'terms', entries: {} },
    });
    const machine = toDoc({
      path: '/set/domains/communication/communication-state-machine.yaml',
      relativePath: 'domains/communication/communication-state-machine.yaml',
      type: 'state-machine',
      content: { version: '1.0', domain: 'communication', machines: [] },
    });
    const errors = [...errorsOf([api, registry, machine], 'undefined-domain')];
    assert.ok(errors.length > 0);
    for (const error of errors) assert.match(error.message, /"communication" is declared by the framework's "transcripts" capability/);
  });

  test('a name no capability declares is left as it was', () => {
    const [error] = errorsOf([api, scenario('createWidget')], 'unknown-operation');
    assert.equal(error.message, 'Step "a" calls createWidget, which no API in the set declares.');
  });

  test('a set that lists the capability is not told it is missing', () => {
    const listed = framework.filter((doc) => !doc.capability || doc.capability === 'transcripts')
      .map((doc) => toDoc({ ...doc, relativePath: `base/${doc.relativePath}` }));
    const errors = validate([...listed, api, scenario('createWidget')]).results.flatMap((r) => r.errors);
    assert.ok(errors.every((e) => !/x-capabilities/.test(e.message)), errors.map((e) => e.message).join('\n'));
  });
});

describe('the declaration is not content', () => {
  test('a config document\'s capability is not a catalog', () => {
    const config = toDoc({
      path: '/set/domains/demo/demo-config.yaml',
      relativePath: 'domains/demo/demo-config.yaml',
      type: 'config',
      content: { version: '1.0', domain: 'demo', capability: 'demos' },
    });
    assert.deepEqual(errorsOf([api, config], 'not-a-catalog'), []);
    assert.deepEqual(readConfigs([config]).flatMap((c) => Object.keys(c.catalogs ?? {})), []);
  });

  test('a generated events document carries its API\'s capability', () => {
    const transcripts = framework.filter((doc) => !doc.capability || doc.capability === 'transcripts')
      .map((doc) => toDoc({ ...doc, relativePath: `base/${doc.relativePath}` }));
    const catalog = eventsAsyncapis(transcripts)
      .find((doc) => doc.content.info['x-domain'] === 'communication');
    assert.equal(catalog.content.info['x-capability'], 'transcripts');
    assert.equal(catalog.capability, 'transcripts');
  });
});
