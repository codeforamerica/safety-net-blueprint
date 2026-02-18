#!/usr/bin/env node
/**
 * Storybook Story Generator
 *
 * Reads contract YAML files with a `storybook` metadata section and generates
 * corresponding .stories.tsx files. Run via: npm run generate:stories
 *
 * Conventions:
 *   Contract:    authored/contracts/{domain}/{name}.form.yaml
 *   Annotations: generated/annotations/{layer}.yaml  (optional)
 *   Fixtures:    authored/fixtures/{contract-id}.yaml
 *   Permissions: authored/permissions/{storybook.permissions}.yaml
 *   Zod schema:  generated/schemas/{schema}-{scope}.ts  (exports {schema}{Create|Update}Schema)
 *   Story file:  storybook/stories/{PascalCase}.stories.tsx
 *   Scenarios:   storybook/scenarios/{contract-id}.{scenario-name}/
 *   Scenario stories: storybook/scenarios/{contract-id}.{scenario-name}/index.stories.tsx
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { dirs } from '../config.js';

const ROOT = join(import.meta.dirname, '../..');
const CONTRACTS_DIR = join(ROOT, dirs.contracts);
const PERMISSIONS_DIR = join(ROOT, dirs.permissions);
const FIXTURES_DIR = join(ROOT, dirs.fixtures);
const STORIES_DIR = join(ROOT, dirs.stories);
const SCENARIOS_DIR = join(ROOT, dirs.scenarios);

// =============================================================================
// Name utilities
// =============================================================================

function toPascalCase(kebab) {
  return kebab
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function toCamelCase(kebab) {
  const pascal = toPascalCase(kebab);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Derive schema import info from the form.schema and form.scope fields.
 *
 * schema is a simple object name like "Application".
 * scope is an optional state name like "california" or "colorado".
 * layout determines the CRUD variant: wizard → Create, review/reference → Update.
 *
 * File resolution:
 *   scope: "california" → generated/schemas/application-california.ts
 *   no scope           → generated/schemas/application.ts
 */
function parseSchemaRef(schemaName, scope, layout) {
  const baseModule = schemaName.toLowerCase();
  const variant = layout === 'wizard' ? 'Create' : 'Update';
  const zodImport = toCamelCase(schemaName) + variant + 'Schema';

  if (scope) {
    const scopedModule = `${baseModule}-${scope}`;
    const scopedFile = join(ROOT, dirs.schemas, `${scopedModule}.ts`);
    if (existsSync(scopedFile)) {
      return { schemaName, zodImport, zodModule: scopedModule };
    }
  }

  return { schemaName, zodImport, zodModule: baseModule };
}

/**
 * Discover scenario directories for a given contract id.
 * Returns array of { scenarioName, dir } objects.
 */
function discoverScenarios(contractId) {
  if (!existsSync(SCENARIOS_DIR)) return [];

  const requiredFiles = ['test-data.yaml', 'permissions.yaml', 'layout.yaml'];
  const prefix = `${contractId}.`;
  return readdirSync(SCENARIOS_DIR)
    .filter(entry => {
      if (!entry.startsWith(prefix)) return false;
      const entryPath = join(SCENARIOS_DIR, entry);
      if (!statSync(entryPath).isDirectory()) return false;
      // Only valid if all three YAML files exist
      return requiredFiles.every(f => existsSync(join(entryPath, f)));
    })
    .map(dir => {
      const scenarioName = dir.slice(prefix.length);
      return { scenarioName, dir };
    })
    .sort((a, b) => a.scenarioName.localeCompare(b.scenarioName));
}

/**
 * Discover form contracts within domain subdirectories.
 * Returns array of { domain, filename, filePath } objects.
 */
function discoverContracts() {
  const results = [];
  if (!existsSync(CONTRACTS_DIR)) return results;

  for (const domain of readdirSync(CONTRACTS_DIR)) {
    const domainPath = join(CONTRACTS_DIR, domain);
    if (!statSync(domainPath).isDirectory()) continue;

    for (const file of readdirSync(domainPath)) {
      if (!file.endsWith('.form.yaml')) continue;
      results.push({
        domain,
        filename: file,
        filePath: join(domainPath, file),
      });
    }
  }
  return results;
}

