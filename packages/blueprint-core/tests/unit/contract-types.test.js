/**
 * What each contract type is, and how a document's identity is decided.
 *
 * This module answers three questions every other module depends on: what type
 * is this document, what domain does it belong to, and what is its filename.
 * It had no tests of its own — `detectType` was covered only incidentally
 * through `discover`, and `fileNameOf` arrived with #448 untested.
 *
 * All three are pure functions of a string and parsed content, which is what
 * lets `extract` and `generate` run in a browser (#448). A Node import here
 * would undo that, so the one import of `node:path` below is in the test, not
 * the module — it is the oracle `fileNameOf` is checked against.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import {
  detectType,
  extractDomain,
  fileNameOf,
  stemOf,
  siblingPath,
  isAuthored,
  isDeprecated,
} from '../../src/contract-types.js';

describe('fileNameOf', () => {

  test('agrees with node:path basename across every path and suffix pairing', () => {
    // A differential test rather than a list of expectations: the function
    // exists only to be `basename` without importing it, so `basename` is the
    // specification. Written out because the corners are not obvious — a
    // trailing separator, a suffix that is the whole filename, a dotted name.
    const paths = [
      'domains/intake/intake-openapi.yaml', 'intake-openapi.yaml', '-openapi.yaml',
      '', 'a.yaml', './a.yaml', 'domains/intake/', 'domains/intake//',
      '/abs/path/x-mock-data.yaml', '.yaml', 'noslash', '../../common/shared.yaml',
      'a/b/c', 'a', '.', '..', 'deep/a/b/c-graph.yaml', 'name.with.dots.yaml',
    ];
    const suffixes = [
      undefined, '-openapi.yaml', '.yaml', 'a', '-graph.yaml', '.dots.yaml', 'zzz',
    ];

    const mismatches = [];
    for (const path of paths) {
      for (const suffix of suffixes) {
        const mine = suffix === undefined ? fileNameOf(path) : fileNameOf(path, suffix);
        const oracle = suffix === undefined ? basename(path) : basename(path, suffix);
        if (mine !== oracle) {
          mismatches.push(`basename(${JSON.stringify(path)}, ${JSON.stringify(suffix)}) → ` +
            `${JSON.stringify(oracle)} but fileNameOf gave ${JSON.stringify(mine)}`);
        }
      }
    }
    assert.deepStrictEqual(mismatches, []);
  });

  test('treats a backslash as a separator, which basename only does on Windows', () => {
    // Callers pass two kinds of string: a `relativePath` within the set, always
    // `/`-separated, and `doc.path` from `discover`, which is an OS path. This
    // handles both everywhere rather than being correct only on the platform
    // the tests happen to run on.
    assert.equal(fileNameOf('C:\\repo\\domains\\intake\\intake-openapi.yaml'), 'intake-openapi.yaml');
    assert.equal(fileNameOf('C:\\repo\\domains\\intake\\intake-openapi.yaml', '-openapi.yaml'), 'intake');
  });

  test('is not fooled by a non-string', () => {
    for (const value of [undefined, null, 42, {}]) {
      assert.equal(fileNameOf(value), '');
    }
  });
});

describe('detectType', () => {

  test('a json-schema.org meta-schema is a schema, whatever the filename says', () => {
    // Checked before the blueprint table so these are typed by what they
    // declare rather than falling through to the suffix.
    assert.equal(
      detectType('intake-metrics.yaml', { $schema: 'https://json-schema.org/draft/2020-12/schema' }),
      'schema'
    );
  });

  test('a blueprint $schema wins over the filename', () => {
    assert.equal(
      detectType('anything.yaml', { $schema: 'https://blueprint.codeforamerica.org/schemas/rules-schema.yaml' }),
      'rules'
    );
  });

  describe('version fields identify the standards-defined types', () => {
    const cases = [
      ['openapi', { openapi: '3.1.0' }],
      ['asyncapi', { asyncapi: '3.0.0' }],
      ['overlay', { overlay: '1.0.0' }],
    ];
    for (const [expected, content] of cases) {
      test(expected, () => assert.equal(detectType('no-convention.yaml', content), expected));
    }
  });

  test('an overlay is one type whether it carries actions, config, or both', () => {
    // Which of the two an overlay happens to declare is a property of the
    // document, not a different kind of document.
    assert.equal(detectType('x.yaml', { overlay: '1.0.0', actions: [] }), 'overlay');
    assert.equal(detectType('x.yaml', { overlay: '1.0.0', config: {} }), 'overlay');
    assert.equal(detectType('x.yaml', { overlay: '1.0.0', actions: [], config: {} }), 'overlay');
  });

  describe('the filename suffix decides when content carries no marker', () => {
    const cases = [
      ['intake-openapi.yaml', 'openapi'],
      ['intake-state-machine.yaml', 'state-machine'],
      ['eligibility-rules.yaml', 'rules'],
      ['eligibility-rules-examples.yaml', 'rules-examples'],
      ['eligibility-x-graph.yaml', 'graph'],
      ['intake-compositions.yaml', 'compositions'],
      ['intake-annotations.yaml', 'annotations'],
      ['intake-annotations-docs.yaml', 'annotations'],
      ['intake-sla-types.yaml', 'sla-types'],
      ['intake-metrics.yaml', 'metrics'],
      ['intake-mock-data.yaml', 'mock-data'],
      ['intake-config.yaml', 'config'],
      ['common-schema.yaml', 'schema'],
    ];
    for (const [filename, expected] of cases) {
      test(`${filename} → ${expected}`, () => assert.equal(detectType(filename, {}), expected));
    }
  });

  test('-rules-examples.yaml is not read as -examples.yaml', () => {
    // Suffix matching is first-match-wins over an ordered list, so a new
    // suffix that another filename also ends with would silently retype
    // existing documents. This is the pairing that would do it.
    assert.equal(detectType('eligibility-rules-examples.yaml', {}), 'rules-examples');
  });

  test('a bare map of component objects is a component library', () => {
    // No version field, no $schema, no $id — checked last, so it can only
    // reclassify what would otherwise be unknown.
    assert.equal(
      detectType('parameters.yaml', { LimitParam: { in: 'query' }, SortParam: { in: 'query' } }),
      'components'
    );
  });

  describe('is not a component library', () => {
    const cases = [
      ['an empty map', {}],
      ['an array', []],
      ['a map with a scalar value', { a: { in: 'query' }, b: 'scalar' }],
      ['a map with an array value', { a: { in: 'query' }, b: [] }],
      ['something declaring $id', { $id: 'x', a: {} }],
      ['nothing at all', undefined],
    ];
    for (const [name, content] of cases) {
      test(name, () => assert.equal(detectType('no-convention.yaml', content), 'unknown'));
    }
  });
});

describe('extractDomain', () => {
  const enumDomains = new Set(['intake', 'eligibility', 'platform']);

  test('what the content declares wins', () => {
    assert.equal(extractDomain('x.yaml', 'domains/intake/x.yaml',
      { info: { 'x-domain': 'eligibility' } }, enumDomains), 'eligibility');
    assert.equal(extractDomain('x.yaml', 'domains/intake/x.yaml',
      { domain: 'eligibility' }, enumDomains), 'eligibility');
  });

  test('a directory segment in the Domain enum', () => {
    assert.equal(extractDomain('x.yaml', 'domains/intake/x.yaml', {}, enumDomains), 'intake');
  });

  test('a filename prefix in the Domain enum', () => {
    assert.equal(extractDomain('intake-metrics.yaml', 'somewhere/intake-metrics.yaml', {}, enumDomains), 'intake');
  });

  test('a directory under domains/ counts even when the enum omits it', () => {
    // The case this fallback exists for. A set can declare `domains/scheduling`
    // without having added `scheduling` to the Domain enum, which left every
    // document there domainless unless it happened to name its own domain —
    // splitting a domain in half, so `scheduling-openapi.yaml` had a domain
    // and `scheduling-mock-data.yaml` did not, and a per-domain bundle of it
    // would ship an API with an empty store.
    assert.equal(
      extractDomain('scheduling-mock-data.yaml', 'domains/scheduling/scheduling-mock-data.yaml', {}, enumDomains),
      'scheduling'
    );
  });

  describe('shared libraries stay domainless', () => {
    // The reason the enum check is still there. Inferring `base` or `common`
    // as a domain from the directory name is worse than inferring nothing.
    const cases = [
      'base/components/parameters.yaml',
      'base/schemas/enums.yaml',
      'common/schemas/income.yaml',
      'common/components/contact.yaml',
    ];
    for (const relativePath of cases) {
      test(relativePath, () => {
        assert.equal(extractDomain(fileNameOf(relativePath), relativePath, {}, enumDomains), null);
      });
    }
  });

  test('a document outside both conventions has no domain', () => {
    assert.equal(extractDomain('loose.yaml', 'loose.yaml', {}, enumDomains), null);
  });
});

describe('stemOf and siblingPath', () => {

  test('round-trip through a type that has a suffix', () => {
    const stem = stemOf('domains/intake/intake-compositions.yaml', 'compositions');
    assert.equal(stem, 'domains/intake/intake');
    assert.equal(siblingPath(stem, 'openapi'), 'domains/intake/intake-openapi.yaml');
  });

  test('null when the path does not carry the type it is asked about', () => {
    assert.equal(stemOf('domains/intake/intake-openapi.yaml', 'compositions'), null);
  });

  test('null for a type with no filename convention', () => {
    // `registry` is identified by its $schema, not a suffix — core knows the
    // format, not which registry types exist.
    assert.equal(siblingPath('domains/intake/intake', 'registry'), null);
  });
});

describe('isAuthored and isDeprecated', () => {

  test('states author these by hand, so an overlay extends them', () => {
    for (const type of ['state-machine', 'rules', 'compositions', 'annotations', 'sla-types', 'metrics']) {
      assert.equal(isAuthored(type), true, `${type} should be authored`);
    }
  });

  test('generated and standards-defined types are not authored', () => {
    for (const type of ['openapi', 'graph', 'mock-data', 'components', 'unknown']) {
      assert.equal(isAuthored(type), false, `${type} should not be authored`);
    }
  });

  test('a retired spec is deprecated by what its info block says', () => {
    assert.equal(isDeprecated({ info: { 'x-status': 'deprecated' } }), true);
    assert.equal(isDeprecated({ info: { 'x-status': 'active' } }), false);
    assert.equal(isDeprecated({}), false);
    assert.equal(isDeprecated(undefined), false);
  });
});
