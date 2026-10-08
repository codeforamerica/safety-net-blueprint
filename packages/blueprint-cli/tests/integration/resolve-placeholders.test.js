/**
 * Placeholder substitution, end to end through the CLI.
 *
 * These are integration tests rather than unit tests because the two
 * behaviours only exist at this level: the file-versus-environment precedence
 * is the CLI's concern — `resolve()` is handed a map and does not care where
 * it came from — and refusing to write is a decision about output that the
 * pure pipeline deliberately leaves to its caller.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOLVE = join(__dirname, '../../scripts/resolve.js');

/** A contract set with one placeholder in it, plus whatever else is passed. */
function contractsWith(placeholder) {
  const dir = mkdtempSync(join(tmpdir(), 'placeholders-'));
  mkdirSync(join(dir, 'domains/demo'), { recursive: true });
  writeFileSync(join(dir, 'domains/demo/demo-openapi.yaml'), [
    'openapi: 3.1.0',
    'info:',
    '  title: Demo',
    '  version: 1.0.0',
    '  x-domain: demo',
    `  description: ${placeholder}`,
    'servers:',
    '  - url: http://localhost:1080/demo',
    'paths: {}',
    '',
  ].join('\n'), 'utf8');
  return dir;
}

function resolveWith(specDir, { envFile = null } = {}) {
  const out = mkdtempSync(join(tmpdir(), 'placeholders-out-'));
  // Without --resolve, a spec set with no overlay and no state machines is
  // copied verbatim and never resolved — so placeholders would pass through
  // untouched and prove nothing.
  const args = [RESOLVE, `--spec=${specDir}`, `--out=${out}`, '--resolve'];
  if (envFile) args.push(`--env-variables=${envFile}`);
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { ...result, out };
}

function envFileWith(contents) {
  const path = join(mkdtempSync(join(tmpdir(), 'placeholders-env-')), 'vars.env');
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('a placeholder with no value', () => {
  test('fails the resolve and writes nothing', () => {
    // Leaving it literal is right — blanking fails far from the cause — but
    // writing it is not, because the literal then reaches an artifact.
    const result = resolveWith(contractsWith('${SUPPORT_EMAIL}'));

    assert.equal(result.status, 1, 'should exit non-zero');
    assert.match(result.stderr, /SUPPORT_EMAIL/);
    assert.equal(
      existsSync(join(result.out, 'domains/demo/demo-openapi.yaml')),
      false,
      'nothing should be written'
    );
  });

  test('succeeds once the file supplies it', () => {
    const result = resolveWith(contractsWith('${SUPPORT_EMAIL}'), {
      envFile: envFileWith('SUPPORT_EMAIL=help@example.gov\n'),
    });

    assert.equal(result.status, 0, result.stderr);
    const written = readFileSync(join(result.out, 'domains/demo/demo-openapi.yaml'), 'utf8');
    assert.match(written, /help@example\.gov/);
  });

  test('an empty value is a value', () => {
    // A local environment wants a setting switched off, which has to be
    // expressible — otherwise "no prefix" and "you forgot" are the same thing.
    const result = resolveWith(contractsWith("'${SUPPORT_EMAIL}'"), {
      envFile: envFileWith('SUPPORT_EMAIL=\n'),
    });

    assert.equal(result.status, 0, result.stderr);
  });
});

describe('the env file is the allowlist', () => {
  test('the environment supplies a value only for a variable the file declares', () => {
    const result = resolveWith(contractsWith('${SUPPORT_EMAIL}'), {
      envFile: envFileWith('SUPPORT_EMAIL=from-the-file\n'),
    });

    assert.equal(result.status, 0, result.stderr);
    const written = readFileSync(join(result.out, 'domains/demo/demo-openapi.yaml'), 'utf8');
    assert.match(written, /from-the-file/);
  });

  test('a machine variable the file does not declare is not substituted', () => {
    // The whole environment used to be spread over the file, so a contract
    // naming ${HOME} silently absorbed whoever ran the command.
    const envFile = envFileWith('SUPPORT_EMAIL=help@example.gov\n');
    const result = resolveWith(contractsWith('${HOME}'), { envFile });

    assert.equal(result.status, 1, 'an undeclared variable is unresolved, not ambient');
    assert.match(result.stderr, /HOME/);
  });
});