// =============================================================================
// Annotation helpers (flat: generated/annotations/{layer}.yaml)
// =============================================================================

const ANNOTATIONS_DIR = join(ROOT, dirs.annotations);

/**
 * Discover annotation layer files, filtered to the requested layer names.
 * Annotations are flat files: generated/annotations/federal.yaml, california.yaml, etc.
 * Returns array of { name, rootRelative, filename } objects.
 */
function discoverAnnotationLayers(domain, layerNames) {
  if (!existsSync(ANNOTATIONS_DIR)) return [];

  return layerNames
    .map(name => {
      const filePath = join(ANNOTATIONS_DIR, `${name}.yaml`);
      if (!existsSync(filePath)) return null;
      return {
        name,
        rootRelative: `generated/annotations/${name}.yaml`,
        filename: `generated/annotations/${name}.yaml`,
      };
    })
    .filter(Boolean);
}

/**
 * Generate the annotation import + merge block for wizard/review stories.
 * Layers are merged into a single annotationLookup for badge display.
 */
function annotationBlock(domain, zodModule, importPrefix, layerNames) {
  if (!layerNames || layerNames.length === 0) {
    return { imports: '', setup: '', prop: '' };
  }
  const layers = discoverAnnotationLayers(domain, layerNames);
  if (layers.length === 0) {
    return { imports: '', setup: '', prop: '' };
  }

  // importPrefix + /.. gets from the story file's directory up to the package root
  const rootPrefix = importPrefix + '/..';
  const imports = layers.map((l, i) =>
    `import annotationLayer${i} from '${rootPrefix}/${l.rootRelative}';\nimport annotationLayer${i}Yaml from '${rootPrefix}/${l.rootRelative}?raw';`
  ).join('\n');

  const layerArrayEntries = layers.map((_, i) =>
    `  annotationLayer${i} as unknown as Record<string, unknown>,`
  ).join('\n');

  const setup = `
function mergeAnnotationLayers(layers: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, Record<string, unknown>> = {};
  for (const layer of layers) {
    const fields = (layer as any).fields ?? {};
    for (const [ref, entry] of Object.entries(fields) as [string, any][]) {
      if (!merged[ref]) merged[ref] = {};
      const m = merged[ref] as any;
      for (const [k, v] of Object.entries(entry)) {
        if (k === 'programs') {
          m.programs = { ...m.programs, ...v as Record<string, string> };
        } else {
          m[k] = v;
        }
      }
    }
  }
  return { fields: merged };
}

function deriveAnnotationLookup(data: Record<string, unknown>): Record<string, string[]> {
  const fields = (data as any).fields ?? {};
  const result: Record<string, string[]> = {};
  for (const [ref, meta] of Object.entries(fields)) {
    const programs = (meta as any)?.programs;
    if (programs) result[ref] = Object.keys(programs);
  }
  return result;
}

const mergedAnnotations = mergeAnnotationLayers([
${layerArrayEntries}
]);
const annotationLookup = deriveAnnotationLookup(mergedAnnotations);`;

  const prop = `\n        annotations={annotationLookup}`;

  return { imports: `// Annotations\n${imports}`, setup, prop };
}

/**
 * Generate the annotations reference tab entries (one per layer).
 */
function annotationsTabEntry(domain, zodModule, layerNames) {
  if (!layerNames || layerNames.length === 0) return '';
  const layers = discoverAnnotationLayers(domain, layerNames);
  return layers.map((l, i) =>
    `\n    { id: 'annotations-${l.name}', label: '${toPascalCase(l.name)} Annotations', filename: '${l.filename}', source: annotationLayer${i}Yaml, readOnly: true, group: 'reference' as const },`
  ).join('');
}

// =============================================================================
// Template: wizard layout
// =============================================================================

