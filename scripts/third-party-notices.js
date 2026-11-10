/**
 * The notices a browser bundle owes the third-party code inside it.
 *
 * A package's own license is declared in its package.json, but a bundle also
 * carries code from its dependencies, and their licenses (MIT, Apache-2.0,
 * BSD) require their notice to travel with that code. A consumer who copies
 * one file shouldn't have to work out which packages are inside it, so the
 * notices go at the end of the file.
 *
 * esbuild's metafile lists every file it read. The ones under node_modules
 * belong to third-party packages; workspace packages resolve to their real
 * paths under packages/ and are the blueprint's own.
 *
 * A package that publishes no license file of its own gets one from
 * third-party-licenses/<name>/, copied from its repository, with a SOURCE file
 * giving the version it's for and where it came from.
 *
 * Nothing here throws over a missing or outdated notice: the build runs on
 * every `npm install`, and a dependency upgrade shouldn't stop that. Each
 * package's `problem` says what's wrong, and each bundle's tests fail on it,
 * so it's fixed before anything merges.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTICE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;
const SUPPLIED = join(dirname(fileURLToPath(import.meta.url)), 'third-party-licenses');

/** A directory's license and notice files, in order, read. */
const noticesIn = (dir) => (existsSync(dir) ? readdirSync(dir) : [])
  .filter((file) => NOTICE_FILE.test(file)).sort()
  .map((file) => readFileSync(join(dir, file), 'utf8').trim());

/** The version a supplied notice is for, from its SOURCE file. */
const suppliedVersion = (dir) => {
  const source = join(dir, 'SOURCE');
  return existsSync(source) ? /^version: (.+)$/m.exec(readFileSync(source, 'utf8'))?.[1].trim() ?? null : null;
};

/**
 * The third-party packages a bundle includes, with their notices.
 *
 * @param {object} metafile - esbuild's metafile
 * @param {string} workingDir - The directory esbuild resolved paths from
 * @returns {{ name: string, version: string, license: string, notices: string[], problem: string|null }[]}
 *   `problem`: why its notices can't be trusted — none found, or ones
 *   supplied for another version
 */
export function bundledPackages(metafile, workingDir) {
  const dirs = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const at = input.lastIndexOf('node_modules/');
    if (at === -1) continue;
    const rest = input.slice(at + 'node_modules/'.length).split('/');
    const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
    dirs.add(resolve(workingDir, input.slice(0, at), 'node_modules', name));
  }

  return [...dirs].map((dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const own = noticesIn(dir);
    const supplied = join(SUPPLIED, manifest.name);
    const notices = own.length > 0 ? own : noticesIn(supplied);
    const forVersion = own.length > 0 ? manifest.version : suppliedVersion(supplied);
    let problem = null;
    if (notices.length === 0) {
      problem = `has no LICENSE or NOTICE file. Copy its notices from its repository at ${manifest.version} `
        + `into scripts/third-party-licenses/${manifest.name}/, with a SOURCE file giving the version and where they came from.`;
    } else if (forVersion !== manifest.version) {
      problem = `is bundled, but scripts/third-party-licenses/${manifest.name}/ is for ${forVersion ?? 'no version'}. `
        + `Copy its notices again from its repository at ${manifest.version}, and update SOURCE.`;
    }
    return {
      name: manifest.name,
      version: manifest.version,
      license: typeof manifest.license === 'string' ? manifest.license : manifest.license?.type ?? 'UNKNOWN',
      notices,
      problem,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Each package whose notices can't be trusted, as one line. */
export const noticeProblems = (packages) =>
  packages.filter((p) => p.problem).map((p) => `${p.name}@${p.version} ${p.problem}`);

/**
 * The notices as a comment for the end of the bundle. `/*!` keeps it through
 * a consumer's own minifier.
 *
 * @param {ReturnType<typeof bundledPackages>} packages
 * @returns {string}
 */
export function noticesComment(packages) {
  const sections = packages.map(({ name, version, license, notices }) =>
    [`${name}@${version} (${license})`, '', ...notices.flatMap((text) => [text, ''])].join('\n'));
  const body = [
    'Third-party code in this file, with each package\'s license and notices:',
    '',
    ...sections.flatMap((section) => ['-'.repeat(72), section]),
  ].join('\n').replaceAll('*/', '* /');
  return `\n/*!\n${body}\n*/\n`;
}
