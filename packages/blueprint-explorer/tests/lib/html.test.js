import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { esc, titleCase, methodBadge, typeBadge, statusBadge } from '../../src/lib/html.js';

describe('esc', () => {
  it('escapes &', () => assert.equal(esc('a & b'), 'a &amp; b'));
  it('escapes <', () => assert.equal(esc('<tag>'), '&lt;tag&gt;'));
  it('escapes "', () => assert.equal(esc('"quoted"'), '&quot;quoted&quot;'));
  it('handles null/undefined', () => assert.equal(esc(null), ''));
  it('handles numbers', () => assert.equal(esc(42), '42'));
});

describe('titleCase', () => {
  it('converts kebab-case', () => assert.equal(titleCase('case-management'), 'Case Management'));
  it('converts snake_case', () => assert.equal(titleCase('case_management'), 'Case Management'));
  it('handles null', () => assert.equal(titleCase(null), ''));
});

describe('methodBadge', () => {
  it('renders GET badge with text', () => assert.match(methodBadge('get'), /GET/));
  it('renders POST badge', () => assert.match(methodBadge('post'), /POST/));
  it('renders unknown method without error', () => assert.match(methodBadge('trace'), /TRACE/));
});

describe('typeBadge', () => {
  it('renders string type', () => assert.match(typeBadge('string'), /string/));
  it('renders array type', () => assert.match(typeBadge('array[string]'), /array\[string\]/));
});

describe('statusBadge', () => {
  it('renders Planned badge for unknown/missing status', () => assert.match(statusBadge(undefined), /Planned/));
  it('renders Complete badge for implemented', () => assert.match(statusBadge('implemented'), /Complete/));
  it('renders Stable badge for stable', () => assert.match(statusBadge('stable'), /Stable/));
});
