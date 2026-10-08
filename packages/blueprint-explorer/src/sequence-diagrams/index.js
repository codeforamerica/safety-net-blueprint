/**
 * sequence-diagrams/index.js
 *
 * Exported build function for the sequence-diagrams tool. Coordinates the
 * three-step pipeline (validate → render → build HTML) as a single callable
 * function, so the top-level build.js can call it without spawning subprocesses.
 *
 * The individual scripts remain runnable standalone via their CLI shims.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

/**
 * @param {{ contentDir: string, resolvedDir: string }} opts
 */
export function build({ contentDir, resolvedDir }) {
  const seqConfigDir = join(contentDir, 'sequence-diagrams', 'config');
  const seqOutDir    = join(contentDir, 'sequence-diagrams');

  // Sequence diagrams are authored, not derived, so a content set that has
  // not written any has no directory for them. Each of the three steps below
  // would fail reading it, and because they are child processes the failure
  // ends the whole explorer build.
  if (!existsSync(seqConfigDir)) {
    console.log(`No sequence diagram configs in ${seqConfigDir} — skipping sequence-diagrams`);
    return { skipped: 'no sequence diagram configs in this content set' };
  }

  execFileSync(node, [
    resolve(__dirname, 'validate-config.js'),
    `--config-dir=${seqConfigDir}`,
    `--resolved=${resolvedDir}`,
  ], { stdio: 'inherit' });

  execFileSync(node, [
    resolve(__dirname, 'render-action-flow.js'),
    seqOutDir,
    `--config-dir=${seqConfigDir}`,
    `--content=${contentDir}`,
    `--resolved=${resolvedDir}`,
  ], { stdio: 'inherit' });

  execFileSync(node, [
    resolve(__dirname, 'build-phases-html.js'),
    seqOutDir,
    seqOutDir,
    `--config-dir=${seqConfigDir}`,
    `--content=${contentDir}`,
    `--resolved=${resolvedDir}`,
  ], { stdio: 'inherit' });
}
