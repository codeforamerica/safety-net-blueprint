#!/usr/bin/env node
/**
 * Storybook Story Generator
 *
 * Reads manifest YAML files alongside form contracts and generates
 * corresponding .stories.tsx files. Run via: npm run generate:stories
 *
 * Each contract has a co-located .manifest.yaml that declares the concrete
 * file locations used for code generation (schema, fixtures, permissions,
 * annotations, openapi). The generator reads the manifest and follows
 * references verbatim — no filesystem probing.
 *
 * Conventions:
 *   Manifest:         authored/contracts/{domain}/{name}.manifest.yaml
 *   Contract:         authored/contracts/{domain}/{name}.form.yaml
 *   Story file:       storybook/stories/{PascalCase}.stories.tsx
 *   Custom:           storybook/custom/{contract-id}.{custom-name}/
 *   Custom stories:   storybook/custom/{contract-id}.{custom-name}/index.stories.tsx
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { dirs } from '../config.js';

const ROOT = join(import.meta.dirname, '../..');
const CONTRACTS_DIR = join(ROOT, dirs.contracts);
const STORIES_DIR = join(ROOT, dirs.stories);
const CUSTOM_DIR = join(ROOT, dirs.custom);

// =============================================================================
// Utilities
// =============================================================================

function toPascalCase(kebab) {
  return kebab
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Build the Storybook meta.title from role, optional category, and title.
 * Role/Category/Title or Role/Title when no category.
 */
function buildMetaTitle(role, category, title) {
  const prefix = capitalize(role);
  return category ? `${prefix}/${category}/${title}` : `${prefix}/${title}`;
}

/**
 * Write file only if content has actually changed.
 * Prevents unnecessary mtime updates that trigger Storybook's HMR watcher.
 */
function writeIfChanged(filePath, content) {
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf-8');
    if (existing === content) return false;
  }
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
  return true;
}

// =============================================================================
// Discovery
// =============================================================================

/**
 * Discover manifest files within domain subdirectories.
 * Returns array of { domain, category, sources } objects.
 */
function discoverManifests() {
  const results = [];
  if (!existsSync(CONTRACTS_DIR)) return results;

  for (const domain of readdirSync(CONTRACTS_DIR)) {
    const domainPath = join(CONTRACTS_DIR, domain);
    if (!statSync(domainPath).isDirectory()) continue;

    for (const file of readdirSync(domainPath)) {
      if (!file.endsWith('.manifest.yaml')) continue;
      const manifestPath = join(domainPath, file);
      const raw = readFileSync(manifestPath, 'utf-8');
      const manifest = yaml.load(raw);
      results.push({ domain, category: manifest.category, sources: manifest.sources });
    }
  }
  return results;
}

/**
 * Discover custom story directories for a given contract id.
 * Returns array of { customName, dir } objects.
 */
function discoverCustom(contractId) {
  if (!existsSync(CUSTOM_DIR)) return [];

  const requiredFiles = ['layout.yaml'];
  const prefix = `${contractId}.`;
  return readdirSync(CUSTOM_DIR)
    .filter(entry => {
      if (!entry.startsWith(prefix)) return false;
      const entryPath = join(CUSTOM_DIR, entry);
      if (!statSync(entryPath).isDirectory()) return false;
      return requiredFiles.every(f => existsSync(join(entryPath, f)));
    })
    .map(dir => {
      const customName = dir.slice(prefix.length);
      return { customName, dir };
    })
    .sort((a, b) => a.customName.localeCompare(b.customName));
}

// =============================================================================
// Manifest path helpers
// =============================================================================

/**
 * Parse annotation file paths from manifest into layer objects.
 * Returns array of { name, path } where name is derived from the filename.
 */
function parseAnnotationPaths(annotationPaths) {
  if (!annotationPaths || annotationPaths.length === 0) return [];
  return annotationPaths.map(p => ({
    name: p.split('/').pop().replace('.yaml', ''),
    path: p,
  }));
}

/**
 * Parse permission file paths from manifest into objects.
 * Returns array of { role, path } where role is derived from the filename.
 */
