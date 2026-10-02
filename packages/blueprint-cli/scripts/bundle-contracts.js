#!/usr/bin/env node
/**
 * Bundle a contract set into a single JSON artifact.
 *
 * The mock server reads contracts by walking a directory, which a browser
 * cannot do. This does the walking once, in Node, and writes what it found:
 * every document parsed, and the OpenAPI specs dereferenced. `blueprint-mock
 * --spec=contracts.json` then boots from the file, and so does a page (#448).
 *
 * What is *not* in the artifact is as deliberate as what is. Seed records,
 * config catalogs and registries are all derived from the documents at boot,
 * byte-identically, so precomputing them would be a second source of truth for
 * facts the documents already state.
 *
 * Usage:
 *   blueprint-bundle-contracts --spec=<dir> [--seed=<dir>] --out=contracts.json
 */

import { discover, load, validate } from '@codeforamerica/blueprint-core';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';

/** The shape this builder writes. Bumped when the artifact's layout changes. */
const ARTIFACT_VERSION = 1;

function parseArgs(argv) {
  const options = { specDirs: [], seedDir: null, out: null, skipValidation: false, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--skip-validation') options.skipValidation = true;
    else if (arg.startsWith('--spec=')) options.specDirs.push(arg.slice('--spec='.length));
    else if (arg.startsWith('--seed=')) options.seedDir = arg.slice('--seed='.length);
    else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

const USAGE = `
Bundle a contract set into a single JSON artifact.

Usage:
  blueprint-bundle-contracts --spec=<dir> [--spec=<dir>...] [--seed=<dir>] --out=<file>

Options:
  --spec=<dir>        Contracts directory. Repeatable.
  --seed=<dir>        Directory of *-mock-data.yaml. Defaults to --spec.
  --out=<file>        Where to write the artifact.
  --skip-validation   Write the artifact even if the contract set has errors.
  --help              Show this message.

The artifact carries every document and the dereferenced OpenAPI specs, plus a
hash of both. Seed records, config catalogs and registries are derived from the
documents at boot rather than stored.
`.trim();

/**
 * Strip a Doc down to the data a consumer can rebuild it from.
 *
 * A `Doc` carries methods, which do not survive JSON. Every reader the mock
 * server uses — `extract`, `generate`, the registry helpers — reads only these
 * fields, which is why the artifact can be plain data.
 */
function plainDoc(doc) {
  return {
    path: doc.path,
    relativePath: doc.relativePath,
    domain: doc.domain,
    type: doc.type,
    content: doc.content,
    resolved: doc.resolved,
    provenance: doc.provenance,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (options.specDirs.length === 0 || !options.out) {
    console.error(USAGE);
    process.exit(1);
  }

  const dirs = [...options.specDirs];
  if (options.seedDir && !dirs.includes(options.seedDir)) dirs.push(options.seedDir);

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      console.error(`Not found: ${dir}`);
      process.exit(1);
    }
  }

  console.log('Reading contracts...');
  const docs = dirs.flatMap((dir) => discover(dir)).map(load);
  if (docs.length === 0) {
    console.error(`No contract documents found in: ${dirs.join(', ')}`);
    process.exit(1);
  }
  console.log(`  ${docs.length} document(s) from ${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'}`);

  // Validation happens here because it cannot happen later: `validate` needs a
  // Doc's methods, and the artifact is plain data. A consumer trusts the hash
  // instead of re-checking.
  if (!options.skipValidation) {
    console.log('\nValidating...');
    const { ok, results } = validate(docs);
    const errors = results.filter((r) => r.errors?.length > 0);
    if (!ok || errors.length > 0) {
      for (const result of errors) {
        console.error(`  ✗ ${result.path}`);
        for (const error of result.errors) console.error(`      ${error.message ?? error}`);
      }
      console.error(`\n${errors.length} document(s) with errors. Fix them, or pass --skip-validation.`);
      process.exit(1);
    }
    console.log(`  ✓ ${docs.length} document(s), no errors`);
  }

  console.log('\nDereferencing OpenAPI specs...');
  const specs = {};
  for (const doc of docs.filter((d) => d.type === 'openapi')) {
    const name = basename(doc.path, '-openapi.yaml');
    specs[name] = await $RefParser.dereference(doc.path, { dereference: { circular: 'ignore' } });
    console.log(`  ✓ ${name}`);
  }

  const payload = { docs: docs.map(plainDoc), specs };
  const serialised = JSON.stringify(payload);
  const hash = createHash('sha256').update(serialised).digest('hex');

  const artifact = {
    artifactVersion: ARTIFACT_VERSION,
    createdAt: new Date().toISOString(),
    // The hash covers the payload only, so it is reproducible: re-bundling the
    // same contracts yields the same hash even though `createdAt` differs.
    integrity: { algorithm: 'sha256', hash },
    validated: !options.skipValidation,
    ...payload,
  };

  const outPath = resolve(options.out);
  writeFileSync(outPath, JSON.stringify(artifact));
  const bytes = Buffer.byteLength(JSON.stringify(artifact));

  console.log(`\n✓ Wrote ${outPath}`);
  console.log(`  ${docs.length} documents, ${Object.keys(specs).length} specs, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  sha256 ${hash.slice(0, 16)}…`);
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});
