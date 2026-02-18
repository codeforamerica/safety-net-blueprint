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
 *   Scenarios:        storybook/scenarios/{contract-id}.{scenario-name}/
 *   Scenario stories: storybook/scenarios/{contract-id}.{scenario-name}/index.stories.tsx
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { dirs } from '../config.js';

const ROOT = join(import.meta.dirname, '../..');
const CONTRACTS_DIR = join(ROOT, dirs.contracts);
const STORIES_DIR = join(ROOT, dirs.stories);
const SCENARIOS_DIR = join(ROOT, dirs.scenarios);

// =============================================================================
// Utilities
// =============================================================================

function toPascalCase(kebab) {
  return kebab
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
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
  writeFileSync(filePath, content, 'utf-8');
  return true;
}

// =============================================================================
// Discovery
// =============================================================================

/**
 * Discover manifest files within domain subdirectories.
 * Returns array of { domain, sources } objects.
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
      results.push({ domain, sources: manifest.sources });
    }
  }
  return results;
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
const annotationLookup = deriveAnnotationLookup(mergedAnnotations);`;

  const prop = `\n        annotations={annotationLookup}`;

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

function generateWizardStory(contract, manifest) {
  const { id, title } = contract.form;
  const { role } = contract.form.storybook;
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
import { FormRenderer } from '../../src/engine/FormRenderer';
import { ContractPreview, type EditorTab } from '../../src/engine/ContractPreview';
import { ${zodExport} } from '../../${schemaModule}';
import type { FormContract, Role, PermissionsPolicy } from '../../src/engine/types';

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
    { id: 'layout', label: 'Layout', filename: '${contractPath}', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: '${fixturesPath}', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: '${permsPath}', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: '${src.schema}', source: schemaSource, readOnly: true, group: 'reference' as const },${annTab}
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
// Template: review layout
// =============================================================================

function generateReviewStory(contract, manifest) {
  const { id, title } = contract.form;
  const { role } = contract.form.storybook;
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
import { FormRenderer } from '../../src/engine/FormRenderer';
import { ContractPreview, type EditorTab } from '../../src/engine/ContractPreview';
import { ${zodExport} } from '../../${schemaModule}';
import type { FormContract, PermissionsPolicy } from '../../src/engine/types';

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
    { id: 'layout', label: 'Layout', filename: '${contractPath}', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: '${fixturesPath}', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: '${permsPath}', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: '${src.schema}', source: schemaSource, readOnly: true, group: 'reference' as const },${annTab}
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
        schema={${zodExport}}
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

function generateSplitPanelStory(contract, manifest) {
  const { id, title, panels } = contract.form;
  const { role } = contract.form.storybook;
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
import { SplitPanelRenderer } from '../../src/engine/SplitPanelRenderer';
import { ContractPreview, type EditorTab } from '../../src/engine/ContractPreview';
import { ${zodExport} } from '../../${schemaModule}';
import type { FormContract, PermissionsPolicy, ViewMode } from '../../src/engine/types';

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
    { id: 'layout', label: 'Layout', filename: '${contractPath}', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: '${fixturesPath}', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: '${permsPath}', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: '${src.schema}', source: schemaSource, readOnly: true, group: 'reference' as const },${annTab}
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
// Template: scenario story (co-located in storybook/scenarios/{dir}/)
// =============================================================================

function generateScenarioStory(contract, manifest, scenarioName) {
  const { id, title } = contract.form;
  const layout = contract.form.layout || 'wizard';
  const { role } = contract.form.storybook;
  const src = manifest.sources;
  const zodExport = src.zodExport;
  const schemaModule = src.schema.replace(/\.ts$/, '');
  const layers = parseAnnotationPaths(src.annotations);

  const scenarioDisplayName = scenarioName.replace(/-/g, ' ');

  const roleType = layout === 'wizard' ? ', Role' : '';
  const ann = annotationBlock(layers, '../../..');
  const annTab = annotationsTabEntry(layers);

  return `// Auto-generated scenario story. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../../../src/engine/FormRenderer';
import { ContractPreview, type EditorTab } from '../../../src/engine/ContractPreview';
import { ${zodExport} } from '../../../${schemaModule}';
import type { FormContract${roleType}, PermissionsPolicy } from '../../../src/engine/types';

// Scenario: all three files are co-located in this directory
import scenarioLayout from './layout.yaml';
import scenarioLayoutYaml from './layout.yaml?raw';
import scenarioFixtures from './test-data.yaml';
import scenarioFixturesYaml from './test-data.yaml?raw';
import scenarioPerms from './permissions.yaml';
import scenarioPermsYaml from './permissions.yaml?raw';
// Schema (read-only Zod source)
import schemaSource from '../../../${src.schema}?raw';
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
    { id: 'schema', label: 'Schema', filename: '${src.schema}', source: schemaSource, readOnly: true, group: 'reference' as const },${annTab}
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
        schema={${zodExport}}
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

function generateReferenceStory(contract, manifest) {
  const { id, title } = contract.form;
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
import { ReferenceRenderer } from '../../src/engine/ReferenceRenderer';
import { ContractPreview, type EditorTab } from '../../src/engine/ContractPreview';
import type { FormContract, PermissionsPolicy } from '../../src/engine/types';

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
const annotationLayers = [
${annotationLayerEntries}
];

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
    { id: 'layout', label: 'Layout', filename: '${contractPath}', source: layoutYaml },
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
// Main
// =============================================================================

function main() {
  const manifests = discoverManifests();
  let generated = 0;
  let scenariosGenerated = 0;

  for (const { domain, sources } of manifests) {
    // Read the contract from the manifest's contract path
    const contractPath = join(ROOT, sources.contract);
    const content = readFileSync(contractPath, 'utf-8');
    const doc = yaml.load(content);

    if (!doc?.form?.storybook) {
      console.log(`  skip  ${sources.contract} (no storybook section)`);
      continue;
    }

    const layout = doc.form.layout || 'wizard';
    const contractId = doc.form.id;
    const pascalName = toPascalCase(contractId);
    const outPath = join(STORIES_DIR, `${pascalName}.stories.tsx`);
    const manifest = { sources };

    const source =
      layout === 'reference'
        ? generateReferenceStory(doc, manifest)
        : layout === 'split-panel'
          ? generateSplitPanelStory(doc, manifest)
          : layout === 'review'
            ? generateReviewStory(doc, manifest)
            : generateWizardStory(doc, manifest);

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
      const scenarioSource = generateScenarioStory(doc, manifest, scenarioName);
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
