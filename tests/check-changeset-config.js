/**
 * Verifies that .changeset/config.json references packages that actually exist
 * in the workspace, and that all publishable packages are accounted for.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
