import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, Button, Accordion, Tag } from '@trussworks/react-uswds';
import type { ZodSchema } from 'zod';
import type { FormContract, Role, Page, PermissionsPolicy, FieldDefinition, ViewMode, AnnotationLayer, DisplayType, LayoutConfig, AnnotationEntry, AnnotationDisplayConfig } from './types';
import { resolveAnnotationDisplay } from './types';
import { DataTableRenderer } from './DataTableRenderer';
import { ListDetailRenderer } from './ListDetailRenderer';

/** Resolve a dot-path like 'name.firstName' from a nested object. */
function get(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}
import { ds } from './theme';
import { ComponentMapper } from './ComponentMapper';
import { FieldArrayRenderer } from './FieldArrayRenderer';
import { resolveCondition } from './ConditionResolver';
import { resolvePermission } from './PermissionsResolver';
import { PageStepper } from './PageStepper';
import { FormSideNav } from './FormSideNav';
import { FormTopNav } from './FormTopNav';
import { FormInPageNav } from './FormInPageNav';
import { resolveLayout } from './layout-utils';

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
  viewMode?: ViewMode;
  initialPage?: number;
  currentPage?: number;
  defaultValues?: Record<string, unknown>;
  permissionsPolicy?: PermissionsPolicy;
  annotations?: Record<string, string[]>;
  /** Full annotation entries keyed by field ref. When present, programs are derived internally. */
  annotationEntries?: Record<string, AnnotationEntry>;
  onSubmit?: (data: Record<string, unknown>) => void;
  onPageChange?: (pageId: string) => void;
  /** Hide title, stepper, and submit chrome (used when embedded in SplitPanelRenderer). */
  hideChrome?: boolean;
  /** Prefix for DOM element IDs to avoid collisions when multiple renderers share a page. */
  idPrefix?: string;
  /** Original values for diff highlighting. Fields whose value differs get a visual indicator. */
  compareValues?: Record<string, unknown>;
  /** Annotation layers for data-table pages. */
  annotationLayers?: AnnotationLayer[];
  /** Permissions policies for data-table pages. */
  permissionsPolicies?: PermissionsPolicy[];
  /** OpenAPI spec for schema column resolution in data-table pages. */
  schemaSpec?: Record<string, unknown>;
  /** Detail form contract for list-detail navigation in data-table mode. */
  detailContract?: FormContract;
  /** Zod schema for the detail form. */
  detailSchema?: ZodSchema;
  /** Role for the detail form. */
  detailRole?: Role;
  /** HTML id attribute for the <Form> element, enabling external submit via requestSubmit(). */
  formId?: string;
}

/** Resolve effective display type for a page (page override or form-level config). */
function resolvePageDisplay(page: Page, config: LayoutConfig): DisplayType {
  return page.display ?? config.display;
}