function generateWizardStory(contract, domain) {
  const { id, title, pages, schema, scope } = contract.form;
  const { role, permissions } = contract.form.storybook;
  const annotations = contract.form.annotations ?? [];
  const { zodImport, zodModule } = parseSchemaRef(schema, scope, 'wizard');
  const pascalName = toPascalCase(id);
  const ann = annotationBlock(domain, zodModule, '..', annotations);
  const annTab = annotationsTabEntry(domain, zodModule, annotations);

  return `// Auto-generated from authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../../src/engine/FormRenderer';
import { ContractPreview, type EditorTab } from '../../src/engine/ContractPreview';
import { ${zodImport} } from '../../generated/schemas/${zodModule}';
import type { FormContract, Role, PermissionsPolicy } from '../../src/engine/types';

// Layout
import contract from '../../authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml';
import layoutYaml from '../../authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml?raw';
// Test data
import fixtures from '../../authored/fixtures/${id}.yaml';
import fixturesYaml from '../../authored/fixtures/${id}.yaml?raw';
// Permissions
import permsData from '../../authored/permissions/${permissions}.yaml';
import permsYaml from '../../authored/permissions/${permissions}.yaml?raw';
// Schema (read-only Zod source)
import schemaSource from '../../generated/schemas/${zodModule}.ts?raw';
${ann.imports}

const typedContract = contract as unknown as FormContract;
const typedFixtures = fixtures as unknown as Record<string, unknown>;
const typedPerms = permsData as unknown as PermissionsPolicy;
${ann.setup}

const meta: Meta = {
  title: 'Forms/${title}',
  parameters: { layout: 'fullscreen' },
};

export default meta;

const logSubmit = (data: Record<string, unknown>) => {
  console.log('Form submitted:', data);
  alert('Submitted! Check console for data.');
};

function StoryWrapper() {
  const [activeContract, setActiveContract] = useState(typedContract);
  const [testData, setTestData] = useState(typedFixtures);
  const [perms, setPerms] = useState(typedPerms);

  const tabs: EditorTab[] = [
    { id: 'layout', label: 'Layout', filename: 'authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: 'authored/fixtures/${id}.yaml', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: 'authored/permissions/${permissions}.yaml', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: 'generated/schemas/${zodModule}.ts', source: schemaSource, readOnly: true, group: 'reference' as const },${annTab}
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="${id}"
      formTitle="${title}"
      onLayoutChange={setActiveContract}
      onPermissionsChange={setPerms}
      onTestDataChange={setTestData}
    >
      <FormRenderer
        contract={activeContract}
        schema={${zodImport}}
        role={'${role}' as Role}
        initialPage={0}
        defaultValues={testData}
        permissionsPolicy={perms}${ann.prop}
        onSubmit={logSubmit}
      />
    </ContractPreview>
  );
}

export const ${pascalName}: StoryObj = {
  name: '${title}',
  render: () => <StoryWrapper />,
};
`;
}

// =============================================================================
// Template: review layout
// =============================================================================

