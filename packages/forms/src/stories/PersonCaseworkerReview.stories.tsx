import React, { useState, useCallback } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../engine/FormRenderer';
import { ContractPreview } from '../engine/ContractPreview';
import { personCreateSchema } from '../schemas/person';
import type { FormContract } from '../engine/types';

import contract from '../contracts/person-caseworker-review.yaml';
import yamlSource from '../contracts/person-caseworker-review.yaml?raw';

const caseworkerContract = contract as unknown as FormContract;

const meta: Meta = {
  title: 'Forms/Person Caseworker Review',
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

const defaultSubmit = (data: Record<string, unknown>) => {
  console.log('Caseworker review submitted:', data);
  alert('Saved! Check console for data.');
};

function CaseworkerStory() {
  const [activeContract, setActiveContract] = useState(caseworkerContract);

  const handleContractChange = useCallback((updated: FormContract) => {
    setActiveContract(updated);
  }, []);

  return (
    <ContractPreview
      yamlSource={yamlSource}
      filename="person-caseworker-review.yaml"
      initialContract={caseworkerContract}
      onContractChange={handleContractChange}
    >
      <FormRenderer
        contract={activeContract}
        schema={personCreateSchema}
        role="caseworker"
        onSubmit={defaultSubmit}
      />
    </ContractPreview>
  );
}

export const CaseworkerReview: StoryObj = {
  name: 'Caseworker Review',
  render: () => <CaseworkerStory />,
};

export const FormOnly: StoryObj = {
  name: 'Form Only (No Source)',
  parameters: { layout: 'padded' },
  render: () => (
    <FormRenderer
      contract={caseworkerContract}
      schema={personCreateSchema}
      role="caseworker"
      onSubmit={defaultSubmit}
    />
  ),
};
