import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, Button } from '@trussworks/react-uswds';
import type { ZodSchema } from 'zod';
import type { FormContract, Role, Page } from './types';
import { ComponentMapper } from './ComponentMapper';
import { resolveCondition } from './ConditionResolver';
import { resolvePermission } from './PermissionsResolver';
import { PageStepper } from './PageStepper';

interface FormRendererProps {
  contract: FormContract;
  schema: ZodSchema;
  role?: Role;
  initialPage?: number;
  defaultValues?: Record<string, unknown>;
  onSubmit?: (data: Record<string, unknown>) => void;
  onPageChange?: (pageId: string) => void;
}

export function FormRenderer({
  contract,
  schema,
  role = 'applicant',
  initialPage = 0,
  onSubmit,
  onPageChange,
  defaultValues,
}: FormRendererProps) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const { pages, layout = 'wizard' } = contract.form;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues,
  });

  const formValues = watch();

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit?.(data);
  });

  const renderFields = (page: Page) => (
    <div className="grid-row grid-gap">
      {page.fields.map((field) => {
        if (!resolveCondition(field.show_when, formValues)) {
          return null;
        }

        const permission = resolvePermission(field, role);
        if (permission === 'hidden') return null;

        const widthClass =
          field.width === 'half'
            ? 'grid-col-6'
            : field.width === 'third'
              ? 'grid-col-4'
              : field.width === 'two-thirds'
                ? 'grid-col-8'
                : 'grid-col-12';

        return (
          <div key={field.ref} className={widthClass}>
            <ComponentMapper
              field={field}
              register={register}
              errors={errors}
              permission={permission}
              value={formValues[field.ref]}
            />
          </div>
        );
      })}
    </div>
  );

  if (layout === 'review') {
    return (
      <div className="grid-container">
        <h1>{contract.form.title}</h1>
        <Form onSubmit={handleFormSubmit} large>
          {pages.map((page) => (
            <fieldset
              key={page.id}
              className="usa-fieldset"
              style={{
                borderTop: '1px solid #dfe1e2',
                paddingTop: '1.5rem',
                marginTop: '1.5rem',
              }}
            >
              <legend className="usa-legend usa-legend--large">
                {page.title}
              </legend>
              {renderFields(page)}
            </fieldset>
          ))}
          <Button type="submit" style={{ marginTop: '1.5rem' }}>
            Save
          </Button>
        </Form>
      </div>
    );
  }

  // Wizard layout (default)
  const page = pages[currentPage];

  const handleNext = () => {
    if (currentPage < pages.length - 1) {
      const next = currentPage + 1;
      setCurrentPage(next);
      onPageChange?.(pages[next].id);
    }
  };

  const handleBack = () => {
    if (currentPage > 0) {
      const prev = currentPage - 1;
      setCurrentPage(prev);
      onPageChange?.(pages[prev].id);
    }
  };

  return (
    <div className="grid-container">
      <h1>{contract.form.title}</h1>

      <PageStepper
        pages={pages}
        currentPage={currentPage}
        onNext={handleNext}
        onBack={handleBack}
        onSubmit={() => void handleFormSubmit()}
      />

      <Form onSubmit={handleFormSubmit} large>
        <h2>{page.title}</h2>
        {renderFields(page)}
      </Form>
    </div>
  );
}
