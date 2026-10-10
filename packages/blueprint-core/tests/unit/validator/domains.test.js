/**
 * Every document of a domain-owned type declares its domain.
 *
 * Nothing infers one any more — not the folder, the filename or the Domain
 * enum — so a document that does not say which domain it belongs to is
 * reported, not quietly filed under a guess.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';

import { discover, load, validate } from '../../../src/index.js';

function withSet(files, check) {
  const dir = mkdtempSync(join(tmpdir(), 'core-domains-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const full = join(dir, relativePath);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, yaml.dump(content));
    }
    check(discover(dir).map(load));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const missing = (docs) => validate(docs).results
  .flatMap((result) => result.errors.filter((e) => e.rule === 'missing-domain').map((e) => ({ ...e, type: result.type })));

const openapi = (info = {}) => ({
  openapi: '3.1.0',
  info: { title: 'Intake', version: '1.0.0', ...info },
  paths: {},
});

describe('missing-domain', () => {

  test('an OpenAPI document in a domain folder still has to say so', () => {
    withSet({ 'domains/intake/intake-openapi.yaml': openapi() }, (docs) => {
      const [error] = missing(docs);
      assert.equal(error?.type, 'openapi');
      assert.match(error.message, /info\.x-domain/);
    });
  });

  test('mock data is named after its domain, and still has to declare it', () => {
    withSet({
      'domains/intake/intake-openapi.yaml': openapi({ 'x-domain': 'intake' }),
      'domains/intake/intake-mock-data.yaml': { ApplicationExample1: { id: 'a-1' } },
    }, (docs) => {
      assert.deepEqual(missing(docs).map((e) => e.type), ['mock-data']);
      assert.match(missing(docs)[0].message, /top-level `domain`/);
    });
  });

  test('a document that declares its domain passes', () => {
    withSet({
      'domains/intake/intake-openapi.yaml': openapi({ 'x-domain': 'intake' }),
      'domains/intake/intake-mock-data.yaml': { domain: 'intake', ApplicationExample1: { id: 'a-1' } },
    }, (docs) => {
      assert.deepEqual(missing(docs), []);
    });
  });

  test('what may be shared across domains needs none', () => {
    withSet({
      'common/schemas/contact.yaml': { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: { Phone: { type: 'string' } } },
      'domains/platform/platform-state-machine.yaml': {
        $schema: 'state-machine-schema.yaml',
        version: '1.0',
        guards: [{ id: 'g', condition: 'true' }],
      },
    }, (docs) => {
      assert.deepEqual(missing(docs), []);
    });
  });

  test('a deprecated document is not held to it', () => {
    withSet({ 'domains/intake/intake-openapi.yaml': openapi({ 'x-status': 'deprecated' }) }, (docs) => {
      assert.deepEqual(missing(docs), []);
    });
  });
});

describe('undefined-domain', () => {
  const undefinedDomains = (docs) => validate(docs).results
    .flatMap((result) => result.errors.filter((e) => e.rule === 'undefined-domain'));

  test('a document attaching to a domain nothing defines is reported, with the ones that are', () => {
    withSet({
      'domains/intake/intake-openapi.yaml': openapi({ 'x-domain': 'intake' }),
      'domains/intake/intake-mock-data.yaml': { domain: 'intkae', ApplicationExample1: { id: 'a-1' } },
    }, (docs) => {
      const [error] = undefinedDomains(docs);
      assert.match(error?.message ?? '', /"intkae"/);
      assert.match(error.message, /Defined: intake/);
    });
  });

  test('a rules document defines a domain of its own', () => {
    // A rules file can serve endpoints with no API, so a rules-only domain is
    // a domain, and what attaches to it is fine.
    withSet({
      'domains/screening/screening-rules.yaml': {
        $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml',
        domain: 'screening',
        rulesets: {},
      },
      'domains/screening/screening-rules-examples.yaml': {
        $schema: 'https://blueprint.codeforamerica.org/schemas/rules-examples-schema.yaml',
        domain: 'screening',
      },
    }, (docs) => {
      assert.deepEqual(undefinedDomains(docs), []);
    });
  });

  test('a set that defines no domain is not checked', () => {
    withSet({ 'domains/intake/intake-mock-data.yaml': { domain: 'intake' } }, (docs) => {
      assert.deepEqual(undefinedDomains(docs), []);
    });
  });
});
