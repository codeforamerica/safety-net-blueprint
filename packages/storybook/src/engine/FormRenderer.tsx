import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, Button, Accordion, Tag } from '@trussworks/react-uswds';
import type { ZodSchema } from 'zod';
import type { FormContract, Role, Page, PermissionsPolicy, FieldDefinition } from './types';

/** Resolve a dot-path like 'name.firstName' from a nested object. */
function get(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}
import { ComponentMapper } from './ComponentMapper';
import { FieldArrayRenderer } from './FieldArrayRenderer';
import { resolveCondition } from './ConditionResolver';
import { resolvePermission } from './PermissionsResolver';
import { PageStepper } from './PageStepper';

/** Strip numeric indices from a qualified ref (e.g. household.members.0.ssn → household.members.ssn). */
function stripIndices(ref: string): string {
  return ref.replace(/\.\d+/g, '');
}

/**
 * Collect all annotation refs for a flat list of fields (recursing into field-array templates).
 * Returns the set of programs each field requires, keyed by unqualified ref.
 */
function collectFieldPrograms(
  fields: FieldDefinition[],
  annotations: Record<string, string[]>,
  parentRef?: string,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const field of fields) {
    const absRef = parentRef ? `${stripIndices(parentRef)}.${field.ref}` : stripIndices(field.ref);
    const programs = annotations[absRef] ?? annotations[field.ref];
    if (programs?.length) result.set(absRef, programs);
    if (field.fields) {
      for (const [k, v] of collectFieldPrograms(field.fields, annotations, field.ref)) {
        result.set(k, v);
      }
    }
  }
  return result;
}

/** Compute the union of all program arrays. */
function programUnion(fieldMap: Map<string, string[]>): string[] {
  const set = new Set<string>();
  for (const programs of fieldMap.values()) {
    for (const p of programs) set.add(p);
  }
  return Array.from(set);
}

interface FormRendererProps {
  contract: FormContract;
  schema: ZodSchema;
  role?: Role;
  initialPage?: number;
  defaultValues?: Record<string, unknown>;
  permissionsPolicy?: PermissionsPolicy;
  annotations?: Record<string, string[]>;
  onSubmit?: (data: Record<string, unknown>) => void;
  onPageChange?: (pageId: string) => void;
}

export function FormRenderer({
  contract,
  schema,
  role = 'applicant',
  initialPage = 0,
  defaultValues,
  permissionsPolicy,
  annotations,
  onSubmit,
  onPageChange,
}: FormRendererProps) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const { pages, layout = 'wizard' } = contract.form;

  const {
    register,
    handleSubmit,
    watch,
    reset,
    control,
    formState: { errors },
  } = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues,
  });

  // Reset form when defaultValues change (e.g. test data edited in Storybook)
  useEffect(() => {
    if (defaultValues) {
      reset(defaultValues);
    }
  }, [defaultValues, reset]);

  const formValues = watch();

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit?.(data);
  });

  const renderFields = (page: Page) => {
    // Compute page-level annotation baseline
    const fieldMap = annotations
      ? collectFieldPrograms(page.fields, annotations)
      : new Map<string, string[]>();
    const pagePrograms = programUnion(fieldMap);

    return (
      <>
        {annotations && pagePrograms.length > 0 && (
          <div
            style={{
              background: '#f0f0f0',
              border: '1px solid #dfe1e2',
              borderRadius: '4px',
              padding: '0.5rem 0.75rem',
              marginBottom: '1rem',
              fontSize: '0.8125rem',
              lineHeight: '1.6',
            }}
          >
            <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>Programs:</span>
            {pagePrograms.map((p) => (
              <Tag key={p} className="margin-right-05" style={{ fontSize: '11px', padding: '1px 6px' }}>{p.replace(/_/g, ' ')}</Tag>
            ))}
          </div>
        )}
        <div className="grid-row grid-gap">
          {page.fields.map((field) => {
            if (!resolveCondition(field.show_when, formValues)) {
              return null;
            }

            const permission = resolvePermission(field, role, permissionsPolicy);
            if (permission === 'hidden') return null;

            if (field.component === 'field-array') {
              return (
                <div key={field.ref} className="grid-col-12">
                  <FieldArrayRenderer
                    field={field}
                    control={control}
                    register={register}
                    errors={errors}
                    formValues={formValues}
                    role={role}
                    permissionsPolicy={permissionsPolicy}
                    annotations={annotations}
                    pagePrograms={pagePrograms}
                  />
                </div>
              );
            }

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
                  value={get(formValues, field.ref)}
                  annotations={annotations}
                  pagePrograms={pagePrograms}
                />
              </div>
            );
          })}
        </div>
      </>
    );
  };

  if (layout === 'review') {
    const accordionItems = pages.map((page) => ({
      id: page.id,
      title: page.title,
      expanded: page.expanded !== false,
      headingLevel: 'h2' as const,
      content: renderFields(page),
    }));

    return (
      <div className="grid-container">
        <h1>{contract.form.title}</h1>
        <Form onSubmit={handleFormSubmit} large>
          <Accordion bordered multiselectable items={accordionItems} />
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
