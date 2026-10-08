#!/usr/bin/env node
/**
 * Bundle a contract set into a single JSON artifact.
 *
 * The mock server reads contracts by walking a directory, which a browser
 * cannot do. This does the walking once, in Node, and writes what it found —
 * every document, parsed. `blueprint-mock --spec=contracts.json` then boots
 * from the file, and so does a page (#448).
 *
 * This script does three things and owns none of them. `discover` and `load`
 * read the tree, `validate` checks it, and `generate(docs, 'artifact')` decides
 * the shape — which is also where `extract(artifact, 'docs')` reads it back, so
 * the format is stated once rather than split between a writer and a reader.
 * What is left here is a command: parse arguments, report, write a file.
 *
 * What is *not* in the artifact is as deliberate as what is:
 *
 *   No derived facts. Seed records, config catalogs, compiled graphs and
 *   registries are read out of the documents at boot by the same calls Node
 *   makes, so the artifact cannot disagree with the library reading it.
 *
 *   No dereferenced copy of the specs. The refs name documents in the same
 *   set, so the set is already complete; inlining them multiplied every shared
 *   schema by the number of places referencing it, and took the artifact from
 *   0.67 MB to 3.95 MB.
 *
 * Usage:
 *   blueprint-bundle-contracts --spec=<dir> [--seed=<dir>] --out=contracts.json
 */

import { discover, load, validate, generate } from '@codeforamerica/blueprint-core';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const options = { specDirs: [], seedDir: null, out: null, domains: [], skipValidation: false, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--skip-validation') options.skipValidation = true;
    else if (arg.startsWith('--spec=')) options.specDirs.push(arg.slice('--spec='.length));
    else if (arg.startsWith('--seed=')) options.seedDir = arg.slice('--seed='.length);
    else if (arg.startsWith('--domain=')) options.domains.push(arg.slice('--domain='.length));
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
  --domain=<name>     Keep only this domain. Repeatable. Omit for every domain.
                      The platform domain is always included, as are the shared
                      schemas and components the named domains reference.
  --out=<file>        Where to write the artifact.
  --skip-validation   Write the artifact even if the contract set has errors.
  --help              Show this message.

The artifact carries every document as data, with its $refs intact. Seed
records, config catalogs, compiled graphs and registries are read out of those
documents at boot rather than stored.
`.trim();


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
  // Doc's methods, and the artifact is plain data. So a consumer cannot
  // re-check it, which is why writing a broken one takes --skip-validation.
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

  if (options.domains.length > 0) {
    const known = new Set(docs.map((doc) => doc.domain).filter(Boolean));
    const unknown = options.domains.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      console.error(`\nNo documents belong to: ${unknown.join(', ')}`);
      console.error(`Domains in this contract set: ${[...known].sort().join(', ')}`);
      process.exit(1);
    }
  }

  // No build timestamp. It was here as provenance for whoever found the file
  // later, and nothing read it — but the harness artifact is committed, so a
  // timestamp meant every regenerate produced a diff in two tracked files with
  // no contract change behind it, and ruled out ever checking freshness by
  // rebuilding and diffing.
  const artifact = generate(docs, 'artifact', { domains: options.domains });

  if (options.domains.length > 0) {
    const kept = new Set(artifact.docs.map((doc) => doc.domain ?? '(shared)'));
    console.log(`\nKept ${artifact.docs.length} of ${docs.length} documents for ` +
      `${options.domains.join(', ')}:`);
    console.log(`  domains: ${[...kept].sort().join(', ')}`);
  }

  const serialized = JSON.stringify(artifact);
  const outPath = resolve(options.out);
  writeFileSync(outPath, serialized);

  console.log(`\n✓ Wrote ${outPath}`);
  console.log(`  ${artifact.docs.length} documents, ${(Buffer.byteLength(serialized) / 1024 / 1024).toFixed(2)} MB`);
  if (options.skipValidation) {
    console.log('  Not validated — --skip-validation was passed.');
  }
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
});
