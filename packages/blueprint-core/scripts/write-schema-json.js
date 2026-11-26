#!/usr/bin/env node
/**
 * Write the JSON copy of each core schema a browser needs: a page can import
 * JSON but can't read YAML. The YAML is the source; tests/unit/schema-json
 * fails when a copy disagrees with it.
 *
 * Usage: node scripts/write-schema-json.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

/** The schemas with a JSON copy, by file name without extension. */
export const WITH_JSON = ['routing-schema'];

const schemas = resolve(dirname(fileURLToPath(import.meta.url)), '../schemas');

/** A schema's JSON copy, as written. */
export const jsonOf = (name) => `${JSON.stringify(yaml.load(readFileSync(resolve(schemas, `${name}.yaml`), 'utf8')), null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const name of WITH_JSON) {
    writeFileSync(resolve(schemas, `${name}.json`), jsonOf(name));
    console.log(`Wrote schemas/${name}.json`);
  }
}