function generateReviewStory(contract, domain) {
  const { id, title, schema, scope } = contract.form;
  const { role, permissions } = contract.form.storybook;
  const annotations = contract.form.annotations ?? [];
  const { zodImport, zodModule } = parseSchemaRef(schema, scope, 'review');
  const pascalName = toPascalCase(id);
  const ann = annotationBlock(domain, zodModule, '..', annotations);
  const annTab = annotationsTabEntry(domain, zodModule, annotations);

  return `// Auto-generated from authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../../src/engine/FormRenderer';
import { ContractPreview, type EditorTab } from '../../src/engine/ContractPreview';
import { ${zodImport} } from '../../generated/schemas/${zodModule}';
import type { FormContract, PermissionsPolicy } from '../../src/engine/types';

// Layout
import contract from '../../authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml';
import layoutYaml from '../../authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml?raw';
// Test data
import fixtures from '../../authored/fixtures/${id}.yaml';
import fixturesYaml from '../../authored/fixtures/${id}.yaml?raw';
// Permissions
import permsData from '../../authored/permissions/${permissions}.yaml';
import permsYaml from '../../authored/permissions/${permissions}.yaml?raw';
// Schema (read-only Zod source)
import schemaSource from '../../generated/schemas/${zodModule}.ts?raw';
${ann.imports}

const typedContract = contract as unknown as FormContract;
const typedFixtures = fixtures as unknown as Record<string, unknown>;
const typedPerms = permsData as unknown as PermissionsPolicy;
${ann.setup}

const meta: Meta = {
  title: 'Forms/${title}',
  parameters: { layout: 'fullscreen' },
};

export default meta;

const logSubmit = (data: Record<string, unknown>) => {
  console.log('Form submitted:', data);
  alert('Submitted! Check console for data.');
};

function StoryWrapper() {
  const [activeContract, setActiveContract] = useState(typedContract);
  const [testData, setTestData] = useState(typedFixtures);
  const [perms, setPerms] = useState(typedPerms);

  const tabs: EditorTab[] = [
    { id: 'layout', label: 'Layout', filename: 'authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: 'authored/fixtures/${id}.yaml', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: 'authored/permissions/${permissions}.yaml', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: 'generated/schemas/${zodModule}.ts', source: schemaSource, readOnly: true, group: 'reference' as const },${annTab}
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="${id}"
      formTitle="${title}"
      onLayoutChange={setActiveContract}
      onPermissionsChange={setPerms}
      onTestDataChange={setTestData}
    >
      <FormRenderer
        contract={activeContract}
        schema={${zodImport}}
        role="${role}"
        defaultValues={testData}
        permissionsPolicy={perms}${ann.prop}
        onSubmit={logSubmit}
      />
    </ContractPreview>
  );
}

export const ${pascalName}: StoryObj = {
  name: '${title}',
  render: () => <StoryWrapper />,
};
`;
}

// =============================================================================
// Template: split-panel layout
// =============================================================================

function generateSplitPanelStory(contract, domain) {
  const { id, title, schema, scope, panels } = contract.form;
  const { role, permissions } = contract.form.storybook;
  const annotations = contract.form.annotations ?? [];
  const { zodImport, zodModule } = parseSchemaRef(schema, scope, 'review');
  const pascalName = toPascalCase(id);
  const ann = annotationBlock(domain, zodModule, '..', annotations);
  const annTab = annotationsTabEntry(domain, zodModule, annotations);

  const leftMode = panels?.left?.mode ?? 'editable';
  const rightMode = panels?.right?.mode ?? 'readonly';
  const leftLabel = panels?.left?.label ?? 'Left Panel';
  const rightLabel = panels?.right?.label ?? 'Right Panel';

  return `// Auto-generated from authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { SplitPanelRenderer } from '../../src/engine/SplitPanelRenderer';
import { ContractPreview, type EditorTab } from '../../src/engine/ContractPreview';
import { ${zodImport} } from '../../generated/schemas/${zodModule}';
import type { FormContract, PermissionsPolicy, ViewMode } from '../../src/engine/types';

// Layout
import contract from '../../authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml';
import layoutYaml from '../../authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml?raw';
// Test data
import fixtures from '../../authored/fixtures/${id}.yaml';
import fixturesYaml from '../../authored/fixtures/${id}.yaml?raw';
// Permissions
import permsData from '../../authored/permissions/${permissions}.yaml';
import permsYaml from '../../authored/permissions/${permissions}.yaml?raw';
// Schema (read-only Zod source)
import schemaSource from '../../generated/schemas/${zodModule}.ts?raw';
${ann.imports}

const typedContract = contract as unknown as FormContract;
const typedFixtures = fixtures as unknown as Record<string, unknown>;
const typedPerms = permsData as unknown as PermissionsPolicy;
${ann.setup}

const meta: Meta = {
  title: 'Forms/${title}',
  parameters: { layout: 'fullscreen' },
};

export default meta;

const logSubmit = (data: Record<string, unknown>) => {
  console.log('Form submitted:', data);
  alert('Submitted! Check console for data.');
};

function StoryWrapper() {
  const [activeContract, setActiveContract] = useState(typedContract);
  const [testData, setTestData] = useState(typedFixtures);
  const [perms, setPerms] = useState(typedPerms);

  const tabs: EditorTab[] = [
    { id: 'layout', label: 'Layout', filename: 'authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: 'authored/fixtures/${id}.yaml', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: 'authored/permissions/${permissions}.yaml', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: 'generated/schemas/${zodModule}.ts', source: schemaSource, readOnly: true, group: 'reference' as const },${annTab}
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="${id}"
      formTitle="${title}"
      onLayoutChange={setActiveContract}
      onPermissionsChange={setPerms}
      onTestDataChange={setTestData}
    >
      <SplitPanelRenderer
        contract={activeContract}
        schema={${zodImport}}
        role="${role}"
        panels={{
          left: { label: '${leftLabel}', viewMode: '${leftMode}' as ViewMode, data: testData },
          right: { label: '${rightLabel}', viewMode: '${rightMode}' as ViewMode, data: testData },
        }}
        permissionsPolicy={perms}${ann.prop}
        onSubmit={logSubmit}
      />
    </ContractPreview>
  );
}

export const ${pascalName}: StoryObj = {
  name: '${title}',
  render: () => <StoryWrapper />,
};
`;
}

