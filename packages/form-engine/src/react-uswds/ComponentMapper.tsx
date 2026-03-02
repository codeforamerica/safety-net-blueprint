import React from 'react';
import {
  TextInput,
  Textarea,
  DateInput,
  DateInputGroup,
  Radio,
  Select,
  Checkbox,
  Label,
  FormGroup,
  ErrorMessage,
  Fieldset,
  Tag,
} from '@trussworks/react-uswds';
import type { FieldDefinition, PermissionLevel, AnnotationEntry, ResolvedAnnotationDisplay } from '../core/types';
import type { UseFormRegister, FieldErrors } from 'react-hook-form';
import { labelFromRef } from '../core/field-utils';
import { deepEqual } from '../core/utils';
import { ds } from '../core/theme';

/** Resolve a dot-path from a nested object. */
function get(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

interface ComponentMapperProps {
  field: FieldDefinition;
  register: UseFormRegister<Record<string, unknown>>;
  errors: FieldErrors;
  permission: PermissionLevel;
  value?: unknown;
  annotations?: Record<string, string[]>;
  pagePrograms?: string[];
  /** Prefix for DOM element IDs to avoid collisions when multiple renderers share a page. */
  idPrefix?: string;
  /** Original values for diff highlighting. When provided, fields whose value differs get a visual indicator. */
  compareValues?: Record<string, unknown>;
  /** Full annotation entries keyed by field ref. */
  annotationEntries?: Record<string, AnnotationEntry>;
  /** Resolved annotation display config (slot-based). */
  annotationDisplay?: ResolvedAnnotationDisplay;
  /** Label source: 'annotations' uses annotationEntries label, 'default' uses labelFromRef(). */
  labelsSource?: 'annotations' | 'default';
}

/** Get nested error message from FieldErrors. */
function getError(errors: FieldErrors, ref: string): string | undefined {
  const parts = ref.split('.');
  let current: unknown = errors;
  for (const part of parts) {
    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  if (current && typeof current === 'object' && 'message' in current) {
    return (current as { message?: string }).message;
  }
  return undefined;
}

/** Mask a value for display (e.g., SSN → ***-**-1234). */
function maskValue(value: unknown): string {
  const str = String(value ?? '');
  if (str.length <= 4) return '****';
  return str.slice(0, -4).replace(/./g, '*') + str.slice(-4);
}

// Schema-derived options for enum fields.
// Keys are the last segment of the field ref (matches qualified refs via fallback).
const ENUM_OPTIONS: Record<string, { value: string; label: string }[]> = {
  programsAppliedFor: [
    { value: 'SNAP', label: 'SNAP (Food Assistance)' },
    { value: 'Medicaid_MAGI', label: 'Medicaid (MAGI)' },
    { value: 'Medicaid_NonMAGI', label: 'Medicaid (Non-MAGI)' },
    { value: 'TANF', label: 'TANF (Cash Assistance)' },
    { value: 'SSI', label: 'SSI (Supplemental Security Income)' },
    { value: 'WIC', label: 'WIC (Women, Infants, Children)' },
    { value: 'CHIP', label: "CHIP (Children's Health Insurance)" },
    { value: 'Section_8_Housing', label: 'Section 8 Housing' },
    { value: 'LIHEAP', label: 'LIHEAP (Energy Assistance)' },
    { value: 'Summer_EBT', label: 'Summer EBT' },
  ],
  gender: [
    { value: 'male', label: 'Male' },
    { value: 'female', label: 'Female' },
    { value: 'unknown', label: 'Unknown' },
  ],
  race: [
    { value: 'american_indian_alaskan_native', label: 'American Indian or Alaska Native' },
    { value: 'asian', label: 'Asian' },
    { value: 'black_african_american', label: 'Black or African American' },
    { value: 'native_hawaiian_pacific_islander', label: 'Native Hawaiian or Pacific Islander' },
    { value: 'white', label: 'White' },
  ],
  maritalStatus: [
    { value: 'single', label: 'Single' },
    { value: 'married', label: 'Married' },
    { value: 'divorced', label: 'Divorced' },
    { value: 'separated', label: 'Separated' },
    { value: 'widowed', label: 'Widowed' },
    { value: 'civil_union', label: 'Civil Union' },
    { value: 'domestic_partnership', label: 'Domestic Partnership' },
  ],
  citizenshipStatus: [
    { value: 'citizen', label: 'U.S. Citizen' },
    { value: 'permanent_resident', label: 'Permanent Resident' },
    { value: 'qualified_non_citizen', label: 'Qualified Non-Citizen' },
    { value: 'undocumented', label: 'Undocumented' },
    { value: 'other', label: 'Other' },
  ],
  relationshipToApplicant: [
    { value: 'self', label: 'Self' },
    { value: 'spouse', label: 'Spouse' },
    { value: 'child', label: 'Child' },
    { value: 'parent', label: 'Parent' },
    { value: 'sibling', label: 'Sibling' },
    { value: 'other', label: 'Other' },
  ],
  livingArrangement: [
    { value: 'own', label: 'Own' },
    { value: 'rent', label: 'Rent' },
    { value: 'homeless', label: 'Homeless' },
    { value: 'living_with_others', label: 'Living with Others' },
    { value: 'other', label: 'Other' },
  ],
  noticeDeliveryPreference: [
    { value: 'mail', label: 'Mail' },
    { value: 'email', label: 'Email' },
    { value: 'both', label: 'Both' },
  ],
};

/** Strip numeric indices from a qualified ref (e.g. household.members.0.ssn → household.members.ssn). */
function stripIndices(ref: string): string {
  return ref.replace(/\.\d+/g, '');
}

/** Source badge color map. */
const SOURCE_COLORS: Record<string, string> = {
  system: 'bg-info-lighter text-primary-dark',
  federal: 'bg-primary-lighter text-primary-dark',
  state: 'bg-success-lighter text-success-dark',
  manual: 'bg-warning-lighter text-warning-dark',
};

/** Parse a slot item like "programs:exceptions" into { property, modifier }. */
function parseSlotItem(item: string): { property: string; modifier?: string } {
  const colonIdx = item.indexOf(':');
  if (colonIdx === -1) return { property: item };
  return { property: item.slice(0, colonIdx), modifier: item.slice(colonIdx + 1) };
}

/**
 * Render a badge for a string-valued annotation property.
 * Uses SOURCE_COLORS for known "source" values, otherwise a neutral style.
 */
function renderStringBadge(key: string, value: string, property: string): React.ReactNode {
  const colorClass = property === 'source'
    ? (SOURCE_COLORS[value.toLowerCase()] ?? 'bg-base-lighter text-base-dark')
    : 'bg-base-lighter text-base-dark';
  return (
    <Tag
      key={key}
      className={`font-sans-3xs ${colorClass}`}
      style={{ fontSize: '10px', padding: '1px 6px', lineHeight: '1.4', marginLeft: '6px', verticalAlign: 'middle' }}
    >
      {value}
    </Tag>
  );
}

/**
 * Compute annotation decorations for a field based on the slot-based display config.
 * Returns inline badges, hint lines, tooltip text, and alert lines.
 */
function renderAnnotationDecorations(
  entry: AnnotationEntry | undefined,
  displayConfig: ResolvedAnnotationDisplay | undefined,
  fieldPrograms: string[] | undefined,
  pagePrograms: string[] | undefined,
): {
  inlineBadges: React.ReactNode[];
  hintLines: string[];
  tooltipText: string;
  alertLines: string[];
} {
  const result = {
    inlineBadges: [] as React.ReactNode[],
    hintLines: [] as string[],
    tooltipText: '',
    alertLines: [] as string[],
  };

  if (!displayConfig) return result;

  const tooltipParts: string[] = [];

  // --- Badge slot ---
  for (const item of displayConfig.field.badge) {
    const { property, modifier } = parseSlotItem(item);
    if (property === 'programs') {
      // Program badges with optional :exceptions modifier
      if (fieldPrograms?.length && pagePrograms?.length) {
        if (modifier === 'exceptions') {
          const fieldSet = new Set(fieldPrograms);
          const pageSet = new Set(pagePrograms);
          const missing = pagePrograms.filter((p) => !fieldSet.has(p));
          const extra = fieldPrograms.filter((p) => !pageSet.has(p));
          const isSame = missing.length === 0 && extra.length === 0;
          if (!isSame) {
            const useOnly = fieldPrograms.length <= pagePrograms.length / 2;
            const badgeLabel = useOnly
              ? `Only: ${fieldPrograms.map((p) => p.replace(/_/g, ' ')).join(', ')}`
              : `Not: ${missing.map((p) => p.replace(/_/g, ' ')).join(', ')}`;
            result.inlineBadges.push(
              <span key="programs-exception" style={{ marginLeft: '6px', verticalAlign: 'middle' }}>
                <Tag
                  className={`font-sans-3xs ${useOnly ? 'bg-info-lighter text-primary-dark' : 'bg-error-lighter text-error-dark'}`}
                  style={{ fontSize: '10px', padding: '1px 6px', lineHeight: '1.4' }}
                >
                  {badgeLabel}
                </Tag>
              </span>
            );
          }
        } else {
          // Show all programs as badges
          result.inlineBadges.push(
            <span key="programs-all" style={{ marginLeft: '6px', verticalAlign: 'middle' }}>
              {fieldPrograms.map((p) => (
                <Tag
                  key={p}
                  className="font-sans-3xs bg-info-lighter text-primary-dark"
                  style={{ fontSize: '10px', padding: '1px 6px', lineHeight: '1.4', marginRight: '2px' }}
                >
                  {p.replace(/_/g, ' ')}
                </Tag>
              ))}
            </span>
          );
        }
      }
    } else if (entry) {
      const val = entry[property];
      if (typeof val === 'string' && val) {
        result.inlineBadges.push(renderStringBadge(`badge-${property}`, val, property));
      }
    }
  }

  // --- Tooltip slot ---
  for (const item of displayConfig.field.tooltip) {
    const { property } = parseSlotItem(item);
    if (entry) {
      const val = entry[property];
      if (typeof val === 'string' && val) {
        tooltipParts.push(`${property.charAt(0).toUpperCase() + property.slice(1)}: ${val}`);
      }
    }
  }

  // --- Hint slot ---
  for (const item of displayConfig.field.hint) {
    const { property } = parseSlotItem(item);
    if (entry) {
      const val = entry[property];
      if (typeof val === 'string' && val) {
        result.hintLines.push(property === 'notes' ? val : `${property.charAt(0).toUpperCase() + property.slice(1)}: ${val}`);
      }
    }
  }

  // --- Alert slot ---
  for (const item of displayConfig.field.alert) {
    const { property } = parseSlotItem(item);
    if (entry) {
      const val = entry[property];
      if (typeof val === 'string' && val) {
        result.alertLines.push(property === 'notes' ? val : `${property.charAt(0).toUpperCase() + property.slice(1)}: ${val}`);
      }
    }
  }

  result.tooltipText = tooltipParts.join('\n');
  return result;
}

export function ComponentMapper({
  field,
  register,
  errors,
  permission,
  value,
  annotations,
  pagePrograms,
  idPrefix = '',
  compareValues,
  annotationEntries,
  annotationDisplay,
  labelsSource,
}: ComponentMapperProps) {
  if (permission === 'hidden') return null;

  const errorMsg = getError(errors, field.ref);
  const isDisabled = permission === 'read-only' || permission === 'masked';

  // Look up annotation entry for this field
  const annotationEntry = annotationEntries?.[field.ref] ?? annotationEntries?.[stripIndices(field.ref)];

  // Resolve label: annotations source overrides with entry.label when available
  const effectiveLabel = labelsSource === 'annotations' && annotationEntry?.label
    ? annotationEntry.label
    : labelFromRef(field.ref);

  // Compute slot-based decorations
  const fieldPrograms = annotations?.[field.ref] ?? annotations?.[stripIndices(field.ref)];
  const decorations = renderAnnotationDecorations(annotationEntry, annotationDisplay, fieldPrograms, pagePrograms);

  const requiredMark = field.required && !isDisabled ? (
    <abbr title="required" className="usa-hint usa-hint--required">*</abbr>
  ) : null;

  // Tooltip icon for combined tooltip text
  const tooltipIcon = decorations.tooltipText ? (
    <span
      title={decorations.tooltipText}
      style={{ marginLeft: '4px', cursor: 'help', verticalAlign: 'middle', fontSize: '13px' }}
      aria-label={decorations.tooltipText}
    >
      &#9432;
    </span>
  ) : null;

  const label = <>{effectiveLabel}{requiredMark}{tooltipIcon}</>;
  const inputId = idPrefix + field.ref.replace(/\./g, '-');

  // Diff highlighting: compare current value against original
  const originalValue = compareValues ? get(compareValues, field.ref) : undefined;
  const isChanged = compareValues !== undefined && !deepEqual(value, originalValue);

  const modifiedBadge = isChanged ? (
    <span style={{ marginLeft: '6px', verticalAlign: 'middle' }}>
      <Tag
        className="font-sans-3xs bg-primary text-white"
        style={{ fontSize: '10px', padding: '1px 6px', lineHeight: '1.4' }}
      >
        Modified
      </Tag>
    </span>
  ) : null;

  const changedClass = isChanged
    ? 'border-left-05 border-primary padding-left-1 bg-primary-lighter'
    : '';

  // Inline badges from slot-based decorations (source badges + program badges)
  const badges = decorations.inlineBadges.length > 0 ? <>{decorations.inlineBadges}</> : null;

  // Annotation hint lines (rendered between label and input, before field.hint)
  const annotationHints = decorations.hintLines.length > 0 ? (
    <>
      {decorations.hintLines.map((line, i) => (
        <span key={i} className="usa-hint display-block">{line}</span>
      ))}
    </>
  ) : null;

  // Alert node for alert-slot items (rendered below the form group)
  const alertNode = decorations.alertLines.length > 0 ? (
    <div className="usa-alert usa-alert--info usa-alert--slim margin-top-1" role="alert">
      <div className="usa-alert__body">
        {decorations.alertLines.map((line, i) => (
          <p key={i} className="usa-alert__text">{line}</p>
        ))}
      </div>
    </div>
  ) : null;

  if (permission === 'masked') {
    return (
      <div className={changedClass}>
        <FormGroup className={ds.formGroup} error={!!errorMsg}>
          <Label className={ds.label} htmlFor={inputId}>{label}{badges}{modifiedBadge}</Label>
          {annotationHints}
            {field.hint && <span className="usa-hint">{field.hint}</span>}
          <TextInput
            className={ds.input}
            id={inputId}
            name={field.ref}
            type="text"
            value={maskValue(value)}
            disabled
            inputRef={() => {}}
          />
        </FormGroup>
        {alertNode}
      </div>
    );
  }

  switch (field.component) {
    case 'text-input': {
      return (
        <div className={changedClass}>
          <FormGroup className={ds.formGroup} error={!!errorMsg}>
            <Label className={ds.label} htmlFor={inputId}>{label}{badges}{modifiedBadge}</Label>
            {annotationHints}
            {field.hint && <span className="usa-hint">{field.hint}</span>}
            {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
            <TextInput
              className={ds.input}
              id={inputId}
              type="text"
              disabled={isDisabled}
              {...register(field.ref)}
              inputRef={register(field.ref).ref}
            />
          </FormGroup>
          {alertNode}
        </div>
      );
    }

    case 'date-input': {
      const monthId = `${inputId}-month`;
      const dayId = `${inputId}-day`;
      const yearId = `${inputId}-year`;
      return (
        <div className={changedClass}>
          <FormGroup className={ds.formGroup} error={!!errorMsg}>
            <Fieldset className={ds.fieldset} legend={<>{label}{badges}{modifiedBadge}</>}>
              {annotationHints}
            {field.hint && <span className="usa-hint">{field.hint}</span>}
              {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
              <DateInputGroup>
                <DateInput
                  id={monthId}
                  name={`${field.ref}_month`}
                  label="Month"
                  unit="month"
                  maxLength={2}
                  disabled={isDisabled}
                />
                <DateInput
                  id={dayId}
                  name={`${field.ref}_day`}
                  label="Day"
                  unit="day"
                  maxLength={2}
                  disabled={isDisabled}
                />
                <DateInput
                  id={yearId}
                  name={`${field.ref}_year`}
                  label="Year"
                  unit="year"
                  maxLength={4}
                  disabled={isDisabled}
                />
              </DateInputGroup>
            </Fieldset>
          </FormGroup>
          {alertNode}
        </div>
      );
    }

    case 'radio': {
      const options = field.labels
        ? Object.entries(field.labels).map(([val, lbl]) => ({
            value: val,
            label: lbl,
          }))
        : ENUM_OPTIONS[field.ref] ?? ENUM_OPTIONS[field.ref.split('.').pop() ?? ''] ?? [];

      return (
        <div className={changedClass}>
          <FormGroup className={ds.formGroup} error={!!errorMsg}>
            <Fieldset className={ds.fieldset} legend={<>{label}{badges}{modifiedBadge}</>}>
              {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
              {options.map((opt) => (
                <Radio
                  className={ds.radio}
                  key={opt.value}
                  id={`${inputId}-${opt.value}`}
                  label={opt.label}
                  value={opt.value}
                  disabled={isDisabled}
                  {...register(field.ref)}
                  inputRef={register(field.ref).ref}
                />
              ))}
            </Fieldset>
          </FormGroup>
          {alertNode}
        </div>
      );
    }

    case 'select': {
      const options = field.labels
        ? Object.entries(field.labels).map(([val, lbl]) => ({
            value: val,
            label: lbl,
          }))
        : ENUM_OPTIONS[field.ref] ?? ENUM_OPTIONS[field.ref.split('.').pop() ?? ''] ?? [];
      return (
        <div className={changedClass}>
          <FormGroup className={ds.formGroup} error={!!errorMsg}>
            <Label className={ds.label} htmlFor={inputId}>{label}{badges}{modifiedBadge}</Label>
            {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
            <Select
              className={ds.select}
              id={inputId}
              disabled={isDisabled}
              {...register(field.ref)}
              inputRef={register(field.ref).ref}
            >
              <option value="">- Select -</option>
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </FormGroup>
          {alertNode}
        </div>
      );
    }

    case 'checkbox-group': {
      const options = field.labels
        ? Object.entries(field.labels).map(([val, lbl]) => ({
            value: val,
            label: lbl,
          }))
        : ENUM_OPTIONS[field.ref] ?? ENUM_OPTIONS[field.ref.split('.').pop() ?? ''] ?? [];
      return (
        <div className={changedClass}>
          <FormGroup className={ds.formGroup} error={!!errorMsg}>
            <Fieldset className={ds.fieldset} legend={<>{label}{badges}{modifiedBadge}</>}>
              {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
              {options.map((opt) => (
                <Checkbox
                  className={ds.checkbox}
                  key={opt.value}
                  id={`${inputId}-${opt.value}`}
                  label={opt.label}
                  value={opt.value}
                  disabled={isDisabled}
                  {...register(field.ref)}
                  inputRef={register(field.ref).ref}
                />
              ))}
            </Fieldset>
          </FormGroup>
          {alertNode}
        </div>
      );
    }

    case 'textarea': {
      return (
        <div className={changedClass}>
          <FormGroup className={ds.formGroup} error={!!errorMsg}>
            <Label className={ds.label} htmlFor={inputId}>{label}{badges}{modifiedBadge}</Label>
            {annotationHints}
            {field.hint && <span className="usa-hint">{field.hint}</span>}
            {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
            <Textarea
              className={ds.input}
              id={inputId}
              disabled={isDisabled}
              {...register(field.ref)}
              inputRef={register(field.ref).ref}
            />
          </FormGroup>
          {alertNode}
        </div>
      );
    }

    default:
      return null;
  }
}
