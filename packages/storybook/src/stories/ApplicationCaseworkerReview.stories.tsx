// Auto-generated from contracts/application/caseworker-review.form.yaml. Run `npm run generate:stories` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../engine/FormRenderer';
import { ContractPreview, type EditorTab } from '../engine/ContractPreview';
import { applicationUpdateSchema } from '../schemas/application';
import type { FormContract, PermissionsPolicy } from '../engine/types';

// Layout
import contract from '../contracts/application/caseworker-review.form.yaml';
import layoutYaml from '../contracts/application/caseworker-review.form.yaml?raw';
// Test data
import fixtures from '../fixtures/application-caseworker-review.yaml';
import fixturesYaml from '../fixtures/application-caseworker-review.yaml?raw';
// Permissions
import permsData from '../permissions/caseworker.yaml';
import permsYaml from '../permissions/caseworker.yaml?raw';
// Schema (read-only Zod source)
import schemaSource from '../schemas/application.ts?raw';
// Annotations
import annotationsData from '../contracts/application/annotations.yaml';
import annotationsYaml from '../contracts/application/annotations.yaml?raw';

const typedContract = contract as unknown as FormContract;
const typedFixtures = fixtures as unknown as Record<string, unknown>;
const typedPerms = permsData as unknown as PermissionsPolicy;

function deriveAnnotationLookup(data: Record<string, unknown>): Record<string, string[]> {
  const fields = (data as any).fields ?? {};
  const result: Record<string, string[]> = {};
  for (const [ref, meta] of Object.entries(fields)) {
    const programs = (meta as any)?.programs;
    if (programs) result[ref] = Object.keys(programs);
  }
  return result;
}

const annotationLookup = deriveAnnotationLookup(annotationsData as unknown as Record<string, unknown>);

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
    { id: 'layout', label: 'Layout', filename: 'contracts/application/caseworker-review.form.yaml', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: 'fixtures/application-caseworker-review.yaml', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: 'permissions/caseworker.yaml', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: 'schemas/application.ts', source: schemaSource, readOnly: true, group: 'reference' as const },
    { id: 'annotations', label: 'Annotations', filename: 'contracts/application/annotations.yaml', source: annotationsYaml, readOnly: true, group: 'reference' as const },
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
        annotations={annotationLookup}
        onSubmit={logSubmit}
      />
    </ContractPreview>
  );
}

export const ApplicationCaseworkerReview: StoryObj = {
  name: 'Application Review',
  render: () => <StoryWrapper />,
};