// =============================================================================
// Template: scenario story (co-located in storybook/scenarios/{dir}/)
// =============================================================================

function generateScenarioStory(contract, scenarioName, domain) {
  const { id, title, schema, scope } = contract.form;
  const layout = contract.form.layout || 'wizard';
  const { role } = contract.form.storybook;
  const annotations = contract.form.annotations ?? [];
  const { zodImport, zodModule } = parseSchemaRef(schema, scope, layout);

  const scenarioDisplayName = scenarioName.replace(/-/g, ' ');

  const roleType = layout === 'wizard' ? ', Role' : '';
  const ann = annotationBlock(domain, zodModule, '../..', annotations);
  const annTab = annotationsTabEntry(domain, zodModule, annotations);

  return `// Auto-generated scenario story. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../../../src/engine/FormRenderer';
import { ContractPreview, type EditorTab } from '../../../src/engine/ContractPreview';
import { ${zodImport} } from '../../../generated/schemas/${zodModule}';
import type { FormContract${roleType}, PermissionsPolicy } from '../../../src/engine/types';

// Scenario: all three files are co-located in this directory
import scenarioLayout from './layout.yaml';
import scenarioLayoutYaml from './layout.yaml?raw';
import scenarioFixtures from './test-data.yaml';
import scenarioFixturesYaml from './test-data.yaml?raw';
import scenarioPerms from './permissions.yaml';
import scenarioPermsYaml from './permissions.yaml?raw';
// Schema (read-only Zod source)
import schemaSource from '../../../generated/schemas/${zodModule}.ts?raw';
${ann.imports}

const typedContract = scenarioLayout as unknown as FormContract;
const typedFixtures = scenarioFixtures as unknown as Record<string, unknown>;
const typedPerms = scenarioPerms as unknown as PermissionsPolicy;
${ann.setup}

const meta: Meta = {
  title: 'Scenarios/${title}: ${scenarioDisplayName}',
  parameters: { layout: 'fullscreen' },
};

export default meta;

const logSubmit = (data: Record<string, unknown>) => {
  console.log('Form submitted:', data);
  alert('Submitted! Check console for data.');
};

function StoryWrapper(${layout === 'wizard' ? `{
  initialPage = 0,
  role = '${role}' as Role,
}: {
  initialPage?: number;
  role?: Role;
}` : ''}) {
  const [activeContract, setActiveContract] = useState(typedContract);
  const [testData, setTestData] = useState(typedFixtures);
  const [perms, setPerms] = useState(typedPerms);

  const tabs: EditorTab[] = [
    { id: 'layout', label: 'Layout', filename: 'storybook/scenarios/${id}.${scenarioName}/layout.yaml', source: scenarioLayoutYaml },
    { id: 'test-data', label: 'Test Data', filename: 'storybook/scenarios/${id}.${scenarioName}/test-data.yaml', source: scenarioFixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: 'storybook/scenarios/${id}.${scenarioName}/permissions.yaml', source: scenarioPermsYaml },
    { id: 'schema', label: 'Schema', filename: 'generated/schemas/${zodModule}.ts', source: schemaSource, readOnly: true, group: 'reference' as const },${annTab}
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="${id}"
      formTitle="${title}"
      onLayoutChange={setActiveContract}
      onPermissionsChange={setPerms}
      onTestDataChange={setTestData}
    >
      <FormRenderer
        contract={activeContract}
        schema={${zodImport}}
        role="${role}"${layout === 'wizard' ? `
        initialPage={initialPage}` : ''}
        defaultValues={testData}
        permissionsPolicy={perms}${ann.prop}
        onSubmit={logSubmit}
      />
    </ContractPreview>
  );
}

export const ${toPascalCase(scenarioName)}: StoryObj = {
  name: '${title}: ${scenarioDisplayName}',
  render: () => <StoryWrapper />,
};
`;
}

