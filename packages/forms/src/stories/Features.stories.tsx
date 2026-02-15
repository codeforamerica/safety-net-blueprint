import React, { useState, useCallback } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormRenderer } from '../engine/FormRenderer';
import { ContractPreview } from '../engine/ContractPreview';
import { personCreateSchema } from '../schemas/person';
import type { FormContract } from '../engine/types';

import applicantContract from '../contracts/person-intake.yaml';
import applicantYaml from '../contracts/person-intake.yaml?raw';
import caseworkerContract from '../contracts/person-caseworker-review.yaml';
import caseworkerYaml from '../contracts/person-caseworker-review.yaml?raw';

const intakeContract = applicantContract as unknown as FormContract;
const reviewContract = caseworkerContract as unknown as FormContract;

const meta: Meta = {
  title: 'Features',
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

const logSubmit = (data: Record<string, unknown>) => {
  console.log('Form submitted:', data);
  alert('Submitted! Check console for data.');
};

// ---------------------------------------------------------------------------
// Simple condition: immigration fields hidden when citizen
// ---------------------------------------------------------------------------

export const ConditionalHidden: StoryObj = {
  name: 'Conditional: Immigration Fields Hidden',
  render: () => {
    const [active, setActive] = useState(intakeContract);
    return (
      <ContractPreview
        yamlSource={applicantYaml}
        filename="person-intake.yaml"
        initialContract={intakeContract}
        onContractChange={setActive}
      >
        <FormRenderer
          contract={active}
          schema={personCreateSchema}
          role="applicant"
          initialPage={2}
          defaultValues={{ citizenshipInfo: { status: 'citizen' } }}
          onSubmit={logSubmit}
        />
      </ContractPreview>
    );
  },
};

export const ConditionalVisible: StoryObj = {
  name: 'Conditional: Immigration Fields Visible',
  render: () => {
    const [active, setActive] = useState(intakeContract);
    return (
      <ContractPreview
        yamlSource={applicantYaml}
        filename="person-intake.yaml"
        initialContract={intakeContract}
        onContractChange={setActive}
      >
        <FormRenderer
          contract={active}
          schema={personCreateSchema}
          role="applicant"
          initialPage={2}
          defaultValues={{ citizenshipInfo: { status: 'permanent_resident' } }}
          onSubmit={logSubmit}
        />
      </ContractPreview>
    );
  },
};

// ---------------------------------------------------------------------------
// JSON Logic: compound condition — sponsor fields require non-citizen AND hasSponsor
// ---------------------------------------------------------------------------

export const JsonLogicSponsorHidden: StoryObj = {
  name: 'JSON Logic: Sponsor Fields Hidden',
  render: () => {
    const [active, setActive] = useState(reviewContract);
    return (
      <ContractPreview
        yamlSource={caseworkerYaml}
        filename="person-caseworker-review.yaml"
        initialContract={reviewContract}
        onContractChange={setActive}
      >
        <FormRenderer
          contract={active}
          schema={personCreateSchema}
          role="caseworker"
          defaultValues={{
            citizenshipInfo: {
              status: 'permanent_resident',
              immigrationInfo: { hasSponsor: 'false' },
            },
          }}
          onSubmit={logSubmit}
        />
      </ContractPreview>
    );
  },
};

export const JsonLogicSponsorVisible: StoryObj = {
  name: 'JSON Logic: Sponsor Fields Visible',
  render: () => {
    const [active, setActive] = useState(reviewContract);
    return (
      <ContractPreview
        yamlSource={caseworkerYaml}
        filename="person-caseworker-review.yaml"
        initialContract={reviewContract}
        onContractChange={setActive}
      >
        <FormRenderer
          contract={active}
          schema={personCreateSchema}
          role="caseworker"
          defaultValues={{
            citizenshipInfo: {
              status: 'permanent_resident',
              immigrationInfo: { hasSponsor: 'true' },
            },
          }}
          onSubmit={logSubmit}
        />
      </ContractPreview>
    );
  },
};

// ---------------------------------------------------------------------------
// Permissions: SSN masked for reviewer vs editable for applicant
// ---------------------------------------------------------------------------

export const PermissionSSNEditable: StoryObj = {
  name: 'Permissions: SSN Editable (Applicant)',
  render: () => {
    const [active, setActive] = useState(intakeContract);
    return (
      <ContractPreview
        yamlSource={applicantYaml}
        filename="person-intake.yaml"
        initialContract={intakeContract}
        onContractChange={setActive}
      >
        <FormRenderer
          contract={active}
          schema={personCreateSchema}
          role="applicant"
          initialPage={0}
          onSubmit={logSubmit}
        />
      </ContractPreview>
    );
  },
};

export const PermissionSSNMasked: StoryObj = {
  name: 'Permissions: SSN Masked (Reviewer)',
  render: () => {
    const [active, setActive] = useState(intakeContract);
    return (
      <ContractPreview
        yamlSource={applicantYaml}
        filename="person-intake.yaml"
        initialContract={intakeContract}
        onContractChange={setActive}
      >
        <FormRenderer
          contract={active}
          schema={personCreateSchema}
          role="reviewer"
          initialPage={0}
          defaultValues={{ socialSecurityNumber: '123-45-6789' }}
          onSubmit={logSubmit}
        />
      </ContractPreview>
    );
  },
};

// ---------------------------------------------------------------------------
// Layout: wizard vs review
// ---------------------------------------------------------------------------

export const LayoutWizard: StoryObj = {
  name: 'Layout: Wizard (Applicant)',
  render: () => {
    const [active, setActive] = useState(intakeContract);
    const [pageId, setPageId] = useState('personal-info');
    return (
      <ContractPreview
        yamlSource={applicantYaml}
        filename="person-intake.yaml"
        initialContract={intakeContract}
        onContractChange={setActive}
        currentPageId={pageId}
      >
        <FormRenderer
          contract={active}
          schema={personCreateSchema}
          role="applicant"
          initialPage={0}
          onSubmit={logSubmit}
          onPageChange={setPageId}
        />
      </ContractPreview>
    );
  },
};

export const LayoutReview: StoryObj = {
  name: 'Layout: Review (Caseworker)',
  render: () => {
    const [active, setActive] = useState(reviewContract);
    return (
      <ContractPreview
        yamlSource={caseworkerYaml}
        filename="person-caseworker-review.yaml"
        initialContract={reviewContract}
        onContractChange={setActive}
      >
        <FormRenderer
          contract={active}
          schema={personCreateSchema}
          role="caseworker"
          onSubmit={logSubmit}
        />
      </ContractPreview>
    );
  },
};