function parsePermissionPaths(permissionPaths) {
  if (!permissionPaths || permissionPaths.length === 0) return [];
  return permissionPaths.map(p => ({
    role: p.split('/').pop().replace('.yaml', ''),
    path: p,
  }));
}

// =============================================================================
// Annotation helpers
// =============================================================================

/**
 * Generate the annotation import + merge block for wizard/review/split-panel stories.
 * Layers are merged into a single annotationLookup for badge display.
 */
function annotationBlock(layers, rootPrefix) {
  if (layers.length === 0) {
    return { imports: '', setup: '', prop: '' };
  }

  const imports = layers.map((l, i) =>
    `import annotationLayer${i} from '${rootPrefix}/${l.path}';\nimport annotationLayer${i}Yaml from '${rootPrefix}/${l.path}?raw';`
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
const annotationLookup = deriveAnnotationLookup(mergedAnnotations);
const annotationEntries = (mergedAnnotations as any).fields as Record<string, AnnotationEntry>;`;

  const prop = `\n        annotations={annotationLookup}\n        annotationEntries={annotationEntries}`;

  return { imports: `// Annotations\n${imports}`, setup, prop };
}

/**
 * Generate the annotations reference tab entries (one per layer).
 */
function annotationsTabEntry(layers) {
  if (layers.length === 0) return '';
  return layers.map((l, i) =>
    `\n    { id: 'annotations-${l.name}', label: '${toPascalCase(l.name)} Annotations', filename: '${l.path}', source: annotationLayer${i}Yaml, readOnly: true, group: 'reference' as const },`
  ).join('');
}

// =============================================================================
// Template: wizard layout
// =============================================================================

function generateWizardStory(contract, manifest, category) {
  const { id, title, role } = contract.form;
  const metaTitle = buildMetaTitle(role, category, title);
  const src = manifest.sources;
  const zodExport = src.zodExport;
  const schemaModule = src.schema.replace(/\.ts$/, '');
  const contractPath = src.contract;
  const fixturesPath = src.fixtures;
  const permsPath = src.permissions[0];
  const layers = parseAnnotationPaths(src.annotations);
  const pascalName = toPascalCase(id);
  const ann = annotationBlock(layers, '../..');
  const annTab = annotationsTabEntry(layers);

  return `// Auto-generated from ${contractPath}. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '@safety-net/form-engine';
import { ContractPreview, type EditorTab } from '@safety-net/form-engine';
import { ${zodExport} } from '../../${schemaModule}';
import type { FormContract, Role, PermissionsPolicy, AnnotationEntry } from '@safety-net/form-engine';

// Layout
import contract from '../../${contractPath}';
import layoutYaml from '../../${contractPath}?raw';
// Test data
import fixtures from '../../${fixturesPath}';
import fixturesYaml from '../../${fixturesPath}?raw';
// Permissions
import permsData from '../../${permsPath}';
import permsYaml from '../../${permsPath}?raw';
// Schema (read-only Zod source)
import schemaSource from '../../${src.schema}?raw';
${ann.imports}

const typedContract = contract as unknown as FormContract;
const typedFixtures = fixtures as unknown as Record<string, unknown>;
const typedPerms = permsData as unknown as PermissionsPolicy;
${ann.setup}

const meta: Meta = {
  title: '${metaTitle}',
  tags: ['read-only'],
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
    { id: 'layout', label: 'Layout', filename: '${contractPath}', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: '${fixturesPath}', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: '${permsPath}', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: '${src.schema}', source: schemaSource, readOnly: true, group: 'reference' as const },${annTab}
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="${id}"
      role="${role}"${category ? `
      category="${category}"` : ''}
      onLayoutChange={setActiveContract}
      onPermissionsChange={setPerms}
      onTestDataChange={setTestData}
    >
      <FormRenderer
        contract={activeContract}
        schema={${zodExport}}
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
// Template: split-panel layout
// =============================================================================

function generateSplitPanelStory(contract, manifest, category) {
  const { id, title, panels, role } = contract.form;
  const metaTitle = buildMetaTitle(role, category, title);
  const src = manifest.sources;
  const zodExport = src.zodExport;
  const schemaModule = src.schema.replace(/\.ts$/, '');
  const contractPath = src.contract;
  const fixturesPath = src.fixtures;
  const permsPath = src.permissions[0];
  const layers = parseAnnotationPaths(src.annotations);
  const pascalName = toPascalCase(id);
  const ann = annotationBlock(layers, '../..');
  const annTab = annotationsTabEntry(layers);

  const leftMode = panels?.left?.mode ?? 'editable';
  const rightMode = panels?.right?.mode ?? 'readonly';
  const leftLabel = panels?.left?.label ?? 'Left Panel';
  const rightLabel = panels?.right?.label ?? 'Right Panel';

  return `// Auto-generated from ${contractPath}. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { SplitPanelRenderer } from '@safety-net/form-engine';
import { ContractPreview, type EditorTab } from '@safety-net/form-engine';
import { ${zodExport} } from '../../${schemaModule}';
import type { FormContract, PermissionsPolicy, ViewMode, AnnotationEntry } from '@safety-net/form-engine';

// Layout
import contract from '../../${contractPath}';
import layoutYaml from '../../${contractPath}?raw';
// Test data
import fixtures from '../../${fixturesPath}';
import fixturesYaml from '../../${fixturesPath}?raw';
// Permissions
import permsData from '../../${permsPath}';
import permsYaml from '../../${permsPath}?raw';
// Schema (read-only Zod source)
import schemaSource from '../../${src.schema}?raw';
${ann.imports}

const typedContract = contract as unknown as FormContract;
const typedFixtures = fixtures as unknown as Record<string, unknown>;
const typedPerms = permsData as unknown as PermissionsPolicy;
${ann.setup}

const meta: Meta = {
  title: '${metaTitle}',
  tags: ['read-only'],
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
    { id: 'layout', label: 'Layout', filename: '${contractPath}', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: '${fixturesPath}', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: '${permsPath}', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: '${src.schema}', source: schemaSource, readOnly: true, group: 'reference' as const },${annTab}
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="${id}"
      role="${role}"${category ? `
      category="${category}"` : ''}
      onLayoutChange={setActiveContract}
      onPermissionsChange={setPerms}
      onTestDataChange={setTestData}
    >
      <SplitPanelRenderer
        contract={activeContract}
        schema={${zodExport}}
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
// Template: custom story (co-located in storybook/custom/{dir}/)
// =============================================================================

function generateCustomStory(contract, manifest, customName, customDir, category) {
  const { id, title, role } = contract.form;
  const layout = contract.form.layout;
  const panels = contract.form.panels;
  const src = manifest.sources;
  const zodExport = src.zodExport;
  const schemaModule = src.schema.replace(/\.ts$/, '');
  const layers = parseAnnotationPaths(src.annotations);
  const allPerms = parsePermissionPaths(src.permissions);

  const customDisplayName = customName.replace(/-/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase());
  const metaTitle = buildMetaTitle(role, category, customDisplayName);

  // Check which optional files exist in the custom directory
  const customPath = join(CUSTOM_DIR, customDir);
  const hasTestData = existsSync(join(customPath, 'test-data.yaml'));
  const hasPermissions = existsSync(join(customPath, 'permissions.yaml'));

  const isSplitPanel = typeof layout === 'object' && layout.display === 'split-panel';
  const isDataTable = typeof layout === 'object' && layout.display === 'data-table';
  const hasDetail = contract.form.pages?.some(p => p.detail) && src.detail;

  if (hasDetail) {
    // List-detail custom stories not yet supported — fall through to data-table
    return generateDataTableCustomStory({ id, role, src, layers, allPerms, metaTitle, customName, customDisplayName, category });
  }

  if (isDataTable) {
    return generateDataTableCustomStory({ id, role, src, layers, allPerms, metaTitle, customName, customDisplayName, category });
  }

  // Form-based layouts: all composable configs
  const roleType = isSplitPanel ? '' : ', Role';
  const ann = annotationBlock(layers, '../../..');
  const annTab = annotationsTabEntry(layers);

  // Imports: layout always from custom dir, test-data/permissions from custom or parent
  const fixturesImport = hasTestData
    ? `import customFixtures from './test-data.yaml';\nimport customFixturesYaml from './test-data.yaml?raw';`
    : `import customFixtures from '../../../${src.fixtures}';\nimport customFixturesYaml from '../../../${src.fixtures}?raw';`;
  const permsImport = hasPermissions
    ? `import customPerms from './permissions.yaml';\nimport customPermsYaml from './permissions.yaml?raw';`
    : `import customPerms from '../../../${src.permissions[0]}';\nimport customPermsYaml from '../../../${src.permissions[0]}?raw';`;

  const fixturesTabFilename = hasTestData
    ? `storybook/custom/${id}.${customName}/test-data.yaml`
    : src.fixtures;
  const permsTabFilename = hasPermissions
    ? `storybook/custom/${id}.${customName}/permissions.yaml`
    : src.permissions[0];

  // Renderer block depends on layout type
  let rendererImport, rendererJsx;
  if (isSplitPanel) {
    const leftMode = panels?.left?.mode ?? 'editable';
    const rightMode = panels?.right?.mode ?? 'readonly';
    const leftLabel = panels?.left?.label ?? 'Left Panel';
    const rightLabel = panels?.right?.label ?? 'Right Panel';
    rendererImport = `import { SplitPanelRenderer } from '@safety-net/form-engine';`;
    rendererJsx = `      <SplitPanelRenderer
        contract={activeContract}
        schema={${zodExport}}
        role="${role}"
        panels={{
          left: { label: '${leftLabel}', viewMode: '${leftMode}' as ViewMode, data: testData },
          right: { label: '${rightLabel}', viewMode: '${rightMode}' as ViewMode, data: testData },
        }}
        permissionsPolicy={perms}${ann.prop}
        onSubmit={logSubmit}
      />`;
  } else {
    rendererImport = `import { FormRenderer } from '@safety-net/form-engine';`;
    rendererJsx = `      <FormRenderer
        contract={activeContract}
        schema={${zodExport}}
        role="${role}"${!isSplitPanel ? `
        initialPage={initialPage}` : ''}
        defaultValues={testData}
        permissionsPolicy={perms}${ann.prop}
        onSubmit={logSubmit}
      />`;
  }

  const viewModeImport = isSplitPanel ? ', ViewMode' : '';

  return `// Auto-generated custom story. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
${rendererImport}
import { ContractPreview, type EditorTab } from '@safety-net/form-engine';
import { ${zodExport} } from '../../../${schemaModule}';
import type { FormContract${roleType}, PermissionsPolicy${viewModeImport}, AnnotationEntry } from '@safety-net/form-engine';

// Layout (from custom)
import customLayout from './layout.yaml';
import customLayoutYaml from './layout.yaml?raw';
// Test data${hasTestData ? ' (from custom)' : ' (from parent)'}
${fixturesImport}
// Permissions${hasPermissions ? ' (from custom)' : ' (from parent)'}
${permsImport}
// Schema (read-only Zod source)
import schemaSource from '../../../${src.schema}?raw';
${ann.imports}

const typedContract = customLayout as unknown as FormContract;
const typedFixtures = customFixtures as unknown as Record<string, unknown>;
const typedPerms = customPerms as unknown as PermissionsPolicy;
${ann.setup}

const meta: Meta = {
  title: '${metaTitle}',
  tags: ['custom'],
  parameters: { layout: 'fullscreen' },
};

export default meta;

const logSubmit = (data: Record<string, unknown>) => {
  console.log('Form submitted:', data);
  alert('Submitted! Check console for data.');
};

function StoryWrapper(${!isSplitPanel ? `{
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
    { id: 'layout', label: 'Layout', filename: 'storybook/custom/${id}.${customName}/layout.yaml', source: customLayoutYaml },
    { id: 'test-data', label: 'Test Data', filename: '${fixturesTabFilename}', source: customFixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: '${permsTabFilename}', source: customPermsYaml },
    { id: 'schema', label: 'Schema', filename: '${src.schema}', source: schemaSource, readOnly: true, group: 'reference' as const },${annTab}
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="${id}"
      role="${role}"${category ? `
      category="${category}"` : ''}
      onLayoutChange={setActiveContract}
      onPermissionsChange={setPerms}
      onTestDataChange={setTestData}
    >
${rendererJsx}
    </ContractPreview>
  );
}

export const ${toPascalCase(customName)}: StoryObj = {
  name: '${customDisplayName}',
  render: () => <StoryWrapper />,
};
`;
}

// =============================================================================
// Template: data-table custom story
// =============================================================================

/**
 * Generate a custom story for a data-table-layout contract.
 * Layout comes from the custom dir; annotations and permissions come from the parent manifest.
 */
function generateDataTableCustomStory({ id, role, src, layers, allPerms, metaTitle, customName, customDisplayName, category }) {
  const hasAnnotations = layers.length > 0;

  // Annotation imports — each layer passed separately
  const annotationImports = layers.map((l, i) =>
    `import annotationLayer${i} from '../../../${l.path}';\nimport annotationLayer${i}Yaml from '../../../${l.path}?raw';`
  ).join('\n');

  const annotationLayerEntries = layers.map((l, i) =>
    `  { name: '${l.name}', data: annotationLayer${i} as unknown as Record<string, unknown> },`
  ).join('\n');

  // Permissions imports (all roles)
  const permsImports = allPerms.map(p =>
    `import ${p.role}PermsData from '../../../${p.path}';\nimport ${p.role}PermsYaml from '../../../${p.path}?raw';`
  ).join('\n');

  const permsTypedArray = allPerms.map(p =>
    `  ${p.role}PermsData as unknown as PermissionsPolicy,`
  ).join('\n');

  // Reference content (annotation fields + permissions)
  const annotationFieldsRef = hasAnnotations ? buildAnnotationFieldsReference(layers) : '';
  const permissionsRef = buildPermissionsReference(allPerms);

  const annotationTabs = layers.map((l, i) =>
    `    { id: 'annotations-${l.name}', label: '${toPascalCase(l.name)} Annotations', filename: '${l.path}', source: annotationLayer${i}Yaml, readOnly: true, group: 'reference' as const },`
  ).join('\n');

  const annotationFieldsTab = hasAnnotations
    ? `    { id: 'annotation-fields', label: 'Annotation Fields', filename: 'Available annotation column values', source: annotationFieldsRefContent, readOnly: true, group: 'reference' as const },`
    : '';

  const permissionsTab = `    { id: 'permissions-ref', label: 'Permissions', filename: 'Available permission roles', source: permissionsRefContent, readOnly: true, group: 'reference' as const },`;

  return `// Auto-generated custom story. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { DataTableRenderer } from '@safety-net/form-engine';
import { ContractPreview, type EditorTab } from '@safety-net/form-engine';
import type { FormContract, PermissionsPolicy, AnnotationLayer } from '@safety-net/form-engine';

// Layout (from custom)
import customLayout from './layout.yaml';
import customLayoutYaml from './layout.yaml?raw';
// Permissions (all roles, from parent)
${permsImports}
${hasAnnotations ? `// Annotations (from parent)\n${annotationImports}` : ''}

const typedContract = customLayout as unknown as FormContract;
const allPermissions: PermissionsPolicy[] = [
${permsTypedArray}
];
const annotationLayers: AnnotationLayer[] = [
${annotationLayerEntries}
];

// Consolidated reference content (generated at build time)
const annotationFieldsRefContent = ${JSON.stringify(annotationFieldsRef)};
const permissionsRefContent = ${JSON.stringify(permissionsRef)};

const meta: Meta = {
  title: '${metaTitle}',
  tags: ['custom'],
  parameters: { layout: 'fullscreen' },
};

export default meta;

function StoryWrapper() {
  const [activeContract, setActiveContract] = useState(typedContract);

  const tabs: EditorTab[] = [
    { id: 'layout', label: 'Layout', filename: 'storybook/custom/${id}.${customName}/layout.yaml', source: customLayoutYaml },
${annotationTabs}
${annotationFieldsTab}
${permissionsTab}
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="${id}"
      role="${role}"${category ? `
      category="${category}"` : ''}
      onLayoutChange={setActiveContract}
      onPermissionsChange={() => {}}
      onTestDataChange={() => {}}
    >
      <DataTableRenderer
        pages={activeContract.form.pages}
        columns={activeContract.form.columns ?? []}
        title={activeContract.form.title}
        source="contract"
${hasAnnotations ? '        annotationLayers={annotationLayers}\n' : ''}        permissionsPolicies={allPermissions}
      />
    </ContractPreview>
  );
}

export const ${toPascalCase(customName)}: StoryObj = {
  name: '${customDisplayName}',
  render: () => <StoryWrapper />,
};
`;
}

// =============================================================================
// Template: reference layout
// =============================================================================

/**
 * Build a consolidated annotation field-name reference.
 * Reads each annotation YAML and extracts all field refs + their program names,
 * grouped by layer. Returns a YAML-like string for display in the Reference tab.
 */
function buildAnnotationFieldsReference(layers) {
  const lines = ['# Available annotation fields and program names', '#', '# Use in columns as: annotation.<layer>.<property>', '# Properties: label, source, statute, notes, programs.<name>', ''];

  for (const layer of layers) {
    const filePath = join(ROOT, layer.path);
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
function buildPermissionsReference(perms) {
  const lines = ['# Available permissions roles', '#', '# Use in columns as: permissions.<role>', '# Values: editable | read-only | masked | hidden', ''];

  for (const p of perms) {
    const filePath = join(ROOT, p.path);
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, 'utf-8');
    lines.push(`# ── ${p.role} ──`);
    lines.push(raw.trim());
    lines.push('');
  }

  return lines.join('\n');
}

function generateDataTableStory(contract, manifest, category) {
  const { id, title, role } = contract.form;
  const metaTitle = buildMetaTitle(role, category, title);
  const src = manifest.sources;
  const contractPath = src.contract;
  const layers = parseAnnotationPaths(src.annotations);
  const hasAnnotations = layers.length > 0;
  const pascalName = toPascalCase(id);

  // Permissions from manifest
  const allPerms = parsePermissionPaths(src.permissions);

  // Build permissions imports
  const permsImports = allPerms.map(p =>
    `import ${p.role}PermsData from '../../${p.path}';\nimport ${p.role}PermsYaml from '../../${p.path}?raw';`
  ).join('\n');

  const permsTypedArray = allPerms.map(p =>
    `  ${p.role}PermsData as unknown as PermissionsPolicy,`
  ).join('\n');

  // Annotation imports — each layer passed separately (not merged)
  const annotationImports = layers.map((l, i) =>
    `import annotationLayer${i} from '../../${l.path}';\nimport annotationLayer${i}Yaml from '../../${l.path}?raw';`
  ).join('\n');

  const annotationLayerEntries = layers.map((l, i) =>
    `  { name: '${l.name}', data: annotationLayer${i} as unknown as Record<string, unknown> },`
  ).join('\n');

  // Build consolidated reference tabs (annotation field names + permissions)
  const annotationFieldsRef = hasAnnotations ? buildAnnotationFieldsReference(layers) : '';
  const permissionsRef = buildPermissionsReference(allPerms);

  const annotationTabs = layers.map((l, i) =>
    `    { id: 'annotations-${l.name}', label: '${toPascalCase(l.name)} Annotations', filename: '${l.path}', source: annotationLayer${i}Yaml, readOnly: true, group: 'reference' as const },`
  ).join('\n');

  const annotationFieldsTab = hasAnnotations
    ? `    { id: 'annotation-fields', label: 'Annotation Fields', filename: 'Available annotation column values', source: annotationFieldsRefContent, readOnly: true, group: 'reference' as const },`
    : '';

  const permissionsTab = `    { id: 'permissions-ref', label: 'Permissions', filename: 'Available permission roles', source: permissionsRefContent, readOnly: true, group: 'reference' as const },`;

  return `// Auto-generated from ${contractPath}. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { DataTableRenderer } from '@safety-net/form-engine';
import { ContractPreview, type EditorTab } from '@safety-net/form-engine';
import type { FormContract, PermissionsPolicy, AnnotationLayer } from '@safety-net/form-engine';

// Layout
import contract from '../../${contractPath}';
import layoutYaml from '../../${contractPath}?raw';
// Permissions (all roles)
${permsImports}
${hasAnnotations ? `// Annotations (layered)\n${annotationImports}` : ''}

const typedContract = contract as unknown as FormContract;
const allPermissions: PermissionsPolicy[] = [
${permsTypedArray}
];
const annotationLayers: AnnotationLayer[] = [
${annotationLayerEntries}
];

// Consolidated reference content (generated at build time)
const annotationFieldsRefContent = ${JSON.stringify(annotationFieldsRef)};
const permissionsRefContent = ${JSON.stringify(permissionsRef)};

const meta: Meta = {
  title: '${metaTitle}',
  tags: ['read-only'],
  parameters: { layout: 'fullscreen' },
};

export default meta;

function StoryWrapper() {
  const [activeContract, setActiveContract] = useState(typedContract);

  const tabs: EditorTab[] = [
    { id: 'layout', label: 'Layout', filename: '${contractPath}', source: layoutYaml },
${annotationTabs}
${annotationFieldsTab}
${permissionsTab}
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="${id}"
      role="${role}"${category ? `
      category="${category}"` : ''}
      onLayoutChange={setActiveContract}
      onPermissionsChange={() => {}}
      onTestDataChange={() => {}}
    >
      <DataTableRenderer
        pages={activeContract.form.pages}
        columns={activeContract.form.columns ?? []}
        title={activeContract.form.title}
        source="contract"
${hasAnnotations ? '        annotationLayers={annotationLayers}\n' : ''}        permissionsPolicies={allPermissions}
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
// Template: list-detail layout
// =============================================================================

/**
 * Generate a story for a data-table contract that has list-detail navigation.
 * The manifest must include a `detail` block pointing to the detail form contract.
 */
function generateListDetailStory(contract, manifest, category) {
  const { id, title, role } = contract.form;
  const metaTitle = buildMetaTitle(role, category, title);
  const src = manifest.sources;
  const detail = src.detail;
  const contractPath = src.contract;
  const fixturesPath = src.fixtures;
  const pascalName = toPascalCase(id);

  const detailZodExport = detail.zodExport;
  const detailSchemaModule = detail.schema.replace(/\.ts$/, '');
  const detailContractPath = detail.contract;
  const detailFixturesPath = detail.fixtures;

  return `// Auto-generated from ${contractPath}. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ListDetailRenderer } from '@safety-net/form-engine';
import { ContractPreview, type EditorTab } from '@safety-net/form-engine';
import { ${detailZodExport} } from '../../${detailSchemaModule}';
import type { FormContract, Role } from '@safety-net/form-engine';

// Layout (list contract)
import contract from '../../${contractPath}';
import layoutYaml from '../../${contractPath}?raw';
// List data (API-style fixtures)
import listData from '../../${fixturesPath}';
import listDataYaml from '../../${fixturesPath}?raw';
// Detail contract
import detailContract from '../../${detailContractPath}';
import detailContractYaml from '../../${detailContractPath}?raw';
// Detail test data
import detailFixtures from '../../${detailFixturesPath}';
import detailFixturesYaml from '../../${detailFixturesPath}?raw';

const typedContract = contract as unknown as FormContract;
const typedDetailContract = detailContract as unknown as FormContract;
const typedListData = listData as unknown as Record<string, unknown>[];
const typedDetailFixtures = detailFixtures as unknown as Record<string, unknown>;

const meta: Meta = {
  title: '${metaTitle}',
  tags: ['read-only'],
  parameters: { layout: 'fullscreen' },
};

export default meta;

function StoryWrapper() {
  const [activeContract, setActiveContract] = useState(typedContract);

  const tabs: EditorTab[] = [
    { id: 'layout', label: 'Layout', filename: '${contractPath}', source: layoutYaml },
    { id: 'list-data', label: 'List Data', filename: '${fixturesPath}', source: listDataYaml },
    { id: 'detail-contract', label: 'Detail Contract', filename: '${detailContractPath}', source: detailContractYaml, readOnly: true, group: 'reference' as const },
    { id: 'detail-data', label: 'Detail Data', filename: '${detailFixturesPath}', source: detailFixturesYaml, readOnly: true, group: 'reference' as const },
  ];

  // Use page-level columns (list-detail pages define columns per-page)
  const firstPage = activeContract.form.pages[0];
  const columns = firstPage?.columns ?? activeContract.form.columns ?? [];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="${id}"
      role="${role}"${category ? `
      category="${category}"` : ''}
      onLayoutChange={setActiveContract}
      onPermissionsChange={() => {}}
      onTestDataChange={() => {}}
    >
      <ListDetailRenderer
        pages={activeContract.form.pages}
        columns={columns}
        title={activeContract.form.title}
        source="api"
        data={typedListData}
        detailContract={typedDetailContract}
        detailSchema={${detailZodExport}}
        detailRole={'${role}' as Role}
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
// Main
// =============================================================================

function main() {
  const manifests = discoverManifests();
  let generated = 0;
  let customGenerated = 0;

  for (const { domain, category, sources } of manifests) {
    // Read the contract from the manifest's contract path
    const contractPath = join(ROOT, sources.contract);
    const content = readFileSync(contractPath, 'utf-8');
    const doc = yaml.load(content);

    if (!doc?.form?.id) {
      console.log(`  skip  ${sources.contract} (no form.id)`);
      continue;
    }

    const layout = doc.form.layout;
    if (!layout) {
      console.log(`  skip  ${sources.contract} (no form.layout)`);
      continue;
    }

    const contractId = doc.form.id;
    const pascalName = toPascalCase(contractId);
    const outPath = join(STORIES_DIR, `${pascalName}.stories.tsx`);
    const manifest = { sources };

    // Dispatch to the right story template.
    // list-detail, data-table, and split-panel use dedicated renderers;
    // everything else uses FormRenderer (wizard template).
    const isSplitPanel = typeof layout === 'object' && layout.display === 'split-panel';
    const isDataTable = typeof layout === 'object' && layout.display === 'data-table';
    const hasDetail = doc.form.pages?.some(p => p.detail) && sources.detail;

    const source = hasDetail
      ? generateListDetailStory(doc, manifest, category)
      : isDataTable
      ? generateDataTableStory(doc, manifest, category)
      : isSplitPanel
        ? generateSplitPanelStory(doc, manifest, category)
        : generateWizardStory(doc, manifest, category);

    const layoutLabel = `${layout.navigation}+${layout.display}`;
    if (writeIfChanged(outPath, source)) {
      console.log(`  write  ${pascalName}.stories.tsx  (${layoutLabel})`);
    } else {
      console.log(`  skip   ${pascalName}.stories.tsx  (unchanged)`);
    }
    generated++;

    // Discover and generate custom stories (co-located with YAML files)
    const customs = discoverCustom(contractId);
    for (const { customName, dir } of customs) {
      const customOutPath = join(CUSTOM_DIR, dir, 'index.stories.tsx');
      const customSource = generateCustomStory(doc, manifest, customName, dir, category);
      if (writeIfChanged(customOutPath, customSource)) {
        console.log(`  write  custom/${dir}/index.stories.tsx`);
      } else {
        console.log(`  skip   custom/${dir}/index.stories.tsx  (unchanged)`);
      }
      customGenerated++;
    }
  }

  console.log(`\nGenerated ${generated} story file(s) and ${customGenerated} custom story/stories.`);
}

main();
