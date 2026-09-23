#!/usr/bin/env node
/**
 * Verify every test file on disk is actually run by something.
 *
 * A test suite that silently runs fewer tests than it appears to still
 * reports success, so nothing fails and nobody looks. This repo has hit that
 * twice: a `tests/unit/*.test.js` glob that skipped every subdirectory, and
 * `node --test tests/unit`, which scans on Node 20 but on Node 21+ tries to
 * execute the directory as a module and runs nothing at all.
 *
 * The invariant checked here is a set comparison, not a count: every
 * `*.test.{js,ts,mjs}` under a package's `tests/` directory must be matched by
 * one of that package's own test scripts. Counts would go stale on every added
 * test and get "fixed" by bumping the number; naming the unreachable file is
 * what makes the failure actionable.
 *
 * Nothing here is hardcoded — packages come from the workspace globs, test
 * files from disk, and the set each package runs from its own scripts. A new
 * package, tier, or test directory is covered the moment it exists.
 *
 * Discovery is never reimplemented. Scripts that call `node --test` are
 * resolved with Node's own glob, and packages with a custom runner are asked
 * via `--list`, so this cannot drift from what actually executes.
 *
 * Usage: node tests/check-test-discovery.js
 */

import { globSync, existsSync, readFileSync } from 'fs';
import { join, relative, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const TEST_FILE_GLOB = 'tests/**/*.test.{js,ts,mjs}';

/** Compare and print paths one way on every platform. */
const posix = (p) => p.split(sep).join('/');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * Every workspace package directory, from the root package.json.
 *
 * @returns {string[]} Absolute paths
 */
function workspacePackages() {
  const { workspaces = [] } = readJson(join(repoRoot, 'package.json'));
  const patterns = Array.isArray(workspaces) ? workspaces : workspaces.packages ?? [];

  return patterns
    .flatMap((pattern) => globSync(pattern, { cwd: repoRoot }))
    .map((dir) => join(repoRoot, dir))
    .filter((dir) => existsSync(join(dir, 'package.json')))
    .sort();
}

/**
 * The test files a package's scripts would actually run.
 *
 * Two shapes appear in this repo, and both are asked rather than assumed:
 * `node --test <patterns>` is expanded with the same glob Node uses, and a
 * custom runner is invoked with `--list` to report for itself.
 *
 * @param {string} pkgDir - Absolute package directory
 * @param {Record<string, string>} scripts - That package's npm scripts
 * @returns {{ covered: Set<string>, sources: string[] }} Covered paths are
 *   package-relative and posix-separated; `sources` names what claimed them
 */
function filesCoveredByScripts(pkgDir, scripts) {
  const covered = new Set();
  const sources = [];

  for (const [name, script] of Object.entries(scripts)) {
    if (!name.startsWith('test')) continue;

    const runner = script.match(/node\s+(\S*tests\/run-tests\.js)/);
    if (runner) {
      const listed = execFileSync(process.execPath, [runner[1], '--list'], {
        cwd: pkgDir,
        encoding: 'utf8',
      })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      if (listed.length) {
        listed.forEach((file) => covered.add(posix(join('tests', file))));
        sources.push(name);
      }
      continue;
    }

    // `node --test` with no path argument scans the whole package.
    const nodeTest = script.match(/node\s+--test\b(.*)$/);
    if (!nodeTest) continue;

    const patterns = [...nodeTest[1].matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)]
      .map((m) => m[1] ?? m[2] ?? m[3])
      .filter((arg) => !arg.startsWith('-'));

    const matched = patterns.length
      ? patterns.flatMap((pattern) => globSync(pattern, { cwd: pkgDir }))
      : globSync(TEST_FILE_GLOB, { cwd: pkgDir });

    if (matched.length) {
      matched.forEach((file) => covered.add(posix(file)));
      sources.push(name);
    }
  }

  return { covered, sources };
}

let unreachable = 0;
let checked = 0;

for (const pkgDir of workspacePackages()) {
  if (!existsSync(join(pkgDir, 'tests'))) continue;

  const onDisk = globSync(TEST_FILE_GLOB, { cwd: pkgDir }).map(posix).sort();
  if (!onDisk.length) continue;

  const name = readJson(join(pkgDir, 'package.json')).name;
  const { covered, sources } = filesCoveredByScripts(pkgDir, readJson(join(pkgDir, 'package.json')).scripts ?? {});
  const missing = onDisk.filter((file) => !covered.has(file));

  checked += onDisk.length;

  if (missing.length) {
    unreachable += missing.length;
    console.error(`✗ ${name} — ${missing.length} of ${onDisk.length} test file(s) run by nothing:`);
    missing.forEach((file) => console.error(`    ${file}`));
    console.error(`  scripts checked: ${sources.join(', ') || '(none matched any file)'}`);
  } else {
    console.log(`✓ ${name} — all ${onDisk.length} test file(s) reachable via ${sources.join(', ')}`);
  }
}

if (unreachable) {
  console.error(`\n${unreachable} test file(s) exist but no test script runs them.`);
  console.error('Fix the script that should match them — do not delete the tests.');
  process.exit(1);
}

console.log(`\nAll ${checked} test files across the workspace are reachable.`);