// =============================================================================
// Template: reference layout
// =============================================================================

/**
 * Discover all permissions YAML files in authored/permissions/.
 * Returns array of { role, filename } objects.
 */
function discoverPermissions() {
  if (!existsSync(PERMISSIONS_DIR)) return [];
  return readdirSync(PERMISSIONS_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => ({ role: f.replace('.yaml', ''), filename: f }))
    .sort((a, b) => a.role.localeCompare(b.role));
}

/**
 * Discover the resolved OpenAPI spec for a contract.
 * Uses scope (e.g. "colorado") to find the matching spec file.
 * Returns { importPath, filename } or null.
 */
function discoverResolvedSpec(scope) {
  const openapiDir = join(ROOT, dirs.openapi);
  if (!existsSync(openapiDir)) return null;

  const files = readdirSync(openapiDir).filter(f =>
    f.endsWith('-benefits-schema.yaml') && !f.startsWith('federal')
  );
  if (files.length === 0) return null;

  const match = scope
    ? files.find(f => f.toLowerCase().includes(scope.toLowerCase()))
    : files[0];

  const file = match || files[0];
  return { importPath: `../../generated/openapi/${file}`, filename: `generated/openapi/${file}` };
}

/**
 * Build a consolidated annotation field-name reference.
 * Reads each annotation YAML and extracts all field refs + their program names,
 * grouped by layer. Returns a YAML-like string for display in the Reference tab.
 */
