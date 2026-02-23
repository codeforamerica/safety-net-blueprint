export type ComponentType =
  | 'text-input'
  | 'date-input'
  | 'radio'
  | 'select'
  | 'checkbox-group'
  | 'field-array'
  | 'textarea';

export type FieldWidth = 'full' | 'half' | 'third' | 'two-thirds';

export type FieldArrayDisplay = 'inline' | 'accordion' | 'list-detail' | 'list-detail-page';

/** A named group of field refs within a field-array row (for accordion display). */
export interface FieldGroup {
  title: string;
  /** Refs of sub-fields that belong to this group (relative to the row). */
  fields: string[];
}

export type PermissionLevel = 'editable' | 'read-only' | 'masked' | 'hidden';

export type ViewMode = 'editable' | 'readonly';

export type Role = 'applicant' | 'caseworker' | 'reviewer' | 'admin';

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
  /** Whether this field is required. */
  required?: boolean;
  /** Sub-fields for field-array component. */
  fields?: FieldDefinition[];
  /** Minimum number of rows (field-array). */
  min_items?: number;
  /** Maximum number of rows (field-array). */
  max_items?: number;
  /** Display mode for field-array component. */
  display?: FieldArrayDisplay;
  /** Summary columns for list-detail field-array display. Reuses ReferenceColumn. */
  columns?: ReferenceColumn[];
  /** Named groups of sub-fields for accordion display (fieldset + legend per group). */
  groups?: FieldGroup[];
}

export interface Page {
  id: string;
  title: string;
  fields?: FieldDefinition[];
  /** For review layout: whether this section starts expanded (default: true). */
  expanded?: boolean;
  /** Per-page display override — if set, this page uses a different display than the form-level config. */
  display?: DisplayType;
  /** Data source for data-table pages. */
  source?: DataTableSource;
  /** Per-page column override for data-table pages. */
  columns?: ReferenceColumn[];
  /** Detail navigation config — clicking a row shows this form. */
  detail?: DetailConfig;
}

export type NavigationType = 'step-indicator' | 'side-nav' | 'in-page' | 'top-nav' | 'none';

export type DisplayType = 'paginated' | 'scrollable' | 'accordion' | 'split-panel' | 'data-table';

export interface LayoutConfig {
  navigation: NavigationType;
  display: DisplayType;
}

export type FormLayout = LayoutConfig;

export type DataTableSource = 'contract' | 'api';

export interface DetailConfig {
  /** ID of the form contract to render for the detail view. */
  form: string;
  /** API endpoint template, e.g. '/api/applications/{id}'. */
  fetch: string;
}

export interface AnnotationLayer {
  name: string;
  data: Record<string, unknown>;
}

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

export type ActionStyle = 'default' | 'secondary' | 'success' | 'warning' | 'outline';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Declares the REST resource this form operates on. */
export interface ResourceBinding {
  /** Base REST endpoint, e.g. '/persons'. */
  endpoint: string;
  /** URL parameter name for the record ID, e.g. 'personId'. */
  identity?: string;
}

/** Visibility condition for an action — role-based, field-based, or both. */
export interface ActionCondition {
  /** Roles that can see this action. */
  role?: Role[];
  /** Field-value conditions that must be met. */
  field?: Record<string, string | number | boolean>;
}

/** A declarative action button on a form. */
export interface ActionDefinition {
  /** Unique identifier for this action. */
  id: string;
  /** Button label. */
  label: string;
  /** HTTP method for the action. */
  method: HttpMethod;
  /** Override endpoint (defaults to resource.endpoint or resource.endpoint/{id}). */
  endpoint?: string;
  /** USWDS button style variant. */
  style?: ActionStyle;
  /** Path to navigate to after success. Supports {id} interpolation. */
  navigate?: string;
  /** Confirmation prompt — if set, user must confirm before the action executes. */
  confirm?: string;
  /** When to show this action. If omitted, always visible. */
  show_when?: ActionCondition;
}

export interface AnnotationEntry {
  label?: string;
  source?: string;
  statute?: string;
  notes?: string;
  programs?: Record<string, string>;
  [key: string]: unknown;
}

export interface AnnotationProgramsDisplay {
  page?: 'banner' | 'hidden';
  field?: 'exception-badge' | 'badge' | 'hidden';
}

export interface AnnotationDisplayConfig {
  label?: 'override' | 'hint' | 'tooltip' | 'hidden';
  source?: 'badge' | 'hint' | 'tooltip' | 'hidden';
  statute?: 'tooltip' | 'hint' | 'hidden';
  notes?: 'hint' | 'tooltip' | 'hidden';
  programs?: AnnotationProgramsDisplay;
}

export function resolveAnnotationDisplay(config?: AnnotationDisplayConfig): Required<AnnotationDisplayConfig> {
  return {
    label: config?.label ?? 'hidden',
    source: config?.source ?? 'hidden',
    statute: config?.statute ?? 'hidden',
    notes: config?.notes ?? 'hidden',
    programs: { page: config?.programs?.page ?? 'banner', field: config?.programs?.field ?? 'exception-badge' },
  };
}

export interface FormContract {
  form: {
    id: string;
    title: string;
    schema: string;
    layout: FormLayout;
    /** REST resource binding — where this form reads and writes data. */
    resource?: ResourceBinding;
    /** Declarative action buttons (submit, save, approve, etc.). */
    actions?: ActionDefinition[];
    storybook?: StoryBookMeta;
    annotations?: string[];
    /** How annotation properties are rendered on fields. */
    annotation_display?: AnnotationDisplayConfig;
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
