/**
 * Every AsyncAPI document the contracts produce is valid AsyncAPI, as
 * AsyncAPI's own parser reads it.
 *
 * Nothing else checks this: validate reads AsyncAPI documents for their
 * channels and operations, not against the specification. The generated
 * events documents went unnoticed failing it, their payloads written as
 * OpenAPI writes schemas with nothing saying so (generate/events.js now
 * labels them). Resolved documents are checked, since a source document's
 * canonical https refs name nothing a parser can fetch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser, fromFile } from '@asyncapi/parser';

const packages = fileURLToPath(new URL('../../../', import.meta.url));
const SETS = {
  'the harness': join(packages, 'blueprint-harness/generated/resolved'),
  // Written by `npm run resolve`, and by preflight; not committed.
  'the safety net contracts': join(packages, 'generated/contracts'),
};

/** Every AsyncAPI document under a directory. */
function asyncapiFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return asyncapiFiles(path);
    return name.endsWith('-asyncapi.yaml') ? [path] : [];
  });
}

const ERROR = 0; // the parser's diagnostic severity for an error
const parser = new Parser();

for (const [set, dir] of Object.entries(SETS)) {
  test(`every AsyncAPI document in ${set} is valid AsyncAPI`, async (t) => {
    if (!existsSync(dir)) {
      t.skip(`${dir} isn't there; resolve the contracts to check it`);
      return;
    }
    const files = asyncapiFiles(dir);
    assert.ok(files.length > 0, `no AsyncAPI documents under ${dir}`);

    const failures = [];
    for (const file of files) {
      const { document, diagnostics } = await fromFile(parser, file).parse();
      const errors = diagnostics.filter((d) => d.severity === ERROR);
      if (!document || errors.length > 0) {
        failures.push(`${file.slice(dir.length + 1)}:\n${errors.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n')}`);
      }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}