export function FormRenderer({
  contract,
  schema,
  role = 'applicant',
  viewMode = 'editable',
  initialPage = 0,
  currentPage: controlledPage,
  defaultValues,
  permissionsPolicy,
  annotations,
  annotationEntries,
  onSubmit,
  onPageChange,
  hideChrome = false,
  idPrefix = '',
  compareValues,
  annotationLayers = [],
  permissionsPolicies = [],
  schemaSpec,
  detailContract,
  detailSchema,
  detailRole,
  formId,
}: FormRendererProps) {
  const [internalPage, setInternalPage] = useState(initialPage);
  const currentPage = controlledPage ?? internalPage;
  const setCurrentPage = (page: number) => {
    setInternalPage(page);
  };
  const isReadonly = viewMode === 'readonly';
  const { pages, layout } = contract.form;
  const annotationDisplay = resolveAnnotationDisplay(contract.form.annotation_display);

  // Derive legacy annotations lookup from annotationEntries when not explicitly provided
  const effectiveAnnotations = annotations ?? (annotationEntries
    ? Object.fromEntries(
        Object.entries(annotationEntries)
          .filter(([, e]) => e.programs && Object.keys(e.programs).length > 0)
          .map(([ref, e]) => [ref, Object.keys(e.programs!)])
      )
    : undefined);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    control,
    formState: { errors },
  } = useForm<Record<string, unknown>>({
    ...(isReadonly ? {} : { resolver: zodResolver(schema) }),
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
    const pageFields = page.fields ?? [];
    // Compute page-level annotation baseline
    const fieldMap = effectiveAnnotations
      ? collectFieldPrograms(pageFields, effectiveAnnotations)
      : new Map<string, string[]>();
    const pagePrograms = programUnion(fieldMap);

    return (
      <>
        {effectiveAnnotations && pagePrograms.length > 0 && annotationDisplay.programs.page !== 'hidden' && (
          <div
            className="bg-base-lightest border-1px border-base-lighter radius-sm padding-y-05 padding-x-1 margin-bottom-2 font-sans-3xs line-height-sans-4"
          >
            <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>Programs:</span>
            {pagePrograms.map((p) => (
              <Tag key={p} className="margin-right-05" style={{ fontSize: '11px', padding: '1px 6px' }}>{p.replace(/_/g, ' ')}</Tag>
            ))}
          </div>
        )}
        <div className="grid-row grid-gap">
          {pageFields.map((field) => {
            if (!resolveCondition(field.show_when, formValues)) {
              return null;
            }

            const basePermission = resolvePermission(field, role, permissionsPolicy);
            if (basePermission === 'hidden') return null;
            const permission = isReadonly ? 'read-only' as const : basePermission;

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
                    viewMode={viewMode}
                    permissionsPolicy={permissionsPolicy}
                    annotations={effectiveAnnotations}
                    pagePrograms={pagePrograms}
                    idPrefix={idPrefix}
                    compareValues={compareValues}
                    annotationEntries={annotationEntries}
                    annotationDisplay={annotationDisplay}
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
                  annotations={effectiveAnnotations}
                  pagePrograms={pagePrograms}
                  idPrefix={idPrefix}
                  compareValues={compareValues}
                  annotationEntries={annotationEntries}
                  annotationDisplay={annotationDisplay}
                />
              </div>
            );
          })}
        </div>
      </>
    );
  };

  const config = resolveLayout(layout);

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

  const handlePageSelect = (index: number) => {
    setCurrentPage(index);
    onPageChange?.(pages[index].id);
  };

  if (hideChrome) {
    return (
      <Form id={formId} className={ds.form} onSubmit={handleFormSubmit}>
        <h2>{page.title}</h2>
        {renderFields(page)}
      </Form>
    );
  }

  // --- Display content ---
  let content: React.ReactNode;
  if (config.display === 'data-table') {
    // Full data-table mode: all pages rendered in a single table
    const tableColumns = contract.form.columns ?? [];
    if (detailContract) {
      return (
        <ListDetailRenderer
          pages={pages}
          columns={tableColumns}
          title={contract.form.title}
          source="contract"
          detailContract={detailContract}
          detailSchema={detailSchema}
          detailRole={detailRole}
          annotationLayers={annotationLayers}
          permissionsPolicies={permissionsPolicies}
          schemaSpec={schemaSpec}
        />
      );
    }
    return (
      <DataTableRenderer
        pages={pages}
        columns={tableColumns}
        title={contract.form.title}
        source="contract"
        annotationLayers={annotationLayers}
        permissionsPolicies={permissionsPolicies}
        schemaSpec={schemaSpec}
      />
    );
  }
  if (config.display === 'accordion') {
    const accordionItems = pages.map((p) => ({
      id: p.id,
      title: p.title,
      expanded: p.expanded !== false,
      headingLevel: 'h2' as const,
      content: renderFields(p),
    }));
    content = (
      <>
        <Accordion className={ds.accordion} bordered multiselectable items={accordionItems} />
        {!isReadonly && (
          <Button className={ds.button} type="submit" style={{ marginTop: '1.5rem' }}>
            Save
          </Button>
        )}
      </>
    );
  } else if (config.display === 'scrollable') {
    content = pages.map((p) => (
      <section key={p.id} id={p.id}>
        <h2>{p.title}</h2>
        {renderFields(p)}
      </section>
    ));
  } else {
    // paginated
    content = (
      <>
        <h2>{page.title}</h2>
        {renderFields(page)}
      </>
    );
  }

  // --- Navigation + layout assembly ---
  if (config.navigation === 'side-nav') {
    return (
      <div className="grid-container">
        <h1>{contract.form.title}</h1>
        <div className="grid-row grid-gap">
          <div className="grid-col-3">
            <FormSideNav
              pages={pages}
              currentPage={currentPage}
              onPageSelect={handlePageSelect}
            />
          </div>
          <div className="grid-col-9">
            <Form id={formId} className={ds.form} onSubmit={handleFormSubmit} large>
              {content}
            </Form>
          </div>
        </div>
      </div>
    );
  }

  if (config.navigation === 'step-indicator') {
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
        <Form id={formId} className={ds.form} onSubmit={handleFormSubmit} large>
          {content}
        </Form>
      </div>
    );
  }

  if (config.navigation === 'top-nav') {
    return (
      <>
        <FormTopNav
          pages={pages}
          currentPage={currentPage}
          onPageSelect={handlePageSelect}
        />
        <div className="grid-container">
          <h1>{contract.form.title}</h1>
          <Form id={formId} className={ds.form} onSubmit={handleFormSubmit} large>
            {content}
          </Form>
        </div>
      </>
    );
  }

  if (config.navigation === 'in-page') {
    return (
      <div className="grid-container">
        <h1>{contract.form.title}</h1>
        <div className="grid-row grid-gap">
          <div className="grid-col-9">
            <Form id={formId} className={ds.form} onSubmit={handleFormSubmit} large>
              {pages.map((p) => (
                <section key={p.id} id={p.id}>
                  <h2>{p.title}</h2>
                  {renderFields(p)}
                </section>
              ))}
            </Form>
          </div>
          <div className="grid-col-3" style={{ position: 'sticky', top: '1rem', alignSelf: 'start' }}>
            <FormInPageNav pages={pages} />
          </div>
        </div>
      </div>
    );
  }

  // navigation: 'none'
  return (
    <div className="grid-container">
      <h1>{contract.form.title}</h1>
      <Form id={formId} className={ds.form} onSubmit={handleFormSubmit} large>
        {content}
      </Form>
    </div>
  );
}
