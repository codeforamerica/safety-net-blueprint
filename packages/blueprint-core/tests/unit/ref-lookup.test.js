/**
 * Following a $ref within a set already in memory.
 *
 * These are the semantics `resolveSchemaRefs` and `load`'s `resolveRef` both
 * depend on, and which previously existed twice — once matching relative
 * paths, once joining onto a directory and reading off disk.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  splitRef,
  normalizeRefPath,
  pointerInto,
  indexByRelativePath,
  followRef,
} from '../../src/ref-lookup.js';

describe('splitRef', () => {
  test('separates the file from the pointer', () => {
    assert.deepEqual(splitRef('../schemas/intake.yaml#/$defs/Member'), {
      file: '../schemas/intake.yaml',
      pointer: '/$defs/Member',
    });
  });

  test('a same-document ref has no file part', () => {
    assert.deepEqual(splitRef('#/components/schemas/Case'), {
      file: '',
      pointer: '/components/schemas/Case',
    });
  });

  test('a whole-document ref has no pointer', () => {
    assert.deepEqual(splitRef('./shared.yaml'), { file: './shared.yaml', pointer: '' });
  });
});

describe('normalizeRefPath', () => {
  test('resolves a sibling against the referring document directory', () => {
    assert.equal(
      normalizeRefPath('./shared.yaml', 'domains/intake/intake-openapi.yaml'),
      'domains/intake/shared.yaml'
    );
  });

  test('pops parent segments', () => {
    assert.equal(
      normalizeRefPath('../../base/components/responses.yaml', 'domains/intake/intake-openapi.yaml'),
      'base/components/responses.yaml'
    );
  });

  test('a referring document at the root leaves the path alone', () => {
    assert.equal(normalizeRefPath('./shared.yaml', 'intake-openapi.yaml'), 'shared.yaml');
  });

  test('no referring path means no resolution', () => {
    assert.equal(normalizeRefPath('./shared.yaml'), 'shared.yaml');
  });
});

describe('pointerInto', () => {
  const doc = { $defs: { Member: { type: 'object' } }, list: [{ a: 1 }] };

  test('walks to the node', () => {
    assert.deepEqual(pointerInto(doc, '/$defs/Member'), { type: 'object' });
  });

  test('an empty pointer is the document', () => {
    assert.equal(pointerInto(doc, ''), doc);
  });

  test('indexes into an array', () => {
    assert.deepEqual(pointerInto(doc, '/list/0'), { a: 1 });
  });

  test('a missing segment is undefined, not a throw', () => {
    assert.equal(pointerInto(doc, '/$defs/Nope'), undefined);
    assert.equal(pointerInto(doc, '/$defs/Member/type/deeper'), undefined);
  });
});

describe('indexByRelativePath', () => {
  test('takes a Doc, which carries content', () => {
    const index = indexByRelativePath([{ relativePath: 'a.yaml', content: { x: 1 } }]);
    assert.deepEqual(index.get('a.yaml'), { x: 1 });
  });

  test('takes validate\'s shape, which carries spec', () => {
    const index = indexByRelativePath([{ relativePath: 'a.yaml', spec: { x: 1 } }]);
    assert.deepEqual(index.get('a.yaml'), { x: 1 });
  });

  test('falls back to path when there is no relativePath', () => {
    const index = indexByRelativePath([{ path: '/abs/a.yaml', content: { x: 1 } }]);
    assert.deepEqual(index.get('/abs/a.yaml'), { x: 1 });
  });

  test('first wins, so the result does not depend on order', () => {
    const index = indexByRelativePath([
      { relativePath: 'a.yaml', content: { which: 'first' } },
      { relativePath: 'a.yaml', content: { which: 'second' } },
    ]);
    assert.deepEqual(index.get('a.yaml'), { which: 'first' });
  });

  test('skips an entry with no content', () => {
    assert.equal(indexByRelativePath([{ relativePath: 'a.yaml' }]).size, 0);
  });
});

describe('followRef', () => {
  const set = indexByRelativePath([
    { relativePath: 'base/components/responses.yaml', content: { BadRequest: { description: 'bad' } } },
    { relativePath: 'domains/intake/shared.yaml', content: { $defs: { Member: { type: 'object' } } } },
  ]);

  test('resolves relative to the referring document', () => {
    const found = followRef('./shared.yaml#/$defs/Member', set, 'domains/intake/intake-openapi.yaml');
    assert.deepEqual(found.node, { type: 'object' });
  });

  test('pops parent segments to reach another directory', () => {
    const found = followRef(
      '../../base/components/responses.yaml#/BadRequest',
      set,
      'domains/intake/intake-openapi.yaml'
    );
    assert.deepEqual(found.node, { description: 'bad' });
  });

  test('reports the document the ref led to, so resolution can continue in it', () => {
    const found = followRef('./shared.yaml#/$defs/Member', set, 'domains/intake/intake-openapi.yaml');
    assert.equal(found.relativePath, 'domains/intake/shared.yaml');
    assert.deepEqual(found.content, { $defs: { Member: { type: 'object' } } });
  });

  test('a document outside the set is unresolvable — the bound is structural', () => {
    // This is what replaced computing a package root and comparing paths: a
    // ref can only name something the caller handed in.
    assert.equal(
      followRef('../../../elsewhere/secrets.yaml#/Thing', set, 'domains/intake/intake-openapi.yaml'),
      null
    );
  });

  test('a missing node in a document that does exist is a miss', () => {
    assert.equal(followRef('./shared.yaml#/$defs/Absent', set, 'domains/intake/intake-openapi.yaml'), null);
  });

  test('a same-document ref is not this function\'s job', () => {
    assert.equal(followRef('#/components/schemas/Case', set, 'domains/intake/intake-openapi.yaml'), null);
  });
});
