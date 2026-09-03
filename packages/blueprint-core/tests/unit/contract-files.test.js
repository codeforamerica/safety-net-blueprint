import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { loadContractFiles, loadExternalRefs } from '../../src/contract-files.js';

function createTmpDir() {
  return mkdtempSync(join(tmpdir(), 'contract-files-test-'));
}

test('loadContractFiles', async (t) => {
  await t.test('returns empty map for non-existent dir', () => {
    const result = loadContractFiles('/nonexistent/path/that/does/not/exist');
    assert.ok(result instanceof Map);
    assert.strictEqual(result.size, 0);
  });

  await t.test('detects openapi type for *-openapi.yaml files', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'applications-openapi.yaml'), yaml.dump({ info: { title: 'Test' } }));
      const result = loadContractFiles(dir);
      const entries = [...result.values()];
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, 'openapi');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('detects state-machine type for *-state-machine.yaml files', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'applications-state-machine.yaml'), yaml.dump({ domain: 'applications' }));
      const result = loadContractFiles(dir);
      const entries = [...result.values()];
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, 'state-machine');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('detects parameters type for exactly parameters.yaml', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'parameters.yaml'), yaml.dump({ LimitParam: { name: 'limit', in: 'query' } }));
      const result = loadContractFiles(dir);
      const entries = [...result.values()];
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, 'parameters');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('detects responses type for exactly responses.yaml', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'responses.yaml'), yaml.dump({ BadRequest: { description: 'Bad request' } }));
      const result = loadContractFiles(dir);
      const entries = [...result.values()];
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, 'responses');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('detects unknown type for unrecognized filenames', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'something-random.yaml'), yaml.dump({ foo: 'bar' }));
      const result = loadContractFiles(dir);
      const entries = [...result.values()];
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, 'unknown');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('includes domain field in each entry', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'intake-openapi.yaml'), yaml.dump({ info: { title: 'Intake', 'x-domain': 'intake' } }));
      const result = loadContractFiles(dir);
      const entry = [...result.values()][0];
      assert.strictEqual(entry.domain, 'intake');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('extracts domain from content.info[x-domain] for openapi files', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'users-openapi.yaml'), yaml.dump({ info: { title: 'Users', 'x-domain': 'identity-access' } }));
      const result = loadContractFiles(dir);
      const entry = [...result.values()][0];
      assert.strictEqual(entry.domain, 'identity-access');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('extracts domain from content.domain for annotations files', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'intake-annotations.yaml'), yaml.dump({ domain: 'intake', schema: {} }));
      const result = loadContractFiles(dir);
      const entry = [...result.values()][0];
      assert.strictEqual(entry.domain, 'intake');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('extracts domain from path segment when it matches a known domain value', () => {
    const dir = createTmpDir();
    try {
      // Provide a schema file with Domain enum so known domains are populated
      writeFileSync(join(dir, 'enums-schema.yaml'), yaml.dump({
        $defs: { Domain: { type: 'string', enum: ['intake', 'workflow'] } }
      }));
      mkdirSync(join(dir, 'intake'), { recursive: true });
      writeFileSync(join(dir, 'intake', 'some-schema.yaml'), yaml.dump({ $defs: {} }));
      const result = loadContractFiles(dir);
      const entry = [...result.values()].find(e => e.relativePath === 'intake/some-schema.yaml');
      assert.strictEqual(entry.domain, 'intake');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('extracts domain from filename prefix when it matches a known domain value', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'enums-schema.yaml'), yaml.dump({
        $defs: { Domain: { type: 'string', enum: ['intake', 'workflow'] } }
      }));
      writeFileSync(join(dir, 'intake-schema.yaml'), yaml.dump({ $defs: {} }));
      const result = loadContractFiles(dir);
      const entry = [...result.values()].find(e => e.relativePath === 'intake-schema.yaml');
      assert.strictEqual(entry.domain, 'intake');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('sets domain to null when no match is found', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'parameters.yaml'), yaml.dump({ LimitParam: { name: 'limit' } }));
      const result = loadContractFiles(dir);
      const entry = [...result.values()][0];
      assert.strictEqual(entry.domain, null);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('prefers explicit x-domain over path/filename heuristics', () => {
    const dir = createTmpDir();
    try {
      writeFileSync(join(dir, 'enums-schema.yaml'), yaml.dump({
        $defs: { Domain: { type: 'string', enum: ['intake', 'identity-access'] } }
      }));
      // filename prefix is 'users' (not in enum), but x-domain is 'identity-access'
      writeFileSync(join(dir, 'users-openapi.yaml'), yaml.dump({
        info: { title: 'Users', 'x-domain': 'identity-access' }
      }));
      const result = loadContractFiles(dir);
      const entry = [...result.values()].find(e => e.relativePath === 'users-openapi.yaml');
      assert.strictEqual(entry.domain, 'identity-access');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('includes content, relativePath (forward-slash), and type in each entry', () => {
    const dir = createTmpDir();
    try {
      mkdirSync(join(dir, 'subdir'));
      writeFileSync(join(dir, 'subdir', 'cases-openapi.yaml'), yaml.dump({ info: { title: 'Cases' } }));
      const result = loadContractFiles(dir);
      const entries = [...result.values()];
      assert.strictEqual(entries.length, 1);
      const entry = entries[0];
      assert.ok(entry.content && typeof entry.content === 'object', 'content should be a parsed object');
      assert.strictEqual(entry.relativePath, 'subdir/cases-openapi.yaml');
      assert.strictEqual(entry.type, 'openapi');
      assert.deepStrictEqual(entry.content, { info: { title: 'Cases' } });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('skips node_modules and dot-prefixed directories', () => {
    const dir = createTmpDir();
    try {
      mkdirSync(join(dir, 'node_modules'));
      mkdirSync(join(dir, '.hidden'));
      writeFileSync(join(dir, 'node_modules', 'pkg-openapi.yaml'), yaml.dump({ info: {} }));
      writeFileSync(join(dir, '.hidden', 'secret-openapi.yaml'), yaml.dump({ info: {} }));
      writeFileSync(join(dir, 'visible-openapi.yaml'), yaml.dump({ info: { title: 'Visible' } }));
      const result = loadContractFiles(dir);
      assert.strictEqual(result.size, 1);
      const entry = [...result.values()][0];
      assert.strictEqual(entry.relativePath, 'visible-openapi.yaml');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('walks subdirectories recursively', () => {
    const dir = createTmpDir();
    try {
      mkdirSync(join(dir, 'a', 'b'), { recursive: true });
      writeFileSync(join(dir, 'root-openapi.yaml'), yaml.dump({ info: { title: 'Root' } }));
      writeFileSync(join(dir, 'a', 'a-openapi.yaml'), yaml.dump({ info: { title: 'A' } }));
      writeFileSync(join(dir, 'a', 'b', 'b-openapi.yaml'), yaml.dump({ info: { title: 'B' } }));
      const result = loadContractFiles(dir);
      assert.strictEqual(result.size, 3);
      const paths = [...result.values()].map(e => e.relativePath).sort();
      assert.deepStrictEqual(paths, ['a/a-openapi.yaml', 'a/b/b-openapi.yaml', 'root-openapi.yaml']);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

test('loadExternalRefs', async (t) => {
  await t.test('returns empty map when spec has no external refs', () => {
    const dir = createTmpDir();
    try {
      const specPath = join(dir, 'test-openapi.yaml');
      const rawSpec = { info: { title: 'Test' }, paths: { '/foo': { get: { responses: {} } } } };
      writeFileSync(specPath, yaml.dump(rawSpec));
      const fileMap = loadContractFiles(dir);
      const result = loadExternalRefs(specPath, rawSpec, fileMap);
      assert.ok(result instanceof Map);
      assert.strictEqual(result.size, 0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('skips https:// canonical URIs', () => {
    const dir = createTmpDir();
    try {
      const specPath = join(dir, 'test-openapi.yaml');
      const rawSpec = {
        info: { title: 'Test' },
        components: {
          schemas: { Foo: { '$ref': 'https://blueprint.codeforamerica.org/schemas/foo.yaml' } }
        }
      };
      writeFileSync(specPath, yaml.dump(rawSpec));
      const fileMap = loadContractFiles(dir);
      const result = loadExternalRefs(specPath, rawSpec, fileMap);
      assert.strictEqual(result.size, 0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('resolves relative refs to absolute paths and finds them in fileMap', () => {
    const dir = createTmpDir();
    try {
      mkdirSync(join(dir, 'domain', 'foo'), { recursive: true });
      const specPath = join(dir, 'domain', 'test-openapi.yaml');
      const schemaContent = { '$defs': { Bar: { type: 'object', properties: { id: { type: 'string' } } } } };
      writeFileSync(join(dir, 'domain', 'foo', 'bar-schema.yaml'), yaml.dump(schemaContent));
      const rawSpec = {
        info: { title: 'Test' },
        components: {
          schemas: { Bar: { '$ref': './foo/bar-schema.yaml#/$defs/Bar' } }
        }
      };
      writeFileSync(specPath, yaml.dump(rawSpec));
      const fileMap = loadContractFiles(dir);
      const result = loadExternalRefs(specPath, rawSpec, fileMap);
      assert.strictEqual(result.size, 1);
      assert.ok(result.has('./foo/bar-schema.yaml'));
      assert.deepStrictEqual(result.get('./foo/bar-schema.yaml'), schemaContent);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('returns map keyed by the original ref file part', () => {
    const dir = createTmpDir();
    try {
      mkdirSync(join(dir, 'components'), { recursive: true });
      const specPath = join(dir, 'test-openapi.yaml');
      const paramsContent = { LimitParam: { name: 'limit', in: 'query' } };
      writeFileSync(join(dir, 'components', 'parameters.yaml'), yaml.dump(paramsContent));
      const rawSpec = {
        info: { title: 'Test' },
        paths: {
          '/items': {
            get: {
              parameters: [{ '$ref': './components/parameters.yaml#/LimitParam' }]
            }
          }
        }
      };
      writeFileSync(specPath, yaml.dump(rawSpec));
      const fileMap = loadContractFiles(dir);
      const result = loadExternalRefs(specPath, rawSpec, fileMap);
      assert.ok(result.has('./components/parameters.yaml'));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  await t.test('skips refs whose resolved path is not in fileMap', () => {
    const dir = createTmpDir();
    try {
      const specPath = join(dir, 'test-openapi.yaml');
      const rawSpec = {
        info: { title: 'Test' },
        components: {
          schemas: { Missing: { '$ref': './does-not-exist.yaml#/Foo' } }
        }
      };
      writeFileSync(specPath, yaml.dump(rawSpec));
      const fileMap = loadContractFiles(dir);
      const result = loadExternalRefs(specPath, rawSpec, fileMap);
      assert.strictEqual(result.size, 0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
