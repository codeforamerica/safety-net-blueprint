// Auto-generated from contracts/application-caseworker-review.yaml. Run `npm run generate:stories` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../engine/FormRenderer';
import { ContractPreview, type EditorTab } from '../engine/ContractPreview';
import { applicationUpdateSchema } from '../schemas/application';
import type { FormContract, PermissionsPolicy } from '../engine/types';

// Layout
import contract from '../contracts/application-caseworker-review.yaml';
import layoutYaml from '../contracts/application-caseworker-review.yaml?raw';
// Test data
import fixtures from '../fixtures/application-caseworker-review.yaml';
import fixturesYaml from '../fixtures/application-caseworker-review.yaml?raw';
// Permissions
import permsData from '../permissions/caseworker.yaml';
import permsYaml from '../permissions/caseworker.yaml?raw';
// Schema (read-only Zod source)
import schemaSource from '../schemas/application.ts?raw';

const typedContract = contract as unknown as FormContract;
const typedFixtures = fixtures as unknown as Record<string, unknown>;
const typedPerms = permsData as unknown as PermissionsPolicy;

const meta: Meta = {
  title: 'Forms/Application Review',
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
    { id: 'layout', label: 'Layout', filename: 'application-caseworker-review.yaml', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: 'fixtures/application-caseworker-review.yaml', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: 'permissions/caseworker.yaml', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: 'schemas/application.ts', source: schemaSource, readOnly: true },
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="application-caseworker-review"
      formTitle="Application Review"
      onLayoutChange={setActiveContract}
      onPermissionsChange={setPerms}
      onTestDataChange={setTestData}
    >
      <FormRenderer
        contract={activeContract}
        schema={applicationUpdateSchema}
        role="caseworker"
        defaultValues={testData}
        permissionsPolicy={perms}
        onSubmit={logSubmit}
      />
    </ContractPreview>
  );
}

export const ApplicationCaseworkerReview: StoryObj = {
  name: 'Application Review',
  render: () => <StoryWrapper />,
};
