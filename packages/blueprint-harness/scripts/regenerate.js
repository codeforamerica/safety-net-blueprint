#!/usr/bin/env node
/**
 * Regenerate all committed golden outputs for blueprint-harness.
 *
 * Usage:
 *   node packages/blueprint-harness/scripts/regenerate.js
 */

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, relative, sep } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HARNESS = resolve(__dirname, '..');
const LOCAL_ENV = join(HARNESS, 'environments/local.env');
const CLI = resolve(__dirname, '../../blueprint-cli/scripts');
const VALIDATE = join(CLI, 'validate.js');

/**
 * Where this checkout's contracts are readable, derived rather than written
 * down.
 *
 * A literal URL pins a repository, a path inside it and a branch, and goes
 * stale silently on all three — a file added on a feature branch links to a
 * 404 on main, which is exactly what happened the first time this was
 * hardcoded. Everything here comes from git, so the links point at the code
 * the page was actually built from.
 *
 * Returns null outside a repository, or with no remote, and the page then
 * names its files without linking.
 */
function sourceUrl() {
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: HARNESS, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
  };

  const remote = git('remote', 'get-url', 'origin');
  const root = git('rev-parse', '--show-toplevel');

  // The repository's default branch, not the one checked out. The built page
  // is committed, so using the current branch would put the branch name into
  // tracked output — every feature branch would diff against main for no
  // reason, and CI would produce different bytes again. The cost is that a
  // file added on a branch links to a 404 until it merges, which is the right
  // way round: the links describe what has landed.
  const ref = (git('rev-parse', '--abbrev-ref', 'origin/HEAD') ?? '').replace(/^origin\//, '');
  if (!remote || !root || !ref) return null;

  // git@host:owner/repo.git and https://host/owner/repo.git both become a
  // browsable https base.
  const browsable = remote
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\.git$/, '');
  if (!browsable.startsWith('https://')) return null;

  const contracts = join(HARNESS, 'contracts');
  const fromRoot = relative(root, contracts).split(sep).join('/');
  return `${browsable}/blob/${ref}/${fromRoot}`;
}

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('Regenerating blueprint-harness golden outputs...');

console.log('  [1/8] Resolving contracts...');
run(join(CLI, 'resolve.js'), [
  `--spec=${join(HARNESS, 'contracts')}`,
  `--overlay=${join(HARNESS, 'contracts/overlays')}`,
  `--env-variables=${LOCAL_ENV}`,
  `--out=${join(HARNESS, 'generated/resolved')}`,
]);

console.log('  [2/8] Validating resolved contracts...');
run(VALIDATE, [
  `--resolved=${join(HARNESS, 'generated/resolved')}`,
]);

console.log('  [3/8] Bundling contracts...');
run(join(CLI, 'resolve.js'), [
  `--spec=${join(HARNESS, 'contracts')}`,
  `--overlay=${join(HARNESS, 'contracts/overlays')}`,
  `--env-variables=${LOCAL_ENV}`,
  `--out=${join(HARNESS, 'generated/bundled')}`,
  '--bundle',
]);

console.log('  [4/8] Generating TypeScript clients...');
run(join(CLI, 'generate-ts-clients.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/clients')}`,
]);

console.log('  [5/8] Building explorer...');
run(join(CLI, 'build-explorer.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/explorer')}`,
  `--config=${join(HARNESS, 'explorer')}`,
  `--clients=${join(HARNESS, 'generated/clients')}`,
]);

console.log('  [6/8] Generating Postman collection...');
run(join(CLI, 'generate-postman-collection.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/postman')}`,
]);

console.log('  [7/8] Exporting JSON schemas...');
run(join(CLI, 'export-schemas.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--out=${join(HARNESS, 'generated/schemas')}`,
]);

console.log('  [8/8] Building the browser mock page...');
run(join(__dirname, 'build-mock-page.js'), [
  `--spec=${join(HARNESS, 'generated/resolved')}`,
  `--source=${join(HARNESS, 'contracts')}`,
  `--overlay=${join(HARNESS, 'contracts/overlays')}`,
  ...(sourceUrl() ? [`--source-url=${sourceUrl()}`] : []),
  `--out=${join(HARNESS, 'generated/mock')}`,
]);

console.log('Done.');


