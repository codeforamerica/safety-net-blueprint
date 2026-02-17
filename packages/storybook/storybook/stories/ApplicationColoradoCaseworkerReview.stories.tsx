// Auto-generated from authored/contracts/application/colorado-caseworker-review.form.yaml. Run `npm run generate:stories` to regenerate.
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { SplitPanelRenderer } from '../../src/engine/SplitPanelRenderer';
import { ContractPreview, type EditorTab } from '../../src/engine/ContractPreview';
import { applicationUpdateSchema } from '../../generated/schemas/application-colorado';
import type { FormContract, PermissionsPolicy, ViewMode } from '../../src/engine/types';

// Layout
import contract from '../../authored/contracts/application/colorado-caseworker-review.form.yaml';
import layoutYaml from '../../authored/contracts/application/colorado-caseworker-review.form.yaml?raw';
// Test data
import fixtures from '../../authored/fixtures/application-colorado-caseworker-review.yaml';
import fixturesYaml from '../../authored/fixtures/application-colorado-caseworker-review.yaml?raw';
// Permissions
import permsData from '../../authored/permissions/caseworker.yaml';
import permsYaml from '../../authored/permissions/caseworker.yaml?raw';
// Schema (read-only Zod source)
import schemaSource from '../../generated/schemas/application-colorado.ts?raw';
// Annotations
import annotationLayer0 from '../../generated/annotations/federal.yaml';
import annotationLayer0Yaml from '../../generated/annotations/federal.yaml?raw';
import annotationLayer1 from '../../generated/annotations/colorado.yaml';
import annotationLayer1Yaml from '../../generated/annotations/colorado.yaml?raw';

const typedContract = contract as unknown as FormContract;
const typedFixtures = fixtures as unknown as Record<string, unknown>;
const typedPerms = permsData as unknown as PermissionsPolicy;

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
  annotationLayer0 as unknown as Record<string, unknown>,
  annotationLayer1 as unknown as Record<string, unknown>,
]);
const annotationLookup = deriveAnnotationLookup(mergedAnnotations);

const meta: Meta = {
  title: 'Forms/Colorado Caseworker Review',
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
    { id: 'layout', label: 'Layout', filename: 'authored/contracts/application/colorado-caseworker-review.form.yaml', source: layoutYaml },
    { id: 'test-data', label: 'Test Data', filename: 'authored/fixtures/application-colorado-caseworker-review.yaml', source: fixturesYaml },
    { id: 'permissions', label: 'Permissions', filename: 'authored/permissions/caseworker.yaml', source: permsYaml },
    { id: 'schema', label: 'Schema', filename: 'generated/schemas/application-colorado.ts', source: schemaSource, readOnly: true, group: 'reference' as const },
    { id: 'annotations-federal', label: 'Federal Annotations', filename: 'generated/annotations/federal.yaml', source: annotationLayer0Yaml, readOnly: true, group: 'reference' as const },
    { id: 'annotations-colorado', label: 'Colorado Annotations', filename: 'generated/annotations/colorado.yaml', source: annotationLayer1Yaml, readOnly: true, group: 'reference' as const },
  ];

  return (
    <ContractPreview
      tabs={tabs}
      contractId="application-colorado-caseworker-review"
      formTitle="Colorado Caseworker Review"
      onLayoutChange={setActiveContract}
      onPermissionsChange={setPerms}
      onTestDataChange={setTestData}
    >
      <SplitPanelRenderer
        contract={activeContract}
        schema={applicationUpdateSchema}
        role="caseworker"
        panels={{
          left: { label: 'Working Copy', viewMode: 'editable' as ViewMode, data: testData },
          right: { label: 'Original Submission', viewMode: 'readonly' as ViewMode, data: testData },
        }}
        permissionsPolicy={perms}
        annotations={annotationLookup}
        onSubmit={logSubmit}
      />
    </ContractPreview>
  );
}

export const ApplicationColoradoCaseworkerReview: StoryObj = {
  name: 'Colorado Caseworker Review',
  render: () => <StoryWrapper />,
};
