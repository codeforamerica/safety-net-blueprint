import React from 'react';
import {
  TextInput,
  DateInput,
  DateInputGroup,
  Radio,
  Select,
  Checkbox,
  Label,
  FormGroup,
  ErrorMessage,
  Fieldset,
} from '@trussworks/react-uswds';
import type { FieldDefinition, PermissionLevel } from './types';
import type { UseFormRegister, FieldErrors } from 'react-hook-form';

interface ComponentMapperProps {
  field: FieldDefinition;
  register: UseFormRegister<Record<string, unknown>>;
  errors: FieldErrors;
  permission: PermissionLevel;
  value?: unknown;
}

/** Derive a human-readable label from a dotted field ref. */
function labelFromRef(ref: string): string {
  const last = ref.split('.').pop() ?? ref;
  // camelCase → Title Case
  return last
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
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

export function ComponentMapper({
  field,
  register,
  errors,
  permission,
  value,
}: ComponentMapperProps) {
  if (permission === 'hidden') return null;

  const label = labelFromRef(field.ref);
  const errorMsg = getError(errors, field.ref);
  const isDisabled = permission === 'read-only' || permission === 'masked';
  const inputId = field.ref.replace(/\./g, '-');

  if (permission === 'masked') {
    return (
      <FormGroup error={!!errorMsg}>
        <Label htmlFor={inputId}>{label}</Label>
        {field.hint && <span className="usa-hint">{field.hint}</span>}
        <TextInput
          id={inputId}
          name={field.ref}
          type="text"
          value={maskValue(value)}
          disabled
          inputRef={() => {}}
        />
      </FormGroup>
    );
  }

  switch (field.component) {
    case 'text-input': {
      return (
        <FormGroup error={!!errorMsg}>
          <Label htmlFor={inputId}>{label}</Label>
          {field.hint && <span className="usa-hint">{field.hint}</span>}
          {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
          <TextInput
            id={inputId}
            type="text"
            disabled={isDisabled}
            {...register(field.ref)}
            inputRef={register(field.ref).ref}
          />
        </FormGroup>
      );
    }

    case 'date-input': {
      const monthId = `${inputId}-month`;
      const dayId = `${inputId}-day`;
      const yearId = `${inputId}-year`;
      return (
        <FormGroup error={!!errorMsg}>
          <Fieldset legend={label}>
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
        <FormGroup error={!!errorMsg}>
          <Fieldset legend={label}>
            {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
            {options.map((opt) => (
              <Radio
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
        <FormGroup error={!!errorMsg}>
          <Label htmlFor={inputId}>{label}</Label>
          {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
          <Select
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
        <FormGroup error={!!errorMsg}>
          <Fieldset legend={label}>
            {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
            {options.map((opt) => (
              <Checkbox
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
      );
    }

    default:
      return null;
  }
}
