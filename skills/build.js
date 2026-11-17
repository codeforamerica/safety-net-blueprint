#!/usr/bin/env node
// Builds a skill into a zip a developer can unzip into ~/.claude/skills/.
//
// The skill's own files come from skills/<name>/. Its reference/ folder is
// copied from the repo's docs at a release, not from the working tree, so the
// guidance matches the packages a developer installs from npm. Links from a
// copied doc to a file that isn't bundled point to GitHub at that release.
//
//   node skills/build.js [name] [--ref=<git ref>]
//
// name defaults to blueprint-contracts; ref defaults to the blueprint-cli
// release tag named in the skill's versions.json.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const name = args.find((arg) => !arg.startsWith('--')) ?? 'blueprint-contracts';
const source = join(here, name);
const versions = JSON.parse(readFileSync(join(source, 'versions.json'), 'utf8'));
const ref = args.find((arg) => arg.startsWith('--ref='))?.slice(6) ?? `@codeforamerica/blueprint-cli@${versions.packages['@codeforamerica/blueprint-cli']}`;
const repo = 'https://github.com/codeforamerica/safety-net-blueprint';

// What the reference folder holds: by default the framework's docs, not the
// safety-net domain docs, which are a reference implementation a developer may
// choose. A skill can say otherwise in its own bundle.json.
const bundle = existsSync(join(source, 'bundle.json')) ? JSON.parse(readFileSync(join(source, 'bundle.json'), 'utf8')) : {};
const INCLUDE = bundle.include ?? ['docs/conventions/', 'docs/architecture/', 'docs/guides/', 'docs/getting-started/new-domain-builders.md'];
const EXCLUDE = bundle.exclude ?? ['docs/architecture/domains/'];

const git = (...rest) => execFileSync('git', rest, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sha = git('rev-list', '-n1', ref).trim();
const files = git('ls-tree', '-r', '--name-only', sha, 'docs')
  .split('\n')
  .filter((path) => INCLUDE.some((prefix) => path.startsWith(prefix)) && !EXCLUDE.some((prefix) => path.startsWith(prefix)));
const bundled = new Set(files);

const out = join(here, 'dist', name);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(source, out, { recursive: true, filter: (path) => path !== join(source, 'bundle.json') });

// Point a link at the bundled copy when there is one, otherwise at GitHub.
const relink = (path, text) => text.replace(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (whole, target) => {
  const [file, anchor] = target.split('#');
  if (!file) return whole;
  const resolved = posix.normalize(posix.join(posix.dirname(path), file));
  if (bundled.has(resolved)) return whole;
  const kind = file.endsWith('/') || !posix.extname(file) ? 'tree' : 'blob';
  return `](${repo}/${kind}/${ref}/${resolved}${anchor ? `#${anchor}` : ''})`;
});

for (const path of files) {
  const target = join(out, 'reference', normalize(path));
  mkdirSync(dirname(target), { recursive: true });
  const text = git('show', `${sha}:${path}`);
  writeFileSync(target, path.endsWith('.md') ? relink(path, text) : text);
}

const notBundled = EXCLUDE.length
  ? `Not bundled: ${EXCLUDE.map((path) => `\`${path}\``).join(', ')}. Read them on GitHub at the same release when needed.\n`
  : '';
writeFileSync(join(out, 'reference', 'SOURCE.md'), `# Where these docs come from\n\nCopied from ${repo} at \`${ref}\` (${sha.slice(0, 8)}), the release that matches the package versions in \`versions.json\`. Paths match the repository's, so links between these files work as they do there. A link to a file that isn't bundled goes to GitHub at the same release.\n\n${notBundled}`);

const zip = join(here, 'dist', `${name}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, name], { cwd: join(here, 'dist') });
console.log(`${zip}\n  ${files.length} reference files from ${ref} (${sha.slice(0, 8)})`);
