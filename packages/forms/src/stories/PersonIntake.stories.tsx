import React, { useState, useCallback } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../engine/FormRenderer';
import { ContractPreview } from '../engine/ContractPreview';
import { personCreateSchema } from '../schemas/person';
import type { FormContract, Role } from '../engine/types';

// Parsed YAML (via vite-plugin-yaml) — file edits hot-reload here
import contract from '../contracts/person-intake.yaml';
// Raw YAML source for the editable preview
import yamlSource from '../contracts/person-intake.yaml?raw';

const personIntakeContract = contract as unknown as FormContract;

const meta: Meta = {
  title: 'Forms/Person Intake',
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

const defaultSubmit = (data: Record<string, unknown>) => {
  console.log('Form submitted:', data);
  alert('Form submitted! Check console for data.');
};

// -- Side-by-side stories (editable contract source + rendered form) --

function SideBySideStory({
  initialPage = 0,
  role = 'applicant',
}: {
  initialPage?: number;
  role?: Role;
}) {
  const [activeContract, setActiveContract] = useState(personIntakeContract);
  const startPageId = activeContract.form.pages[initialPage]?.id;
  const [currentPageId, setCurrentPageId] = useState(startPageId);

  const handleContractChange = useCallback((updated: FormContract) => {
    setActiveContract(updated);
  }, []);

  return (
    <ContractPreview
      yamlSource={yamlSource}
      filename="person-intake.yaml"
      initialContract={personIntakeContract}
      onContractChange={handleContractChange}
      currentPageId={currentPageId}
    >
      <FormRenderer
        contract={activeContract}
        schema={personCreateSchema}
        role={role}
        initialPage={initialPage}
        onSubmit={defaultSubmit}
        onPageChange={setCurrentPageId}
      />
    </ContractPreview>
  );
}

export const Page1PersonalInfo: StoryObj = {
  name: 'Page 1 - Personal Info',
  render: () => <SideBySideStory initialPage={0} />,
};

export const Page2Demographics: StoryObj = {
  name: 'Page 2 - Demographics',
  render: () => <SideBySideStory initialPage={1} />,
};

export const Page3CitizenshipCitizen: StoryObj = {
  name: 'Page 3 - Citizenship (Citizen)',
  render: () => <SideBySideStory initialPage={2} />,
};

export const Page3CitizenshipNonCitizen: StoryObj = {
  name: 'Page 3 - Citizenship (Non-Citizen)',
  render: () => <SideBySideStory initialPage={2} />,
};

export const FullWizard: StoryObj = {
  name: 'Full Wizard',
  render: () => <SideBySideStory initialPage={0} />,
};

// -- Form-only stories (no source panel) --

export const FormOnly: StoryObj = {
  name: 'Form Only (No Source)',
  parameters: { layout: 'padded' },
  render: () => (
    <FormRenderer
      contract={personIntakeContract}
      schema={personCreateSchema}
      role="applicant"
      initialPage={0}
      onSubmit={defaultSubmit}
    />
  ),
};
