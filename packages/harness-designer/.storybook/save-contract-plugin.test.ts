import { describe, it, expect } from 'vitest';

/**
 * Tests for the regex patterns used in save-contract-plugin.ts.
 * These regexes guard filesystem writes, so correctness is critical.
 */

// Duplicated from save-contract-plugin.ts (not exported, so tested directly here)
const CUSTOM_FILE_RE =
  /^custom\/[a-z0-9-]+\.[a-z0-9-]+\/(test-data|permissions|layout)\.yaml$/;

const CUSTOM_DIR_RE = /^[a-z0-9-]+\.[a-z0-9-]+$/;

// =============================================================================
// CUSTOM_FILE_RE — validates file paths for saving custom story files
// =============================================================================

describe('CUSTOM_FILE_RE', () => {
  it('accepts valid layout file', () => {
    expect(CUSTOM_FILE_RE.test('custom/application-intake.citizen/layout.yaml')).toBe(true);
  });

  it('accepts valid test-data file', () => {
    expect(CUSTOM_FILE_RE.test('custom/application-intake.citizen/test-data.yaml')).toBe(true);
  });

  it('accepts valid permissions file', () => {
    expect(CUSTOM_FILE_RE.test('custom/application-intake.citizen/permissions.yaml')).toBe(true);
  });

  it('accepts multi-segment contract id', () => {
    expect(CUSTOM_FILE_RE.test('custom/app-california-caseworker-review.my-variant/layout.yaml')).toBe(true);
  });

  it('accepts numeric segments', () => {
    expect(CUSTOM_FILE_RE.test('custom/app-intake.california-2/layout.yaml')).toBe(true);
  });

  // --- Rejections ---

  it('rejects old snapshots/ prefix', () => {
    expect(CUSTOM_FILE_RE.test('snapshots/application-intake.citizen/layout.yaml')).toBe(false);
  });

  it('rejects files outside custom directory', () => {
    expect(CUSTOM_FILE_RE.test('authored/contracts/application/intake.form.yaml')).toBe(false);
  });

  it('rejects unknown file types', () => {
    expect(CUSTOM_FILE_RE.test('custom/application-intake.citizen/schema.yaml')).toBe(false);
  });

  it('rejects non-yaml extensions', () => {
    expect(CUSTOM_FILE_RE.test('custom/application-intake.citizen/layout.json')).toBe(false);
  });

  it('rejects directory traversal attempts', () => {
    expect(CUSTOM_FILE_RE.test('custom/../secrets/layout.yaml')).toBe(false);
  });

  it('rejects missing dot separator in dir name', () => {
    expect(CUSTOM_FILE_RE.test('custom/application-intake/layout.yaml')).toBe(false);
  });

  it('rejects paths with uppercase characters', () => {
    expect(CUSTOM_FILE_RE.test('custom/Application-Intake.Citizen/layout.yaml')).toBe(false);
  });

  it('rejects paths with spaces', () => {
    expect(CUSTOM_FILE_RE.test('custom/application intake.citizen/layout.yaml')).toBe(false);
  });

  it('rejects index.stories.tsx (generated file)', () => {
    expect(CUSTOM_FILE_RE.test('custom/application-intake.citizen/index.stories.tsx')).toBe(false);
  });
});

// =============================================================================
// CUSTOM_DIR_RE — validates directory names for rename/delete operations
// =============================================================================

describe('CUSTOM_DIR_RE', () => {
  it('accepts valid dir name with contract id and variant', () => {
    expect(CUSTOM_DIR_RE.test('application-intake.citizen')).toBe(true);
  });

  it('accepts numeric segments', () => {
    expect(CUSTOM_DIR_RE.test('app-california-field-requirements.california-2')).toBe(true);
  });

  it('accepts single-word segments', () => {
    expect(CUSTOM_DIR_RE.test('intake.citizen')).toBe(true);
  });

  // --- Rejections ---

  it('rejects name without dot separator', () => {
    expect(CUSTOM_DIR_RE.test('application-intake')).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(CUSTOM_DIR_RE.test('../secrets')).toBe(false);
  });

  it('rejects slashes', () => {
    expect(CUSTOM_DIR_RE.test('custom/application-intake.citizen')).toBe(false);
  });

  it('rejects uppercase characters', () => {
    expect(CUSTOM_DIR_RE.test('Application-Intake.Citizen')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(CUSTOM_DIR_RE.test('application intake.citizen')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(CUSTOM_DIR_RE.test('')).toBe(false);
  });
});
