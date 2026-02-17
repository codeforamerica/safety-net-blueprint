import React from 'react';
import { useFieldArray, type Control, type UseFormRegister, type FieldErrors } from 'react-hook-form';
import { Button } from '@trussworks/react-uswds';
import type { FieldDefinition, Role, PermissionsPolicy, ShowWhen, SimpleCondition, ViewMode } from './types';
import { ComponentMapper } from './ComponentMapper';
import { resolveCondition } from './ConditionResolver';
import { resolvePermission } from './PermissionsResolver';

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
}: FieldArrayRendererProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic path from contract
  const { fields: rows, append, remove } = useFieldArray({
    control: control as any,
    name: field.ref as any,
  });

  const basePermission = resolvePermission(field, role, permissionsPolicy);
  const isViewReadonly = viewMode === 'readonly';
  const isReadOnly = isViewReadonly || basePermission === 'read-only';
  const canAdd = !isReadOnly && (field.max_items == null || rows.length < field.max_items);
  const canRemove = !isReadOnly && (field.min_items == null || rows.length > field.min_items);
  const templateFields = field.fields ?? [];

  const handleAdd = () => {
    // Build an empty row from the template fields
    const emptyRow: Record<string, string> = {};
    for (const sub of templateFields) {
      emptyRow[sub.ref] = '';
    }
    append(emptyRow);
  };

  return (
    <fieldset className="usa-fieldset" style={{ border: '1px solid #dfe1e2', padding: '1rem', marginBottom: '1rem' }}>
      {field.hint && <span className="usa-hint" style={{ display: 'block', marginBottom: '0.5rem' }}>{field.hint}</span>}

      {rows.map((row, index) => {
        const rowPrefix = `${field.ref}.${index}`;

        return (
          <div key={row.id} className="grid-row grid-gap" style={{ borderBottom: '1px solid #e6e6e6', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
            {templateFields.map((subField) => {
              const qualifiedRef = `${rowPrefix}.${subField.ref}`;
              const qualifiedField: FieldDefinition = {
                ...subField,
                ref: qualifiedRef,
                show_when: undefined, // handled below
              };

              // Resolve show_when with qualified paths
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
                  />
                </div>
              );
            })}

            {canRemove && (
              <div className="grid-col-12" style={{ marginTop: '0.25rem' }}>
                <Button
                  type="button"
                  unstyled
                  onClick={() => remove(index)}
                  style={{ color: '#d83933', fontSize: '0.875rem' }}
                >
                  Remove
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {canAdd && (
        <Button type="button" outline onClick={handleAdd} style={{ marginTop: '0.5rem' }}>
          + Add
        </Button>
      )}
    </fieldset>
  );
}
