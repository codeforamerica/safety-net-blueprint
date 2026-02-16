#!/usr/bin/env node
/**
 * Storybook Story Generator
 *
 * Reads contract YAML files with a `storybook` metadata section and generates
 * corresponding .stories.tsx files. Run via: npm run generate:stories
 *
 * Conventions:
 *   Contract:    src/contracts/{name}.yaml
 *   Fixtures:    src/fixtures/{name}.yaml
 *   Permissions: src/permissions/{storybook.permissions}.yaml
 *   Zod schema:  src/schemas/{domain}.ts  (exports {schemaName}Schema)
 *   Story file:  src/stories/{PascalCase}.stories.tsx
 *   Scenarios:   src/scenarios/{contract-id}.{scenario-name}/  (directory with test-data, permissions, layout YAMLs)
 *   Scenario stories: src/stories/scenarios/{PascalCase}.{PascalScenario}.stories.tsx
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

const ROOT = join(import.meta.dirname, '..');
const CONTRACTS_DIR = join(ROOT, 'src', 'contracts');
const STORIES_DIR = join(ROOT, 'src', 'stories');
const SCENARIOS_DIR = join(ROOT, 'src', 'scenarios');

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
 * Derive schema import info from the form.schema field.
 */
function parseSchemaRef(schemaRef) {
  const [domain, schemaName] = schemaRef.split('/');
  const zodImport = toCamelCase(schemaName) + 'Schema';
  const zodModule = domain.replace(/s$/, '');
  return { domain, schemaName, zodImport, zodModule };
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
// Template: wizard layout
// =============================================================================

function generateWizardStory(contract) {
  const { id, title, pages, schema } = contract.form;
  const { role, permissions } = contract.form.storybook;
  const { zodImport, zodModule } = parseSchemaRef(schema);
  const pascalName = toPascalCase(id);

  return `// Auto-generated from contracts/${id}.yaml. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../engine/FormRenderer';
import { ContractPreview, type EditorTab } from '../engine/ContractPreview';
import { ${zodImport} } from '../schemas/${zodModule}';
import type { FormContract, Role, PermissionsPolicy } from '../engine/types';

// Layout
import contract from '../contracts/${id}.yaml';
import layoutYaml from '../contracts/${id}.yaml?raw';
// Test data
import fixtures from '../fixtures/${id}.yaml';
import fixturesYaml from '../fixtures/${id}.yaml?raw';
// Permissions
import permsData from '../permissions/${permissions}.yaml';
import permsYaml from '../permissions/${permissions}.yaml?raw';
// Schema (read-only Zod source)
import schemaSource from '../schemas/${zodModule}.ts?raw';

const typedContract = contract as unknown as FormContract;
const typedFixtures = fixtures as unknown as Record<string, unknown>;
const typedPerms = permsData as unknown as PermissionsPolicy;

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
    { id: 'layout', label: 'Layout', filename: '${id}.yaml', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: 'fixtures/${id}.yaml', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: 'permissions/${permissions}.yaml', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: 'schemas/${zodModule}.ts', source: schemaSource, readOnly: true },
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
        permissionsPolicy={perms}
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

function generateReviewStory(contract) {
  const { id, title, schema } = contract.form;
  const { role, permissions } = contract.form.storybook;
  const { zodImport, zodModule } = parseSchemaRef(schema);
  const pascalName = toPascalCase(id);

  return `// Auto-generated from contracts/${id}.yaml. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../engine/FormRenderer';
import { ContractPreview, type EditorTab } from '../engine/ContractPreview';
import { ${zodImport} } from '../schemas/${zodModule}';
import type { FormContract, PermissionsPolicy } from '../engine/types';

// Layout
import contract from '../contracts/${id}.yaml';
import layoutYaml from '../contracts/${id}.yaml?raw';
// Test data
import fixtures from '../fixtures/${id}.yaml';
import fixturesYaml from '../fixtures/${id}.yaml?raw';
// Permissions
import permsData from '../permissions/${permissions}.yaml';
import permsYaml from '../permissions/${permissions}.yaml?raw';
// Schema (read-only Zod source)
import schemaSource from '../schemas/${zodModule}.ts?raw';

const typedContract = contract as unknown as FormContract;
const typedFixtures = fixtures as unknown as Record<string, unknown>;
const typedPerms = permsData as unknown as PermissionsPolicy;

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
    { id: 'layout', label: 'Layout', filename: '${id}.yaml', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: 'fixtures/${id}.yaml', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: 'permissions/${permissions}.yaml', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: 'schemas/${zodModule}.ts', source: schemaSource, readOnly: true },
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
        permissionsPolicy={perms}
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
// Template: scenario story (co-located in scenarios/{dir}/)
// =============================================================================

function generateScenarioStory(contract, scenarioName) {
  const { id, title, schema } = contract.form;
  const layout = contract.form.layout || 'wizard';
  const { role } = contract.form.storybook;
  const { zodImport, zodModule } = parseSchemaRef(schema);

  const scenarioDisplayName = scenarioName.replace(/-/g, ' ');

  const roleType = layout === 'wizard' ? ', Role' : '';

  return `// Auto-generated scenario story. Run \`npm run generate:stories\` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../../engine/FormRenderer';
import { ContractPreview, type EditorTab } from '../../engine/ContractPreview';
import { ${zodImport} } from '../../schemas/${zodModule}';
import type { FormContract${roleType}, PermissionsPolicy } from '../../engine/types';

// Scenario: all three files are co-located in this directory
import scenarioLayout from './layout.yaml';
import scenarioLayoutYaml from './layout.yaml?raw';
import scenarioFixtures from './test-data.yaml';
import scenarioFixturesYaml from './test-data.yaml?raw';
import scenarioPerms from './permissions.yaml';
import scenarioPermsYaml from './permissions.yaml?raw';
// Schema (read-only Zod source)
import schemaSource from '../../schemas/${zodModule}.ts?raw';

const typedContract = scenarioLayout as unknown as FormContract;
const typedFixtures = scenarioFixtures as unknown as Record<string, unknown>;
const typedPerms = scenarioPerms as unknown as PermissionsPolicy;

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
    { id: 'layout', label: 'Layout', filename: 'scenarios/${id}.${scenarioName}/layout.yaml', source: scenarioLayoutYaml },
    { id: 'test-data', label: 'Test Data', filename: 'scenarios/${id}.${scenarioName}/test-data.yaml', source: scenarioFixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: 'scenarios/${id}.${scenarioName}/permissions.yaml', source: scenarioPermsYaml },
    { id: 'schema', label: 'Schema', filename: 'schemas/${zodModule}.ts', source: schemaSource, readOnly: true },
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
        permissionsPolicy={perms}
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
// Main
// =============================================================================

function main() {
  const files = readdirSync(CONTRACTS_DIR).filter(f => f.endsWith('.yaml'));
  let generated = 0;
  let scenariosGenerated = 0;

  for (const file of files) {
    const filePath = join(CONTRACTS_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const doc = yaml.load(content);

    if (!doc?.form?.storybook) {
      console.log(`  skip  ${file} (no storybook section)`);
      continue;
    }

    const layout = doc.form.layout || 'wizard';
    const contractId = doc.form.id;
    const pascalName = toPascalCase(contractId);
    const outPath = join(STORIES_DIR, `${pascalName}.stories.tsx`);

    const source =
      layout === 'review'
        ? generateReviewStory(doc)
        : generateWizardStory(doc);

    writeFileSync(outPath, source, 'utf-8');
    console.log(`  write  ${pascalName}.stories.tsx  (${layout})`);
    generated++;

    // Discover and generate scenario stories (co-located with YAML files)
    const scenarios = discoverScenarios(contractId);
    for (const { scenarioName, dir } of scenarios) {
      const scenarioOutPath = join(SCENARIOS_DIR, dir, 'index.stories.tsx');
      const scenarioSource = generateScenarioStory(doc, scenarioName);
      writeFileSync(scenarioOutPath, scenarioSource, 'utf-8');
      console.log(`  write  scenarios/${dir}/index.stories.tsx`);
      scenariosGenerated++;
    }
  }

  console.log(`\nGenerated ${generated} story file(s) and ${scenariosGenerated} scenario(s).`);
}

main();
