export type ComponentType =
  | 'text-input'
  | 'date-input'
  | 'radio'
  | 'select'
  | 'checkbox-group';

export type FieldWidth = 'full' | 'half' | 'third' | 'two-thirds';

export type PermissionLevel = 'editable' | 'read-only' | 'masked' | 'hidden';

export type Role = 'applicant' | 'caseworker' | 'reviewer';

/** Simple single-field condition. */
export interface SimpleCondition {
  field: string;
  equals?: string | number | boolean;
  not_equals?: string | number | boolean;
}

/**
 * JSON Logic condition for compound rules.
 * See https://jsonlogic.com for the full spec.
 */
export interface JsonLogicCondition {
  jsonlogic: Record<string, unknown>;
}

export type ShowWhen = SimpleCondition | JsonLogicCondition;

export interface FieldDefinition {
  ref: string;
  component: ComponentType;
  width?: FieldWidth;
  hint?: string;
  labels?: Record<string, string>;
  permissions?: Partial<Record<Role, PermissionLevel>>;
  show_when?: ShowWhen;
}

export interface Page {
  id: string;
  title: string;
  fields: FieldDefinition[];
}

export type FormLayout = 'wizard' | 'review';

export interface FormContract {
  form: {
    id: string;
    title: string;
    schema: string;
    layout?: FormLayout;
    pages: Page[];
  };
}
