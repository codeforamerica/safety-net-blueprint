/**
 * Tests for generate-field-inventory.mjs
 *
 * Exercises the script via subprocess so the full pipeline
 * (spec loading, dereference, schema walking, output) is covered.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'generate-field-inventory.mjs');
const FIXTURE_DIR = join(__dirname, 'fixtures');
const FIXTURE_SPEC = join(FIXTURE_DIR, 'test-openapi.yaml');
const FIXTURE_OVERLAY = join(FIXTURE_DIR, 'test-overlay.yaml');
const DEFS_FIXTURE_SPEC = join(FIXTURE_DIR, 'test-defs-openapi.yaml');

const OUT_DIR = join(tmpdir(), `fi-tests-${Date.now()}`);
mkdirSync(OUT_DIR, { recursive: true });

function run(args) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function parseInventory(content) {
  const result = {};
  for (const line of content.split('\n')) {
    if (!/^[a-z]/.test(line)) continue;
    const idx = line.indexOf(': ');
    if (idx === -1) continue;
    result[line.slice(0, idx)] = line.slice(idx + 2);
  }
  return result;
}

// ── Baseline fixture ──────────────────────────────────────────────────────────

test('scalar field types are emitted correctly', () => {
  const out = join(OUT_DIR, 'baseline.yaml');
  run([`--spec=${FIXTURE_SPEC}`, `--out=${out}`]);
  const inv = parseInventory(readFileSync(out, 'utf8'));

  assert.match(inv['application.referenceNumber'], /type: string/);
  assert.match(inv['application.submittedAt'],     /type: datetime/);
  assert.match(inv['application.interviewDate'],   /type: date/);
  assert.match(inv['application.contactEmail'],    /type: email/);
  assert.match(inv['application.isExpedited'],     /type: boolean/);
  assert.match(inv['application.householdSize'],   /type: integer/);
  assert.match(inv['application.monthlyIncome'],   /type: number/);
});

test('enum fields include values array', () => {
  const out = join(OUT_DIR, 'baseline.yaml');
  const inv = parseInventory(readFileSync(out, 'utf8'));

  assert.match(inv['application.channel'], /type: enum/);
  assert.match(inv['application.channel'], /online/);
  assert.match(inv['application.channel'], /mail/);
  assert.match(inv['application.status'],  /type: enum/);
  assert.match(inv['application.status'],  /draft/);
});

test('uuid field with x-relationship emits relationship', () => {
  const out = join(OUT_DIR, 'baseline.yaml');
  const inv = parseInventory(readFileSync(out, 'utf8'));

  assert.match(inv['application.caseWorkerId'], /type: uuid/);
  assert.match(inv['application.caseWorkerId'], /relationship: CaseWorker/);
});

test('array of enum scalars emits [] key', () => {
  const out = join(OUT_DIR, 'baseline.yaml');
  const inv = parseInventory(readFileSync(out, 'utf8'));

  assert.ok('application.programsAppliedFor[]' in inv);
  assert.match(inv['application.programsAppliedFor[]'], /type: enum/);
  assert.match(inv['application.programsAppliedFor[]'], /snap/);
});

test('nested object emits type header and sub-fields', () => {
  const out = join(OUT_DIR, 'baseline.yaml');
  const inv = parseInventory(readFileSync(out, 'utf8'));

  assert.match(inv['application.contact'],               /type: ContactInfo/);
  assert.match(inv['application.contact.name'],          /type: Name/);
  assert.match(inv['application.contact.name.firstName'], /type: string/);
  assert.match(inv['application.contact.address'],       /type: Address/);
  assert.match(inv['application.contact.address.zip'],   /type: string/);
});

test('discriminated oneOf emits shared fields and variant-specific appliesWhen', () => {
  const out = join(OUT_DIR, 'baseline.yaml');
  const inv = parseInventory(readFileSync(out, 'utf8'));

  // Shared base fields — no appliesWhen
  assert.ok('application.primaryIncome.type' in inv);
  assert.ok(!inv['application.primaryIncome.type'].includes('appliesWhen'));
  assert.ok('application.primaryIncome.monthlyAmount' in inv);

  // Variant-specific fields — annotated with appliesWhen
  assert.match(inv['application.primaryIncome.employerName'],    /appliesWhen.*employment/);
  assert.match(inv['application.primaryIncome.hoursPerWeek'],    /appliesWhen.*employment/);
  assert.match(inv['application.primaryIncome.businessName'],    /appliesWhen.*self_employment/);
  assert.match(inv['application.primaryIncome.benefitType'],     /appliesWhen.*benefit/);
  assert.match(inv['application.primaryIncome.agencyName'],      /appliesWhen.*benefit/);
});

test('sub-resource detected from path and emitted as list section', () => {
  const out = join(OUT_DIR, 'baseline.yaml');
  const inv = parseInventory(readFileSync(out, 'utf8'));

  assert.match(inv['application.members[]'], /list\(Member\)/);
  assert.match(inv['application.members[].id'],          /type: uuid/);
  assert.match(inv['application.members[].personId'],    /relationship: Person/);
  assert.match(inv['application.members[].roles\[\]'],   /type: enum/);
  assert.match(inv['application.members[].dateOfBirth'], /type: date/);
});

test('uuid fields are hoisted before other fields within their parent', () => {
  const out = join(OUT_DIR, 'baseline.yaml');
  const keys = Object.keys(parseInventory(readFileSync(out, 'utf8')));

  const idIdx       = keys.indexOf('application.members[].id');
  const personIdIdx = keys.indexOf('application.members[].personId');
  const rolesIdx    = keys.indexOf('application.members[].roles[]');

  assert.ok(idIdx < rolesIdx,       'id before roles[]');
  assert.ok(personIdIdx < rolesIdx, 'personId before roles[]');
});

test('infra fields createdAt and updatedAt are omitted', () => {
  const out = join(OUT_DIR, 'baseline.yaml');
  const inv = parseInventory(readFileSync(out, 'utf8'));

  assert.ok(!('application.createdAt' in inv));
  assert.ok(!('application.updatedAt' in inv));
  assert.ok(!('application.members[].createdAt' in inv));
});

// ── Overlay fixture ───────────────────────────────────────────────────────────

test('overlay adds fields', () => {
  const out = join(OUT_DIR, 'overlay.yaml');
  run([`--spec=${FIXTURE_SPEC}`, `--overlay=${FIXTURE_OVERLAY}`, `--out=${out}`]);
  const inv = parseInventory(readFileSync(out, 'utf8'));

  assert.ok('application.stateTrackingNumber' in inv, 'overlay-added field present');
});

test('overlay removes fields', () => {
  const out = join(OUT_DIR, 'overlay.yaml');
  const inv = parseInventory(readFileSync(out, 'utf8'));

  assert.ok(!('application.monthlyIncome' in inv), 'overlay-removed field absent');
});

test('overlay extends enum values', () => {
  const out = join(OUT_DIR, 'overlay.yaml');
  const inv = parseInventory(readFileSync(out, 'utf8'));

  assert.match(inv['application.channel'], /fax/, 'overlay-extended enum includes new value');
});

// ── $defs regression ──────────────────────────────────────────────────────────

test('resolves external $defs with internal #/$defs/ self-references', () => {
  // Regression: annotating resolver returning a parsed object caused $RefParser
  // to lose the base URL for external files, so #/$defs/Foo inside those files
  // was resolved against the root spec (which has no $defs) and failed with
  // "Token $defs does not exist".
  const out = join(OUT_DIR, 'defs.yaml');
  assert.doesNotThrow(() => run([`--spec=${DEFS_FIXTURE_SPEC}`, `--out=${out}`]));

  const inv = parseInventory(readFileSync(out, 'utf8'));
  assert.match(inv['application.contact'], /type: ContactDetails/);
  assert.match(inv['application.contact.phone'], /type: PhoneNumber/);
});
