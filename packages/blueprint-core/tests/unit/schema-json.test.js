/**
 * A schema a browser needs has a JSON copy beside its YAML, since a page can
 * import JSON but can't read YAML. The YAML is the source; this fails when a
 * copy is out of date, naming the script that writes it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WITH_JSON, jsonOf } from '../../scripts/write-schema-json.js';

for (const name of WITH_JSON) {
  test(`schemas/${name}.json matches its YAML`, () => {
    const written = readFileSync(new URL(`../../schemas/${name}.json`, import.meta.url), 'utf8');
    assert.equal(written, jsonOf(name), `schemas/${name}.json is out of date: run node scripts/write-schema-json.js in blueprint-core`);
  });
}