function buildAnnotationFieldsReference(layers) {
  const lines = ['# Available annotation fields and program names', '#', '# Use in columns as: annotation.<layer>.<property>', '# Properties: label, source, statute, notes, programs.<name>', ''];

  for (const layer of layers) {
    const filePath = join(ANNOTATIONS_DIR, `${layer.name}.yaml`);
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, 'utf-8');
    const doc = yaml.load(raw);
    const fields = doc?.fields ?? {};
    const fieldRefs = Object.keys(fields).sort();

    // Collect all unique program names across this layer
    const programNames = new Set();
    for (const entry of Object.values(fields)) {
      if (entry?.programs) {
        for (const p of Object.keys(entry.programs)) programNames.add(p);
      }
    }
    const sortedPrograms = [...programNames].sort();

    lines.push(`# ── ${layer.name} (${fieldRefs.length} fields) ──`);
    lines.push('');
    if (sortedPrograms.length > 0) {
      lines.push('# Programs:');
      for (const p of sortedPrograms) {
        lines.push(`#   annotation.${layer.name}.programs.${p}`);
      }
      lines.push('');
    }
    lines.push('# Fields:');
    for (const ref of fieldRefs) {
      lines.push(`#   ${ref}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build a consolidated permissions reference.
 * Reads each permissions YAML and shows role + defaults + overrides.
 */
function buildPermissionsReference(allPerms) {
  const lines = ['# Available permissions roles', '#', '# Use in columns as: permissions.<role>', '# Values: editable | read-only | masked | hidden', ''];

  for (const p of allPerms) {
    const filePath = join(PERMISSIONS_DIR, p.filename);
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, 'utf-8');
    lines.push(`# ── ${p.role} ──`);
    lines.push(raw.trim());
    lines.push('');
  }

  return lines.join('\n');
}

function generateReferenceStory(contract, domain) {
  const { id, title, schema, scope } = contract.form;
  const layerNames = contract.form.annotations ?? [];
  const { zodModule } = parseSchemaRef(schema, scope, 'reference');
  const pascalName = toPascalCase(id);
  const layers = discoverAnnotationLayers(domain, layerNames);
  const hasAnnotations = layers.length > 0;

  // Discover all permissions files
  const allPerms = discoverPermissions();

  // Discover resolved spec
  const resolvedSpec = discoverResolvedSpec(scope);

  // Build permissions imports
  const permsImports = allPerms.map(p =>
    `import ${p.role}PermsData from '../../authored/permissions/${p.filename}';\nimport ${p.role}PermsYaml from '../../authored/permissions/${p.filename}?raw';`
  ).join('\n');

  const permsTypedArray = allPerms.map(p =>
    `  ${p.role}PermsData as unknown as PermissionsPolicy,`
  ).join('\n');

  // Annotation imports — each layer passed separately (not merged)
  const annotationImports = layers.map((l, i) =>
    `import annotationLayer${i} from '../../${l.rootRelative}';\nimport annotationLayer${i}Yaml from '../../${l.rootRelative}?raw';`
  ).join('\n');

  const annotationLayerEntries = layers.map((l, i) =>
    `  { name: '${l.name}', data: annotationLayer${i} as unknown as Record<string, unknown> },`
  ).join('\n');

  // Schema spec imports
  let schemaImports = '';
  let schemaTyped = '';
  let schemaTab = '';
  if (resolvedSpec) {
    schemaImports = `import schemaSpecData from '${resolvedSpec.importPath}';\nimport schemaSpecYaml from '${resolvedSpec.importPath}?raw';`;
    schemaTyped = `const typedSchemaSpec = schemaSpecData as unknown as Record<string, unknown>;`;
    schemaTab = `    { id: 'schema-spec', label: 'OpenAPI Schema', filename: '${resolvedSpec.filename}', source: schemaSpecYaml, readOnly: true, group: 'reference' as const },`;
  }

  // Build consolidated reference tabs (annotation field names + permissions)
  const annotationFieldsRef = hasAnnotations ? buildAnnotationFieldsReference(layers) : '';
  const permissionsRef = buildPermissionsReference(allPerms);

  // Reference tabs: OpenAPI → individual annotations → consolidated fields → consolidated permissions
  const annotationTabs = layers.map((l, i) =>
    `    { id: 'annotations-${l.name}', label: '${toPascalCase(l.name)} Annotations', filename: '${l.filename}', source: annotationLayer${i}Yaml, readOnly: true, group: 'reference' as const },`
  ).join('\n');

  const annotationFieldsTab = hasAnnotations
    ? `    { id: 'annotation-fields', label: 'Annotation Fields', filename: 'Available annotation column values', source: annotationFieldsRefContent, readOnly: true, group: 'reference' as const },`
    : '';

  const permissionsTab = `    { id: 'permissions-ref', label: 'Permissions', filename: 'Available permission roles', source: permissionsRefContent, readOnly: true, group: 'reference' as const },`;

  return `// Auto-generated from authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ReferenceRenderer } from '../../src/engine/ReferenceRenderer';
import { ContractPreview, type EditorTab } from '../../src/engine/ContractPreview';
import type { FormContract, PermissionsPolicy } from '../../src/engine/types';

// Layout
import contract from '../../authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml';
import layoutYaml from '../../authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml?raw';
// Permissions (all roles)
${permsImports}
${hasAnnotations ? `// Annotations (layered)\n${annotationImports}` : ''}
${schemaImports ? `// Resolved OpenAPI spec\n${schemaImports}` : ''}

const typedContract = contract as unknown as FormContract;
const allPermissions: PermissionsPolicy[] = [
${permsTypedArray}
];
const annotationLayers = [
${annotationLayerEntries}
];
${schemaTyped}

// Consolidated reference content (generated at build time)
const annotationFieldsRefContent = ${JSON.stringify(annotationFieldsRef)};
const permissionsRefContent = ${JSON.stringify(permissionsRef)};

const meta: Meta = {
  title: 'Reference/${title}',
  parameters: { layout: 'fullscreen' },
};

export default meta;

function StoryWrapper() {
  const [activeContract, setActiveContract] = useState(typedContract);

  const tabs: EditorTab[] = [
    { id: 'layout', label: 'Layout', filename: 'authored/contracts/${domain}/${contractFileName(id, domain)}.form.yaml', source: layoutYaml },
${schemaTab}
${annotationTabs}
${annotationFieldsTab}
${permissionsTab}
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="${id}"
      formTitle="${title}"
      onLayoutChange={setActiveContract}
      onPermissionsChange={() => {}}
      onTestDataChange={() => {}}
    >
      <ReferenceRenderer
        contract={activeContract}
${hasAnnotations ? '        annotationLayers={annotationLayers}\n' : ''}${resolvedSpec ? '        schemaSpec={typedSchemaSpec}\n' : ''}        permissionsPolicies={allPermissions}
      />
    </ContractPreview>
  );
}

export const ${pascalName}: StoryObj = {
  name: '${title}',
  render: () => <StoryWrapper />,
};
`;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Write file only if content has actually changed.
 * Prevents unnecessary mtime updates that trigger Storybook's HMR watcher.
 */
function writeIfChanged(filePath, content) {
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf-8');
    if (existing === content) return false;
  }
  writeFileSync(filePath, content, 'utf-8');
  return true;
}

/**
 * Derive the filename stem for a contract within a domain directory.
 * Contract id is e.g. "application-intake", domain is "application".
 * The file is named by stripping the domain prefix: "intake.form.yaml".
 * If the id equals the domain, the file is just "{domain}.form.yaml".
 */
function contractFileName(contractId, domain) {
  if (contractId === domain) return domain;
  const prefix = `${domain}-`;
  if (contractId.startsWith(prefix)) {
    return contractId.slice(prefix.length);
  }
  return contractId;
}

// =============================================================================
// Main
// =============================================================================

function main() {
  const contracts = discoverContracts();
  let generated = 0;
  let scenariosGenerated = 0;

  for (const { domain, filename, filePath } of contracts) {
    const content = readFileSync(filePath, 'utf-8');
    const doc = yaml.load(content);

    if (!doc?.form?.storybook) {
      console.log(`  skip  ${domain}/${filename} (no storybook section)`);
      continue;
    }

    const layout = doc.form.layout || 'wizard';
    const contractId = doc.form.id;
    const pascalName = toPascalCase(contractId);
    const outPath = join(STORIES_DIR, `${pascalName}.stories.tsx`);

    const source =
      layout === 'reference'
        ? generateReferenceStory(doc, domain)
        : layout === 'split-panel'
          ? generateSplitPanelStory(doc, domain)
          : layout === 'review'
            ? generateReviewStory(doc, domain)
            : generateWizardStory(doc, domain);

    if (writeIfChanged(outPath, source)) {
      console.log(`  write  ${pascalName}.stories.tsx  (${layout})`);
    } else {
      console.log(`  skip   ${pascalName}.stories.tsx  (unchanged)`);
    }
    generated++;

    // Discover and generate scenario stories (co-located with YAML files)
    const scenarios = discoverScenarios(contractId);
    for (const { scenarioName, dir } of scenarios) {
      const scenarioOutPath = join(SCENARIOS_DIR, dir, 'index.stories.tsx');
      const scenarioSource = generateScenarioStory(doc, scenarioName, domain);
      if (writeIfChanged(scenarioOutPath, scenarioSource)) {
        console.log(`  write  scenarios/${dir}/index.stories.tsx`);
      } else {
        console.log(`  skip   scenarios/${dir}/index.stories.tsx  (unchanged)`);
      }
      scenariosGenerated++;
    }
  }

  console.log(`\nGenerated ${generated} story file(s) and ${scenariosGenerated} scenario(s).`);
}

main();
