// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useForm, FormProvider } from 'react-hook-form';
import type { FieldDefinition, PermissionsPolicy } from './types';
import { FieldArrayRenderer } from './FieldArrayRenderer';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Test wrapper — provides react-hook-form context
// ---------------------------------------------------------------------------

function Wrapper({
  field,
  defaultValues,
  role = 'applicant',
  permissionsPolicy,
}: {
  field: FieldDefinition;
  defaultValues?: Record<string, unknown>;
  role?: 'applicant' | 'caseworker' | 'reviewer';
  permissionsPolicy?: PermissionsPolicy;
}) {
  const methods = useForm<Record<string, unknown>>({
    defaultValues,
  });
  const formValues = methods.watch();

  return (
    <FormProvider {...methods}>
      <form>
        <FieldArrayRenderer
          field={field}
          control={methods.control}
          register={methods.register}
          errors={methods.formState.errors}
          formValues={formValues}
          role={role}
          permissionsPolicy={permissionsPolicy}
        />
      </form>
    </FormProvider>
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const householdField: FieldDefinition = {
  ref: 'household.members',
  component: 'field-array',
  hint: 'List all people in your household',
  min_items: 1,
  max_items: 3,
  fields: [
    { ref: 'firstName', component: 'text-input', width: 'half' },
    { ref: 'lastName', component: 'text-input', width: 'half' },
    {
      ref: 'relationship',
      component: 'select',
      labels: {
        spouse: 'Spouse',
        child: 'Child',
        parent: 'Parent',
      },
    },
  ],
};

const defaultData = {
  household: {
    members: [
      { firstName: 'Carlos', lastName: 'Garcia', relationship: 'spouse' },
      { firstName: 'Sofia', lastName: 'Garcia', relationship: 'child' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FieldArrayRenderer', () => {
  it('renders initial rows from default values', () => {
    render(<Wrapper field={householdField} defaultValues={defaultData} />);

    const inputs = screen.getAllByRole('textbox');
    // 2 rows × 2 text inputs each = 4
    expect(inputs).toHaveLength(4);

    // Select dropdowns
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
  });

  it('renders hint text', () => {
    render(<Wrapper field={householdField} defaultValues={defaultData} />);
    expect(screen.getByText('List all people in your household')).toBeInTheDocument();
  });

  it('adds a row when clicking "+ Add"', () => {
    render(<Wrapper field={householdField} defaultValues={defaultData} />);

    expect(screen.getAllByRole('textbox')).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: /\+ Add/ }));

    // Now 3 rows × 2 text inputs = 6
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it('removes a row when clicking "Remove"', () => {
    render(<Wrapper field={householdField} defaultValues={defaultData} />);

    expect(screen.getAllByRole('textbox')).toHaveLength(4);

    const removeButtons = screen.getAllByRole('button', { name: /Remove/ });
    fireEvent.click(removeButtons[0]);

    // 1 row × 2 text inputs = 2
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('hides Add button when max_items reached', () => {
    const data = {
      household: {
        members: [
          { firstName: 'A', lastName: 'A', relationship: 'spouse' },
          { firstName: 'B', lastName: 'B', relationship: 'child' },
          { firstName: 'C', lastName: 'C', relationship: 'parent' },
        ],
      },
    };
    render(<Wrapper field={householdField} defaultValues={data} />);

    // max_items is 3, we have 3 rows — no Add button
    expect(screen.queryByRole('button', { name: /\+ Add/ })).not.toBeInTheDocument();
  });

  it('hides Remove buttons when at min_items', () => {
    const data = {
      household: {
        members: [{ firstName: 'A', lastName: 'A', relationship: 'spouse' }],
      },
    };
    render(<Wrapper field={householdField} defaultValues={data} />);

    // min_items is 1, we have 1 row — no Remove buttons
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('hides Add and Remove in read-only permission', () => {
    const policy: PermissionsPolicy = {
      role: 'reviewer',
      defaults: 'read-only',
    };
    render(
      <Wrapper
        field={householdField}
        defaultValues={defaultData}
        role="reviewer"
        permissionsPolicy={policy}
      />,
    );

    expect(screen.queryByRole('button', { name: /\+ Add/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('renders select options from field.labels', () => {
    render(<Wrapper field={householdField} defaultValues={defaultData} />);

    const selects = screen.getAllByRole('combobox');
    const firstSelect = selects[0];
    const options = within(firstSelect).getAllByRole('option');

    // "- Select -" + 3 labels
    expect(options).toHaveLength(4);
    expect(options[1]).toHaveTextContent('Spouse');
    expect(options[2]).toHaveTextContent('Child');
    expect(options[3]).toHaveTextContent('Parent');
  });

  it('renders with no initial rows when defaultValues is empty', () => {
    render(<Wrapper field={householdField} defaultValues={{}} />);

    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /\+ Add/ })).toBeInTheDocument();
  });

  it('supports sub-field show_when conditions per row', () => {
    const fieldWithCondition: FieldDefinition = {
      ref: 'items',
      component: 'field-array',
      fields: [
        { ref: 'type', component: 'text-input' },
        {
          ref: 'details',
          component: 'text-input',
          show_when: { field: 'type', equals: 'other' },
        },
      ],
    };

    const data = {
      items: [
        { type: 'other', details: 'some detail' },
        { type: 'normal', details: '' },
      ],
    };

    render(<Wrapper field={fieldWithCondition} defaultValues={data} />);

    // Row 0 has type="other" → details visible → 2 text inputs
    // Row 1 has type="normal" → details hidden → 1 text input
    // Total: 3 text inputs
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(3);
  });
});
