/**
 * Verifies that .changeset/config.json references packages that actually exist
 * in the workspace, that all publishable packages are accounted for, and that
 * release notes are written the way CONTRIBUTING.md describes.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'url';

const config = JSON.parse(readFileSync('.changeset/config.json', 'utf8'));

function getWorkspacePackages() {
  const packages = [];
  for (const dir of readdirSync('packages')) {
    try {
      const pkg = JSON.parse(readFileSync(join('packages', dir, 'package.json'), 'utf8'));
      if (pkg.name) packages.push({ name: pkg.name, private: pkg.private ?? false });
    } catch {
      // not a package directory
    }
  }
  return packages;
}

const allPackages = getWorkspacePackages();
const allPackageNames = allPackages.map(p => p.name);
const publishableNames = allPackages.filter(p => !p.private).map(p => p.name);

test('changeset fixed groups reference packages that exist', () => {
  for (const group of config.fixed ?? []) {
    for (const pkgName of group) {
      assert.ok(
        allPackageNames.includes(pkgName),
        `Fixed group references unknown package: ${pkgName}`
      );
    }
  }
});

test('changeset ignored packages exist in workspace', () => {
  for (const pkgName of config.ignore ?? []) {
    assert.ok(
      allPackageNames.includes(pkgName),
      `Ignored package not found in workspace: ${pkgName}`
    );
  }
});

test('no publishable package is in the ignore list', () => {
  const ignored = new Set(config.ignore ?? []);
  for (const pkgName of publishableNames) {
    assert.ok(
      !ignored.has(pkgName),
      `Publishable package ${pkgName} is in the ignore list — remove it or mark it private`
    );
  }
});

test('release notes are written by the repository\'s own changelog writer', async () => {
  assert.equal(config.changelog, './changelog.js');
  const writer = await import(pathToFileURL(join('.changeset', config.changelog)).href);
  assert.equal(typeof writer.getReleaseLine, 'function');
  assert.equal(typeof writer.getDependencyReleaseLine, 'function');
});

test('an entry is the changeset\'s text, without a commit hash', async () => {
  const { getReleaseLine } = await import(pathToFileURL(join('.changeset', 'changelog.js')).href);
  const entry = getReleaseLine({ summary: 'Before, x. Now y. (#1)\n\nMore detail.', commit: 'abcdef1234567' }, 'minor');
  assert.equal(entry, '- Before, x. Now y. (#1)\n\n  More detail.');
});

test('dependency updates are one line naming the new versions', async () => {
  const { getDependencyReleaseLine } = await import(pathToFileURL(join('.changeset', 'changelog.js')).href);
  const changesets = [{ commit: 'aaaaaaa' }, { commit: 'bbbbbbb' }, { commit: 'aaaaaaa' }];
  const line = getDependencyReleaseLine(changesets, [
    { name: '@codeforamerica/blueprint-core', newVersion: '0.4.0' },
    { name: '@codeforamerica/blueprint-explorer', newVersion: '0.3.0' },
  ]);
  assert.equal(line, '- Uses @codeforamerica/blueprint-core 0.4.0, @codeforamerica/blueprint-explorer 0.3.0.');
  assert.equal(getDependencyReleaseLine(changesets, []), '');
});

test('a breaking changeset bumps every package it names by at least a minor', () => {
  // CONTRIBUTING.md: a breaking change is a minor bump while packages are at
  // 0.x. A patch bump files the entry under that package's Patch Changes.
  const wrong = [];
  for (const file of readdirSync('.changeset').filter((f) => f.endsWith('.md') && f !== 'README.md')) {
    const [, front = '', body = ''] = readFileSync(join('.changeset', file), 'utf8').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
    if (!body.trimStart().startsWith('**Breaking:**')) continue;
    for (const [, name] of front.matchAll(/^["']?([^"':\s]+)["']?\s*:\s*patch\s*$/gm)) wrong.push(`${file}: ${name}`);
  }
  assert.deepEqual(wrong, [], 'A **Breaking:** changeset names these packages at patch; make them minor');
});
