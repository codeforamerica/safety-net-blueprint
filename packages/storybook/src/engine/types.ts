export type ComponentType =
  | 'text-input'
  | 'date-input'
  | 'radio'
  | 'select'
  | 'checkbox-group'
  | 'field-array';

export type FieldWidth = 'full' | 'half' | 'third' | 'two-thirds';

export type PermissionLevel = 'editable' | 'read-only' | 'masked' | 'hidden';

export type ViewMode = 'editable' | 'readonly';

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
  /** Sub-fields for field-array component. */
  fields?: FieldDefinition[];
  /** Minimum number of rows (field-array). */
  min_items?: number;
  /** Maximum number of rows (field-array). */
  max_items?: number;
}

export interface Page {
  id: string;
  title: string;
  fields: FieldDefinition[];
  /** For review layout: whether this section starts expanded (default: true). */
  expanded?: boolean;
}

export type FormLayout = 'wizard' | 'review' | 'reference' | 'split-panel';

export interface ReferenceColumn {
  from: string;
  label: string;
}

export interface PanelConfig {
  label: string;
  mode: ViewMode;
}

export interface StoryBookMeta {
  role: Role;
  permissions: string;
}

export interface FormContract {
  form: {
    id: string;
    title: string;
    schema: string;
    scope?: string;
    layout?: FormLayout;
    storybook?: StoryBookMeta;
    annotations?: string[];
    columns?: ReferenceColumn[];
    panels?: { left: PanelConfig; right: PanelConfig };
    pages: Page[];
  };
}

export interface PermissionsPolicy {
  role: Role;
  defaults: PermissionLevel;
  fields?: Record<string, PermissionLevel>;
}
