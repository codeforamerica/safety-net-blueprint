/**
 * Unit tests for resolve/variables.js
 *
 * Ported from the CLI's substitutePlaceholders tests, restated against the
 * pass API. The caller supplies the values, so precedence between an env file
 * and process.env is its concern, not this pass's — here it is just the map
 * that arrives.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { substituteVariables } from '../../../src/resolve/variables.js';
import { doc, only } from '../../helpers/docs.js';

describe('substituteVariables', () => {
  test('replaces ${VAR} from the supplied values', () => {
    const result = substituteVariables(
      [doc({ servers: [{ url: '${API_URL}/v1' }] })],
      { API_URL: 'https://api.example.com' }
    );

    assert.equal(only(result).servers[0].url, 'https://api.example.com/v1');
    assert.deepEqual(result.warnings, []);
  });

  test('substitutes every placeholder in one string', () => {
    const result = substituteVariables(
      [doc({ url: '${PROTO}://${HOST}:${PORT}' })],
      { PROTO: 'https', HOST: 'api.example.com', PORT: '443' }
    );

    assert.equal(only(result).url, 'https://api.example.com:443');
    assert.deepEqual(result.warnings, []);
  });

  test('leaves an unresolved placeholder exactly as written', () => {
    // Blanking it would fail somewhere far from the cause; the literal fails
    // where the problem is.
    const result = substituteVariables([doc({ url: '${MISSING_VAR}' })], {});

    assert.equal(only(result).url, '${MISSING_VAR}');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /MISSING_VAR/);
  });

  test('reports each unresolved name once, however often it appears', () => {
    const result = substituteVariables([doc({ a: '${X}', b: '${X}', c: '${Y}' })], {});

    assert.equal(result.warnings.length, 2);
    assert.ok(result.warnings.some((w) => w.includes('${X}')));
    assert.ok(result.warnings.some((w) => w.includes('${Y}')));
  });

  test('names every document an unresolved placeholder appears in', () => {
    const result = substituteVariables([
      doc({ url: '${HOST}' }, { relativePath: 'domains/intake/intake-openapi.yaml' }),
      doc({ url: '${HOST}' }, { relativePath: 'domains/eligibility/eligibility-openapi.yaml' }),
    ], {});

    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /eligibility-openapi\.yaml, .*intake-openapi\.yaml/);
  });

  test('leaves non-string values unchanged', () => {
    const result = substituteVariables(
      [doc({ port: 8080, enabled: true, tags: ['a', 'b'] })],
      {}
    );

    assert.equal(only(result).port, 8080);
    assert.equal(only(result).enabled, true);
    assert.deepEqual(only(result).tags, ['a', 'b']);
    assert.deepEqual(result.warnings, []);
  });

  test('substitutes inside arrays', () => {
    const result = substituteVariables(
      [doc({ tags: ['${A}', 'literal', '${B}'] })],
      { A: 'first', B: 'second' }
    );

    assert.deepEqual(only(result).tags, ['first', 'literal', 'second']);
  });

  // ---------------------------------------------------------------------------
  // Pass contract
  // ---------------------------------------------------------------------------

  test('a document with no placeholders is returned unchanged', () => {
    const input = [doc({ info: { title: 'Untouched' } })];
    const result = substituteVariables(input, { UNUSED: 'x' });

    assert.equal(result.docs[0], input[0]);
    assert.deepEqual(result.applied, []);
  });

  test('an unresolved placeholder alone does not count as a substitution', () => {
    // Nothing changed, so the document should come back as the same object
    // even though the pass had something to say about it.
    const input = [doc({ url: '${MISSING}' })];
    const result = substituteVariables(input, {});

    assert.equal(result.docs[0], input[0]);
    assert.deepEqual(result.applied, []);
    assert.equal(result.warnings.length, 1);
  });

  test('reports how many substitutions it made, per document', () => {
    const result = substituteVariables(
      [doc({ a: '${X}', b: '${X}' }, { relativePath: 'domains/intake/intake-openapi.yaml' })],
      { X: 'value' }
    );

    assert.equal(result.applied.length, 1);
    assert.match(result.applied[0], /2 variable reference\(s\).*intake-openapi\.yaml/);
  });
});
