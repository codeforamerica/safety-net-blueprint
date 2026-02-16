// Auto-generated from contracts/application-intake.yaml. Run `npm run generate:stories` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../engine/FormRenderer';
import { ContractPreview, type EditorTab } from '../engine/ContractPreview';
import { applicationCreateSchema } from '../schemas/application';
import type { FormContract, Role, PermissionsPolicy } from '../engine/types';

// Layout
import contract from '../contracts/application-intake.yaml';
import layoutYaml from '../contracts/application-intake.yaml?raw';
// Test data
import fixtures from '../fixtures/application-intake.yaml';
import fixturesYaml from '../fixtures/application-intake.yaml?raw';
// Permissions
import permsData from '../permissions/applicant.yaml';
import permsYaml from '../permissions/applicant.yaml?raw';
// Schema (read-only Zod source)
import schemaSource from '../schemas/application.ts?raw';

const typedContract = contract as unknown as FormContract;
const typedFixtures = fixtures as unknown as Record<string, unknown>;
const typedPerms = permsData as unknown as PermissionsPolicy;

const meta: Meta = {
  title: 'Forms/Application Intake',
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
    { id: 'layout', label: 'Layout', filename: 'application-intake.yaml', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: 'fixtures/application-intake.yaml', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: 'permissions/applicant.yaml', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: 'schemas/application.ts', source: schemaSource, readOnly: true },
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="application-intake"
      formTitle="Application Intake"
      onLayoutChange={setActiveContract}
      onPermissionsChange={setPerms}
      onTestDataChange={setTestData}
    >
      <FormRenderer
        contract={activeContract}
        schema={applicationCreateSchema}
        role={'applicant' as Role}
        initialPage={0}
        defaultValues={testData}
        permissionsPolicy={perms}
        onSubmit={logSubmit}
      />
    </ContractPreview>
  );
}

export const ApplicationIntake: StoryObj = {
  name: 'Application Intake',
  render: () => <StoryWrapper />,
};
