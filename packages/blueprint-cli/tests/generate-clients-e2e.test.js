/**
 * End-to-end test for the TypeScript client generation pipeline.
 *
 * These tests actually invoke the openapi-ts binary against a minimal spec so
 * that dependency version mismatches or binary resolution failures are caught
 * locally rather than only in CI.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'url';
import { exec, collectNamedEnumDefs, patchTypesGenForNamedEnums, patchDomainBarrelForNamedEnums } from '../scripts/generate-ts-clients.js';
import { bundleSpec } from '@codeforamerica/blueprint-core/bundle';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientsRoot = join(__dirname, '..');
const projectRoot = join(clientsRoot, '..', '..');

const MINIMAL_SPEC = `\
openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths:
  /items:
    get:
      operationId: listItems
      summary: List items
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ItemList'
components:
  schemas:
    Item:
      type: object
      required: [id]
      properties:
        id:
          type: string
        name:
          type: string
    ItemList:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/Item'
`;

const OPENAPI_TS_CONFIG = (specPath, outPath) => `\
export default {
  input: ${JSON.stringify(specPath)},
  output: {
    path: ${JSON.stringify(outPath)},
  },
  plugins: [
    { name: '@hey-api/typescript', enums: 'javascript', style: 'PascalCase' },
    { name: '@hey-api/sdk', validator: true },
    'zod',
    { name: '@hey-api/client-axios' },
  ],
};
`;

describe('Client generation pipeline (e2e)', () => {
  it('openapi-ts is installed in node_modules (not relying on global or registry)', () => {
    const localBin = join(clientsRoot, 'node_modules', '.bin', 'openapi-ts');
    const rootBin = join(projectRoot, 'node_modules', '.bin', 'openapi-ts');
    const found = existsSync(localBin) || existsSync(rootBin);
    assert.ok(
      found,
      `openapi-ts binary not found at ${localBin} or ${rootBin} — run npm install`
    );
  });

  it('generates TypeScript client files from a minimal OpenAPI spec', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'snb-e2e-'));
    try {
      const specPath = join(workDir, 'test-openapi.yaml');
      const outPath = join(workDir, 'out');
      const configPath = join(workDir, 'openapi-ts.config.js');

      writeFileSync(specPath, MINIMAL_SPEC);
      writeFileSync(configPath, OPENAPI_TS_CONFIG(specPath, outPath));

      // cwd must be within the project so npx resolves the installed version
      // from node_modules rather than fetching @latest from the registry
      await exec('npx', ['@hey-api/openapi-ts', '-f', configPath], { cwd: clientsRoot });

      assert.ok(existsSync(join(outPath, 'types.gen.ts')), 'types.gen.ts was not generated');
      assert.ok(existsSync(join(outPath, 'sdk.gen.ts')), 'sdk.gen.ts was not generated');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('discriminated union: zod literals use mapping keys, not hoisted $defs schema names', async () => {
    // Regression: without bundling, hey-api resolves external $defs itself and uses
    // the hoisted schema name (e.g. "shape_Circle") as the zod literal instead of
    // the discriminator mapping key (e.g. "circle"). This produces unsatisfiable unions.
    const workDir = mkdtempSync(join(tmpdir(), 'snb-e2e-'));
    try {
      mkdirSync(join(workDir, 'schemas'));

      // External schema file with $defs-based discriminated union
      writeFileSync(join(workDir, 'schemas', 'shape.yaml'), `\
discriminator:
  propertyName: type
  mapping:
    circle: "#/$defs/Circle"
    rectangle: "#/$defs/Rectangle"
oneOf:
  - $ref: "#/$defs/Circle"
  - $ref: "#/$defs/Rectangle"
$defs:
  Circle:
    title: Circle
    type: object
    properties:
      type:
        type: string
        enum: [circle]
      radius:
        type: number
  Rectangle:
    title: Rectangle
    type: object
    properties:
      type:
        type: string
        enum: [rectangle]
      width:
        type: number
      height:
        type: number
`);

      // Main spec that refs the external schema file
      const specPath = join(workDir, 'test-openapi.yaml');
      writeFileSync(specPath, `\
openapi: 3.1.0
info:
  title: Shape API
  version: 1.0.0
paths:
  /shapes:
    get:
      operationId: listShapes
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Shape'
components:
  schemas:
    Shape:
      $ref: ./schemas/shape.yaml
`);

      // Bundle the spec before passing to hey-api (same path as the generator)
      const bundled = await bundleSpec(resolvePath(specPath));
      const bundledPath = join(workDir, 'test-bundled.yaml');
      writeFileSync(bundledPath, yaml.dump(bundled, { noRefs: true }));

      const outPath = join(workDir, 'out');
      const configPath = join(workDir, 'openapi-ts.config.js');
      writeFileSync(configPath, OPENAPI_TS_CONFIG(bundledPath, outPath));

      await exec('npx', ['@hey-api/openapi-ts', '-f', configPath], { cwd: clientsRoot });

      const zodGen = readFileSync(join(outPath, 'zod.gen.ts'), 'utf8');

      // The discriminator mapping key values must appear in the output — not hoisted schema names.
      // hey-api generates z.enum(['circle']) or z.literal('circle') depending on the schema form;
      // what matters is that the correct string values are present.
      assert.ok(zodGen.includes("'circle'"), `zod.gen.ts should contain 'circle' but got:\n${zodGen}`);
      assert.ok(zodGen.includes("'rectangle'"), `zod.gen.ts should contain 'rectangle' but got:\n${zodGen}`);
      assert.ok(!zodGen.includes("'shape_Circle'"), `zod.gen.ts must not use hoisted schema name 'shape_Circle'`);
      assert.ok(!zodGen.includes("'shape_Rectangle'"), `zod.gen.ts must not use hoisted schema name 'shape_Rectangle'`);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('named enum exports: string enum $defs from external schema files are emitted as const exports', async () => {
    // Regression: dereference() inlines external $defs so hey-api never sees them as named
    // schemas and generates no named const exports. Consumers that do Object.values(EnumName)
    // to build select options lose their source. We post-process types.gen.ts to restore them.
    const workDir = mkdtempSync(join(tmpdir(), 'snb-e2e-'));
    try {
      mkdirSync(join(workDir, 'schemas'));

      // External schema with named string enum $defs
      writeFileSync(join(workDir, 'schemas', 'status.yaml'), `\
$defs:
  ApplicationStatus:
    title: ApplicationStatus
    type: string
    enum: [pending, approved, denied]
  ReviewOutcome:
    title: ReviewOutcome
    type: string
    enum: [pass, fail, defer]
  ReviewNotes:
    type: object
    properties:
      note:
        type: string
`);

      const specPath = join(workDir, 'test-openapi.yaml');
      writeFileSync(specPath, `\
openapi: 3.1.0
info:
  title: Status API
  version: 1.0.0
paths:
  /applications:
    get:
      operationId: listApplications
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Application'
components:
  schemas:
    Application:
      type: object
      properties:
        status:
          $ref: './schemas/status.yaml#/$defs/ApplicationStatus'
        outcome:
          $ref: './schemas/status.yaml#/$defs/ReviewOutcome'
`);

      // Collect and patch
      const namedEnums = collectNamedEnumDefs(resolvePath(specPath));

      // Should find the two string enum $defs, not the object $def.
      // Names use the $def name directly (no file-stem prefix).
      assert.equal(namedEnums.length, 2, `Expected 2 named enums, got ${namedEnums.length}`);
      const names = namedEnums.map(e => e.name);
      assert.ok(names.includes('ApplicationStatus'), 'Should include ApplicationStatus');
      assert.ok(names.includes('ReviewOutcome'), 'Should include ReviewOutcome');
      assert.ok(!names.includes('ReviewNotes'), 'Should not include non-enum ReviewNotes');

      // Generate a minimal types.gen.ts and patch it
      const typesGenPath = join(workDir, 'types.gen.ts');
      writeFileSync(typesGenPath, '// This file is auto-generated by @hey-api/openapi-ts\n\nexport type Application = { status?: string };\n');
      patchTypesGenForNamedEnums(typesGenPath, namedEnums);

      const result = readFileSync(typesGenPath, 'utf8');
      assert.ok(result.includes("export const ApplicationStatus = {"), 'Should export ApplicationStatus const');
      assert.ok(result.includes("PENDING: 'pending'"), 'Should have PENDING key');
      assert.ok(result.includes("APPROVED: 'approved'"), 'Should have APPROVED key');
      assert.ok(result.includes("DENIED: 'denied'"), 'Should have DENIED key');
      assert.ok(result.includes("} as const;"), 'Should end with as const');
      assert.ok(result.includes("export type ApplicationStatus ="), 'Should export ApplicationStatus type');
      assert.ok(result.includes("export const ReviewOutcome = {"), 'Should export ReviewOutcome const');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('no duplicate export const when enum is in both components/schemas and external $defs', async () => {
    // Regression: when a spec declares `components/schemas/Foo: $ref: ./external.yaml#/$defs/Foo`,
    // hey-api generates `export const Foo = ...` from the named component schema, AND
    // collectNamedEnumDefs also finds Foo in the external file's $defs. Without the dedup
    // guard, patchTypesGenForNamedEnums appends a second declaration, producing TS2451.
    const workDir = mkdtempSync(join(tmpdir(), 'snb-e2e-'));
    try {
      mkdirSync(join(workDir, 'schemas'));

      writeFileSync(join(workDir, 'schemas', 'enums.yaml'), `\
$defs:
  ItemStatus:
    type: string
    enum: [pending, active, closed]
`);

      const specPath = join(workDir, 'test-openapi.yaml');
      writeFileSync(specPath, `\
openapi: 3.1.0
info:
  title: Items API
  version: 1.0.0
paths:
  /items:
    get:
      operationId: listItems
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    $ref: '#/components/schemas/ItemStatus'
components:
  schemas:
    ItemStatus:
      $ref: './schemas/enums.yaml#/$defs/ItemStatus'
`);

      const bundled = await bundleSpec(resolvePath(specPath));
      const bundledPath = join(workDir, 'test-bundled.yaml');
      writeFileSync(bundledPath, yaml.dump(bundled, { noRefs: true }));

      const outPath = join(workDir, 'out');
      const configPath = join(workDir, 'openapi-ts.config.js');
      writeFileSync(configPath, OPENAPI_TS_CONFIG(bundledPath, outPath));
      await exec('npx', ['@hey-api/openapi-ts', '-f', configPath], { cwd: clientsRoot });

      const typesGenPath = join(outPath, 'types.gen.ts');
      const namedEnums = collectNamedEnumDefs(resolvePath(specPath));
      if (namedEnums.length > 0) patchTypesGenForNamedEnums(typesGenPath, namedEnums);

      const content = readFileSync(typesGenPath, 'utf8');
      const matches = [...content.matchAll(/^export const ItemStatus =/gm)];
      assert.equal(matches.length, 1, `ItemStatus should appear exactly once, found ${matches.length}:\n${content}`);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('barrel patching: named enum consts are re-exported as values from the domain index.ts', () => {
    // Regression: hey-api generates type-only re-exports in index.ts, so enum consts
    // appended to types.gen.ts are not reachable from the package entry point.
    const workDir = mkdtempSync(join(tmpdir(), 'snb-e2e-'));
    try {
      const namedEnums = [
        { name: 'IncomeIncomeType', values: ['employed', 'self_employed'] },
        { name: 'IncomeIncomeFrequency', values: ['monthly', 'weekly'] },
      ];

      // Simulate a hey-api-generated index.ts with type-only exports
      const indexPath = join(workDir, 'index.ts');
      writeFileSync(indexPath,
        "// This file is auto-generated by @hey-api/openapi-ts\n\n" +
        "export { createIncome } from './sdk.gen';\n" +
        "export type { Income, IncomeCreate } from './types.gen';\n"
      );

      patchDomainBarrelForNamedEnums(indexPath, namedEnums);

      const result = readFileSync(indexPath, 'utf8');
      assert.ok(
        result.includes("export { IncomeIncomeType, IncomeIncomeFrequency } from './types.gen';"),
        `barrel should export enum consts as values, got:\n${result}`
      );
      // Original type-only export should be preserved
      assert.ok(result.includes("export type { Income, IncomeCreate } from './types.gen';"), 'original type exports should be preserved');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('patchTypesGenForNamedEnums: skips enums already declared by hey-api — no duplicate export const', () => {
    // Regression: patchTypesGenForNamedEnums was appending enums that hey-api had
    // already emitted, producing TS2451 duplicate block-scoped variable errors.
    const workDir = mkdtempSync(join(tmpdir(), 'snb-e2e-'));
    try {
      const typesGenPath = join(workDir, 'types.gen.ts');
      // Simulate types.gen.ts where hey-api already emitted DecisionStatus
      writeFileSync(typesGenPath,
        '// auto-generated\n\n' +
        "export const DecisionStatus = {\n  PENDING: 'pending',\n  APPROVED: 'approved',\n} as const;\n" +
        "export type DecisionStatus = typeof DecisionStatus[keyof typeof DecisionStatus];\n"
      );

      const namedEnums = [
        { name: 'DecisionStatus', values: ['pending', 'approved'] }, // already present
        { name: 'DecisionPath', values: ['standard', 'expedited'] },  // new
      ];

      patchTypesGenForNamedEnums(typesGenPath, namedEnums);

      const result = readFileSync(typesGenPath, 'utf8');
      const matches = [...result.matchAll(/^export const DecisionStatus =/gm)];
      assert.equal(matches.length, 1, `DecisionStatus should appear exactly once, found ${matches.length}`);
      assert.ok(result.includes("export const DecisionPath ="), 'new enum DecisionPath should be appended');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('patchDomainBarrelForNamedEnums: skips enums already exported in barrel — no duplicate export', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'snb-e2e-'));
    try {
      const indexPath = join(workDir, 'index.ts');
      // Simulate barrel where hey-api already exported RoleType
      writeFileSync(indexPath,
        "export type { RoleType } from './types.gen';\n"
      );

      const namedEnums = [
        { name: 'RoleType', values: ['admin', 'worker'] },   // already present
        { name: 'StatusType', values: ['active', 'inactive'] }, // new
      ];

      patchDomainBarrelForNamedEnums(indexPath, namedEnums);

      const result = readFileSync(indexPath, 'utf8');
      const roleTypeCount = [...result.matchAll(/RoleType/g)].length;
      assert.equal(roleTypeCount, 1, `RoleType should appear exactly once in barrel, found ${roleTypeCount}`);
      assert.ok(result.includes('StatusType'), 'new enum StatusType should be added to barrel');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('full pipeline: search-helpers.ts is copied to the output directory', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'snb-e2e-'));
    try {
      const specDir = join(workDir, 'specs');
      const outDir = join(workDir, 'clients');
      mkdirSync(specDir);

      writeFileSync(join(specDir, 'test-openapi.yaml'), MINIMAL_SPEC);

      const script = join(__dirname, '..', 'scripts', 'generate-ts-clients.js');
      const result = spawnSync(process.execPath, [script, `--spec=${specDir}`, `--out=${outDir}`], {
        cwd: projectRoot,
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, `generate-ts-clients.js exited with ${result.status}:\n${result.stderr}`);
      assert.ok(
        existsSync(join(outDir, 'search-helpers.ts')),
        'search-helpers.ts was not copied to the output directory'
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('patchDomainBarrelForNamedEnums: does not skip enum whose name is a substring of an existing export', () => {
    // Regression: existing.includes(name) is a substring match — a barrel containing
    // UserRoleType would falsely block RoleType from being added, silently dropping its export.
    const workDir = mkdtempSync(join(tmpdir(), 'snb-e2e-'));
    try {
      const indexPath = join(workDir, 'index.ts');
      writeFileSync(indexPath,
        "export type { UserRoleType } from './types.gen';\n"
      );

      const namedEnums = [{ name: 'RoleType', values: ['admin', 'worker'] }];
      patchDomainBarrelForNamedEnums(indexPath, namedEnums);

      const result = readFileSync(indexPath, 'utf8');
      assert.ok(result.includes('RoleType'), 'RoleType should be added to the barrel');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
