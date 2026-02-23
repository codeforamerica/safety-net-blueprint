import React, { useState, useMemo } from 'react';
import { useFieldArray, type Control, type UseFormRegister, type FieldErrors } from 'react-hook-form';
import { Button, Table, Accordion, BreadcrumbBar, Breadcrumb, BreadcrumbLink } from '@trussworks/react-uswds';
import type { FieldDefinition, Role, PermissionsPolicy, ShowWhen, SimpleCondition, ViewMode, AnnotationEntry, AnnotationDisplayConfig, FieldGroup } from './types';
import { ds } from './theme';
import { ComponentMapper } from './ComponentMapper';
import { resolveCondition } from './ConditionResolver';
import { resolvePermission } from './PermissionsResolver';
import { labelFromRef } from './field-utils';

/** Resolve a dot-path like 'name.firstName' from a nested object. */
function get(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

/**
 * Qualify a show_when condition's field path relative to a row.
 * If the field path doesn't contain a dot (i.e. it's a simple relative ref),
 * prefix it with the row path so it resolves against the full form values.
 */
function qualifyShowWhen(
  showWhen: ShowWhen | undefined,
  rowPrefix: string,
): ShowWhen | undefined {
  if (!showWhen) return undefined;

  if ('jsonlogic' in showWhen) {
    // JSON Logic conditions use `var` for field paths — leave as-is for now
    return showWhen;
  }

  const simple = showWhen as SimpleCondition;
  // If the field path is a simple name (no dots), qualify it to the row
  const qualifiedField = simple.field.includes('.')
    ? simple.field
    : `${rowPrefix}.${simple.field}`;

  return { ...simple, field: qualifiedField };
}

/** Build a summary string for an accordion row header from column definitions. */
function buildRowSummary(
  formValues: Record<string, unknown>,
  fieldRef: string,
  index: number,
  columns?: { from: string; label: string }[],
): string {
  if (!columns?.length) return `Item ${index + 1}`;
  const parts = columns.map((col) => {
    const val = get(formValues, `${fieldRef}.${index}.${col.from}`);
    return val != null && val !== '' ? String(val) : '';
  }).filter(Boolean);
  return parts.length > 0 ? parts.join(' \u2014 ') : `Item ${index + 1}`;
}

interface FieldArrayRendererProps {
  field: FieldDefinition;
  control: Control<Record<string, unknown>>;
  register: UseFormRegister<Record<string, unknown>>;
  errors: FieldErrors;
  formValues: Record<string, unknown>;
  role: Role;
  viewMode?: ViewMode;
  permissionsPolicy?: PermissionsPolicy;
  annotations?: Record<string, string[]>;
  pagePrograms?: string[];
  idPrefix?: string;
  /** Original values for diff highlighting. */
  compareValues?: Record<string, unknown>;
  /** Full annotation entries keyed by field ref. */
  annotationEntries?: Record<string, AnnotationEntry>;
  /** Resolved annotation display config. */
  annotationDisplay?: Required<AnnotationDisplayConfig>;
}

export function FieldArrayRenderer({
  field,
  control,
  register,
  errors,
  formValues,
  role,
  viewMode = 'editable',
  permissionsPolicy,
  annotations,
  pagePrograms,
  idPrefix = '',
  compareValues,
  annotationEntries,
  annotationDisplay,
}: FieldArrayRendererProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic path from contract
  const { fields: rows, append, remove } = useFieldArray({
    control: control as any,
    name: field.ref as any,
  });

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const basePermission = resolvePermission(field, role, permissionsPolicy);
  const isViewReadonly = viewMode === 'readonly';
  const isReadOnly = isViewReadonly || basePermission === 'read-only';
  const canAdd = !isReadOnly && (field.max_items == null || rows.length < field.max_items);
  const canRemove = !isReadOnly && (field.min_items == null || rows.length > field.min_items);
  const templateFields = field.fields ?? [];
  const display = field.display ?? 'inline';

  const handleAdd = () => {
    const emptyRow: Record<string, string> = {};
    for (const sub of templateFields) {
      emptyRow[sub.ref] = '';
    }
    append(emptyRow);
  };

  // --- Shared: render sub-fields for a single row ---

  const renderRowFields = (index: number, rowId: string, subset?: FieldDefinition[]) => {
    const rowPrefix = `${field.ref}.${index}`;
    const fieldsToRender = subset ?? templateFields;

    return fieldsToRender.map((subField) => {
      const qualifiedRef = `${rowPrefix}.${subField.ref}`;
      const qualifiedField: FieldDefinition = {
        ...subField,
        ref: qualifiedRef,
        show_when: undefined,
      };

      const qualifiedCondition = qualifyShowWhen(subField.show_when, rowPrefix);
      if (!resolveCondition(qualifiedCondition, formValues)) {
        return null;
      }

      const baseSubPermission = resolvePermission(subField, role, permissionsPolicy);
      if (baseSubPermission === 'hidden') return null;
      const subPermission = isViewReadonly ? 'read-only' as const : baseSubPermission;

      const widthClass =
        subField.width === 'half'
          ? 'grid-col-6'
          : subField.width === 'third'
            ? 'grid-col-4'
            : subField.width === 'two-thirds'
              ? 'grid-col-8'
              : 'grid-col-12';

      return (
        <div key={qualifiedRef} className={widthClass}>
          <ComponentMapper
            field={qualifiedField}
            register={register}
            errors={errors}
            permission={subPermission}
            value={get(formValues, qualifiedRef)}
            annotations={annotations}
            pagePrograms={pagePrograms}
            idPrefix={idPrefix}
            compareValues={compareValues}
            annotationEntries={annotationEntries}
            annotationDisplay={annotationDisplay}
          />
        </div>
      );
    });
  };

  // --- Shared: group fields by group config ---

  const groupedFields = useMemo(() => {
    if (!field.groups?.length) return null;

    const groupRefSet = new Set(field.groups.flatMap((g) => g.fields));
    const ungrouped = templateFields.filter((f) => !groupRefSet.has(f.ref));
    return { groups: field.groups, ungrouped };
  }, [field.groups, templateFields]);

  const renderGroupedRow = (index: number, rowId: string) => {
    if (!groupedFields) {
      return (
        <div className="grid-row grid-gap">
          {renderRowFields(index, rowId)}
        </div>
      );
    }

    const { groups, ungrouped } = groupedFields;

    // Map sub-field refs to their FieldDefinition for lookup
    const fieldMap = new Map(templateFields.map((f) => [f.ref, f]));

    return (
      <>
        {ungrouped.length > 0 && (
          <div className="grid-row grid-gap">
            {renderRowFields(index, rowId, ungrouped)}
          </div>
        )}
        {groups.map((group) => {
          const groupSubs = group.fields
            .map((ref) => fieldMap.get(ref))
            .filter((f): f is FieldDefinition => f != null);
          if (groupSubs.length === 0) return null;
          return (
            <fieldset
              key={group.title}
              className="usa-fieldset border-1px border-base-light padding-2 margin-top-2"
            >
              <legend className="usa-legend font-sans-xs text-bold text-uppercase text-base">
                {group.title}
              </legend>
              <div className="grid-row grid-gap">
                {renderRowFields(index, rowId, groupSubs)}
              </div>
            </fieldset>
          );
        })}
      </>
    );
  };

  // =====================================================================
  // INLINE (default) — current flat rendering
  // =====================================================================

  const legend = field.hint || labelFromRef(field.ref);

  if (display === 'inline') {
    return (
      <fieldset className={`usa-fieldset border-1px border-base padding-2 margin-bottom-2 ${ds.fieldset}`.trim()}>
        <legend className="usa-legend font-sans-md text-bold">{legend}</legend>


        {rows.map((row, index) => (
          <div key={row.id} className="grid-row grid-gap border-bottom-1px border-base-light padding-bottom-05 margin-bottom-05">
            {renderRowFields(index, row.id)}

            {canRemove && (
              <div className="grid-col-12 margin-top-05">
                <Button
                  className={`${ds.button} text-error font-sans-xs`.trim()}
                  type="button"
                  unstyled
                  onClick={() => remove(index)}
                >
                  Remove
                </Button>
              </div>
            )}
          </div>
        ))}

        {canAdd && (
          <Button className={`${ds.button} margin-top-1`.trim()} type="button" outline onClick={handleAdd}>
            + Add
          </Button>
        )}
      </fieldset>
    );
  }

  // =====================================================================
  // ACCORDION — each row is a collapsible accordion item with grouped fieldsets
  // =====================================================================

  if (display === 'accordion') {
    const accordionItems = rows.map((row, index) => ({
      id: `${field.ref}-${index}`,
      title: buildRowSummary(formValues, field.ref, index, field.columns),
      expanded: false,
      headingLevel: 'h4' as const,
      content: (
        <div>
          {renderGroupedRow(index, row.id)}

          {canRemove && (
            <div className="margin-top-2">
              <Button
                className={`${ds.button} text-error font-sans-xs`.trim()}
                type="button"
                unstyled
                onClick={() => remove(index)}
              >
                Remove
              </Button>
            </div>
          )}
        </div>
      ),
    }));

    return (
      <fieldset className={`usa-fieldset border-1px border-base padding-2 margin-bottom-2 ${ds.fieldset}`.trim()}>
        <legend className="usa-legend font-sans-md text-bold">{legend}</legend>


        {accordionItems.length > 0 && (
          <Accordion className={ds.accordion} bordered multiselectable items={accordionItems} />
        )}

        {canAdd && (
          <Button className={`${ds.button} margin-top-1`.trim()} type="button" outline onClick={handleAdd}>
            + Add
          </Button>
        )}
      </fieldset>
    );
  }

  // =====================================================================
  // LIST-DETAIL — summary table with click-to-edit detail (inline)
  // =====================================================================

  if (display === 'list-detail') {
    const columns = field.columns ?? [];

    // Detail view for selected row
    if (selectedIndex !== null && selectedIndex < rows.length) {
      const row = rows[selectedIndex];
      const summaryLabel = buildRowSummary(formValues, field.ref, selectedIndex, field.columns);

      return (
        <fieldset className={`usa-fieldset border-1px border-base padding-2 margin-bottom-2 ${ds.fieldset}`.trim()}>
          <legend className="usa-legend font-sans-md text-bold">{legend}</legend>
          <BreadcrumbBar>
            <Breadcrumb>
              <BreadcrumbLink
                href="#"
                onClick={(e: React.MouseEvent) => {
                  e.preventDefault();
                  setSelectedIndex(null);
                }}
              >
                {labelFromRef(field.ref)}
              </BreadcrumbLink>
            </Breadcrumb>
            <Breadcrumb current>{summaryLabel}</Breadcrumb>
          </BreadcrumbBar>

          <div className="grid-row grid-gap margin-top-2">
            {renderGroupedRow(selectedIndex, row.id)}
          </div>

          {canRemove && (
            <div className="margin-top-2">
              <Button
                className={`${ds.button} text-error font-sans-xs`.trim()}
                type="button"
                unstyled
                onClick={() => {
                  remove(selectedIndex);
                  setSelectedIndex(null);
                }}
              >
                Remove
              </Button>
            </div>
          )}
        </fieldset>
      );
    }

    // List view — summary table
    return (
      <fieldset className={`usa-fieldset border-1px border-base padding-2 margin-bottom-2 ${ds.fieldset}`.trim()}>
        <legend className="usa-legend font-sans-md text-bold">{legend}</legend>


        {rows.length > 0 && columns.length > 0 && (
          <Table bordered fullWidth>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.from} scope="col">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedIndex(index)}
                  style={{ cursor: 'pointer' }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedIndex(index);
                    }
                  }}
                >
                  {columns.map((col) => (
                    <td key={col.from}>
                      {String(get(formValues, `${field.ref}.${index}.${col.from}`) ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {canAdd && (
          <Button className={`${ds.button} margin-top-1`.trim()} type="button" outline onClick={handleAdd}>
            + Add
          </Button>
        )}
      </fieldset>
    );
  }

  // =====================================================================
  // LIST-DETAIL-PAGE — same as list-detail but detail fills the page area
  // =====================================================================

  if (display === 'list-detail-page') {
    const columns = field.columns ?? [];

    // Detail view — no fieldset wrapper, fills page area
    if (selectedIndex !== null && selectedIndex < rows.length) {
      const row = rows[selectedIndex];
      const summaryLabel = buildRowSummary(formValues, field.ref, selectedIndex, field.columns);

      return (
        <div>
          <h3 className="font-sans-md text-bold margin-bottom-1">{legend}</h3>
          <BreadcrumbBar>
            <Breadcrumb>
              <BreadcrumbLink
                href="#"
                onClick={(e: React.MouseEvent) => {
                  e.preventDefault();
                  setSelectedIndex(null);
                }}
              >
                {labelFromRef(field.ref)}
              </BreadcrumbLink>
            </Breadcrumb>
            <Breadcrumb current>{summaryLabel}</Breadcrumb>
          </BreadcrumbBar>

          <div className="grid-row grid-gap margin-top-2">
            {renderGroupedRow(selectedIndex, row.id)}
          </div>

          {canRemove && (
            <div className="margin-top-2">
              <Button
                className={`${ds.button} text-error font-sans-xs`.trim()}
                type="button"
                unstyled
                onClick={() => {
                  remove(selectedIndex);
                  setSelectedIndex(null);
                }}
              >
                Remove
              </Button>
            </div>
          )}
        </div>
      );
    }

    // List view — summary table (no fieldset wrapper)
    return (
      <div>
        <h3 className="font-sans-md text-bold margin-bottom-1">{legend}</h3>


        {rows.length > 0 && columns.length > 0 && (
          <Table bordered fullWidth>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.from} scope="col">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedIndex(index)}
                  style={{ cursor: 'pointer' }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedIndex(index);
                    }
                  }}
                >
                  {columns.map((col) => (
                    <td key={col.from}>
                      {String(get(formValues, `${field.ref}.${index}.${col.from}`) ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {canAdd && (
          <Button className={`${ds.button} margin-top-1`.trim()} type="button" outline onClick={handleAdd}>
            + Add
          </Button>
        )}
      </div>
    );
  }

  // Fallback — should not reach here
  return null;
}
