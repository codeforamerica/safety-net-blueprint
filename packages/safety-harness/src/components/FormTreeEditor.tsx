import { useState } from 'react';
import { TextInput, Select, Tag, Label } from '@trussworks/react-uswds';
import formContractSchema from '@contracts/form-contract.schema.json';
import { SCHEMA_NAMES, generatePagesForSchema } from '../lib/schema-registry';

// --- Enums from schema ---------------------------------------------------

const NAVIGATION_TYPES = (formContractSchema.$defs.NavigationType as { enum: string[] }).enum;
const DISPLAY_TYPES = (formContractSchema.$defs.DisplayType as { enum: string[] }).enum;
const ROLES = (formContractSchema.$defs.Role as { enum: string[] }).enum;
const FIELD_WIDTHS = (formContractSchema.$defs.FieldWidth as { enum: string[] }).enum;

// --- Types ----------------------------------------------------------------

export interface FormTreeEditorProps {
  definition: Record<string, unknown>;
  editing: boolean;
  onChange: (definition: Record<string, unknown>) => void;
}

type Selection =
  | { type: 'page'; pageIndex: number }
  | { type: 'field'; pageIndex: number; fieldPath: number[] }
  | null;

interface FieldDef {
  ref?: string;
  component?: string;
  width?: string;
  hint?: string;
  labels?: Record<string, string>;
  permissions?: Record<string, string>;
  show_when?: Record<string, unknown>;
  fields?: FieldDef[];
  min_items?: number;
  max_items?: number;
  [key: string]: unknown;
}

interface PageDef {
  id?: string;
  title?: string;
  fields?: FieldDef[];
  [key: string]: unknown;
}

// --- Helpers --------------------------------------------------------------

function getForm(def: Record<string, unknown>): Record<string, unknown> {
  return (def.form ?? {}) as Record<string, unknown>;
}

function getPages(def: Record<string, unknown>): PageDef[] {
  const form = getForm(def);
  return (form.pages ?? []) as PageDef[];
}

function resolveField(pages: PageDef[], pageIndex: number, fieldPath: number[]): FieldDef | undefined {
  const page = pages[pageIndex];
  if (!page?.fields) return undefined;
  let fields = page.fields;
  let field: FieldDef | undefined;
  for (const idx of fieldPath) {
    field = fields[idx];
    if (!field) return undefined;
    fields = field.fields ?? [];
  }
  return field;
}

function updateFieldAtPath(
  def: Record<string, unknown>,
  pageIndex: number,
  fieldPath: number[],
  updater: (f: FieldDef) => FieldDef,
): Record<string, unknown> {
  const form = { ...getForm(def) };
  const pages = [...getPages(def)];
  const page = { ...pages[pageIndex], fields: [...(pages[pageIndex].fields ?? [])] };

  function updateNested(fields: FieldDef[], path: number[]): FieldDef[] {
    const result = [...fields];
    const [head, ...rest] = path;
    if (rest.length === 0) {
      result[head] = updater({ ...result[head] });
    } else {
      result[head] = { ...result[head], fields: updateNested([...(result[head].fields ?? [])], rest) };
    }
    return result;
  }

  page.fields = updateNested(page.fields!, fieldPath);
  pages[pageIndex] = page;
  form.pages = pages;
  return { ...def, form };
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const result = [...arr];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

function removeItem<T>(arr: T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

function updateForm(def: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  return { ...def, form: { ...getForm(def), ...updates } };
}

function updateLayout(def: Record<string, unknown>, key: string, value: string): Record<string, unknown> {
  const form = getForm(def);
  const layout = { ...(form.layout as Record<string, unknown> ?? {}) };
  layout[key] = value;
  return updateForm(def, { layout });
}

function updatePage(def: Record<string, unknown>, pageIndex: number, updates: Record<string, unknown>): Record<string, unknown> {
  const pages = [...getPages(def)];
  pages[pageIndex] = { ...pages[pageIndex], ...updates };
  return updateForm(def, { pages });
}

function updatePageFields(def: Record<string, unknown>, pageIndex: number, fields: FieldDef[]): Record<string, unknown> {
  return updatePage(def, pageIndex, { fields });
}

function selectionEquals(a: Selection, b: Selection): boolean {
  if (a === null || b === null) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === 'page' && b.type === 'page') return a.pageIndex === b.pageIndex;
  if (a.type === 'field' && b.type === 'field') {
    return a.pageIndex === b.pageIndex && a.fieldPath.length === b.fieldPath.length && a.fieldPath.every((v, i) => v === b.fieldPath[i]);
  }
  return false;
}

// --- Styles ---------------------------------------------------------------

const expandedStyle: React.CSSProperties = {
  backgroundColor: '#f0f0f0',
  borderLeft: '3px solid #005ea2',
  padding: '0.5rem 0.5rem 0.5rem 0.75rem',
  margin: '0.125rem 0',
  borderRadius: '0 4px 4px 0',
  fontSize: '0.8125rem',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.25rem 0.5rem',
  cursor: 'pointer',
  fontSize: '0.875rem',
};

const monoStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.8125rem',
};

const propRow: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'baseline',
  lineHeight: '1.6',
};

// --- Sub-components -------------------------------------------------------

/** Read-only key-value line */
function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={propRow}>
      <span className="text-base-dark" style={{ minWidth: '5rem', flexShrink: 0 }}>{label}:</span>
      <span>{children}</span>
    </div>
  );
}

/** Inline field properties — only width, hint, and label display text are editable */
function InlineFieldProps({
  field,
  editing,
  onUpdate,
}: {
  field: FieldDef;
  editing: boolean;
  onUpdate: (updates: Partial<FieldDef>) => void;
}) {
  const isFieldArray = field.component === 'field-array';
  const labels = field.labels ?? {};
  const permissions = field.permissions ?? {};
  const showWhen = field.show_when as Record<string, unknown> | undefined;
  const hasLabels = Object.keys(labels).length > 0;
  const hasPermissions = Object.keys(permissions).length > 0;

  return (
    <div style={{ ...expandedStyle, display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
      {/* Always read-only */}
      <Prop label="ref"><code style={monoStyle}>{field.ref ?? '—'}</code></Prop>
      <Prop label="component">{field.component ?? '—'}</Prop>

      {/* width — editable */}
      {editing ? (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className="text-base-dark" style={{ minWidth: '5rem', flexShrink: 0 }}>width:</span>
          <Select
            id={`f-width-${field.ref}`}
            name="width"
            value={field.width ?? 'full'}
            onChange={(e) => onUpdate({ width: e.target.value === 'full' ? undefined : e.target.value })}
            className="height-4 maxw-card"
          >
            {FIELD_WIDTHS.map((w) => <option key={w} value={w}>{w}</option>)}
          </Select>
        </div>
      ) : (
        field.width && field.width !== 'full' && <Prop label="width">{field.width}</Prop>
      )}

      {/* hint — editable */}
      {editing ? (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className="text-base-dark" style={{ minWidth: '5rem', flexShrink: 0 }}>hint:</span>
          <TextInput
            id={`f-hint-${field.ref}`}
            name="hint"
            type="text"
            value={field.hint ?? ''}
            onChange={(e) => onUpdate({ hint: e.target.value || undefined })}
            className="height-4"
            style={{ flex: 1 }}
          />
        </div>
      ) : (
        field.hint && <Prop label="hint">{field.hint}</Prop>
      )}

      {/* labels — keys read-only, display text editable */}
      {hasLabels && (
        <div>
          <span className="text-base-dark">labels:</span>
          <div style={{ paddingLeft: '1rem', marginTop: '0.125rem' }}>
            {Object.entries(labels).map(([key, val]) => (
              <div key={key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.125rem' }}>
                <code style={{ ...monoStyle, minWidth: '8rem', flexShrink: 0, color: '#555' }}>{key}</code>
                {editing ? (
                  <input
                    className="usa-input height-4 font-sans-3xs"
                    value={val}
                    onChange={(e) => onUpdate({ labels: { ...labels, [key]: e.target.value } })}
                    style={{ flex: 1 }}
                  />
                ) : (
                  <span>{val}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Everything below is read-only display */}
      {hasPermissions && (
        <Prop label="permissions">
          {Object.entries(permissions).map(([k, v]) => `${k}: ${v}`).join(', ')}
        </Prop>
      )}
      {showWhen && (
        <Prop label="show_when">
          <code style={{ fontSize: '0.75rem' }}>{JSON.stringify(showWhen)}</code>
        </Prop>
      )}
      {isFieldArray && field.min_items != null && <Prop label="min_items">{field.min_items}</Prop>}
      {isFieldArray && field.max_items != null && <Prop label="max_items">{field.max_items}</Prop>}
    </div>
  );
}

function FieldRow({
  field,
  pageIndex,
  fieldPath,
  editing,
  selected,
  onSelect,
  onUpdate,
  onMove,
  onRemove,
  depth,
}: {
  field: FieldDef;
  pageIndex: number;
  fieldPath: number[];
  editing: boolean;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<FieldDef>) => void;
  onMove?: (dir: -1 | 1) => void;
  onRemove?: () => void;
  depth: number;
}) {
  const isFieldArray = field.component === 'field-array';
  const subFields = field.fields ?? [];

  return (
    <>
      <div
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        style={{
          ...rowStyle,
          paddingLeft: `${0.5 + depth * 1.25}rem`,
          ...(selected ? { backgroundColor: '#e8e8e8', fontWeight: 600 } : {}),
        }}
      >
        {depth > 0 && <span style={{ color: '#aaa', userSelect: 'none' }}>└</span>}
        <code style={monoStyle}>{field.ref ?? '(no ref)'}</code>
        <Tag className="bg-base-lighter text-base-dark font-sans-3xs">{field.component ?? '?'}</Tag>
        {field.width && field.width !== 'full' && (
          <span style={{ fontSize: '0.75rem', color: '#888' }}>{field.width}</span>
        )}
        {editing && (onMove || onRemove) && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.125rem' }}>
            {onMove && <button type="button" onClick={(e) => { e.stopPropagation(); onMove(-1); }} className="usa-button usa-button--unstyled font-sans-3xs" title="Move up">&uarr;</button>}
            {onMove && <button type="button" onClick={(e) => { e.stopPropagation(); onMove(1); }} className="usa-button usa-button--unstyled font-sans-3xs" title="Move down">&darr;</button>}
            {onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="usa-button usa-button--unstyled font-sans-3xs text-secondary" title="Remove field">&times;</button>}
          </span>
        )}
      </div>
      {selected && (
        <div style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}>
          <InlineFieldProps field={field} editing={editing} onUpdate={onUpdate} />
        </div>
      )}
      {isFieldArray && subFields.map((sf, si) => (
        <FieldRow
          key={si}
          field={sf}
          pageIndex={pageIndex}
          fieldPath={[...fieldPath, si]}
          editing={editing}
          selected={false}
          onSelect={() => {}}
          onUpdate={() => {}}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

function PageSection({
  page,
  pageIndex,
  editing,
  selection,
  onSelect,
  def,
  onChange,
  onMovePage,
}: {
  page: PageDef;
  pageIndex: number;
  editing: boolean;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  def: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
  onMovePage: (dir: -1 | 1) => void;
}) {
  const fields = page.fields ?? [];
  const isPageSelected = selection?.type === 'page' && selection.pageIndex === pageIndex;
  const thisSel: Selection = { type: 'page', pageIndex };

  function isFieldSelected(fieldPath: number[]) {
    if (selection?.type !== 'field') return false;
    if (selection.pageIndex !== pageIndex) return false;
    return selection.fieldPath.length === fieldPath.length && selection.fieldPath.every((v, i) => v === fieldPath[i]);
  }

  function handleMoveField(fieldIndex: number, dir: -1 | 1) {
    const newFields = moveItem(fields, fieldIndex, fieldIndex + dir);
    onChange(updatePageFields(def, pageIndex, newFields));
  }

  function handleRemoveField(fieldIndex: number) {
    const newFields = removeItem(fields, fieldIndex);
    onChange(updatePageFields(def, pageIndex, newFields));
    onSelect(null);
  }

  function handleFieldUpdate(fieldPath: number[], updates: Partial<FieldDef>) {
    onChange(updateFieldAtPath(def, pageIndex, fieldPath, (f) => ({ ...f, ...updates })));
  }

  const [open, setOpen] = useState(false);

  return (
    <div>
      <div
        onClick={() => {
          setOpen(!open);
          onSelect(selectionEquals(selection, thisSel) ? null : thisSel);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.375rem 0.5rem',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: 600,
          ...(isPageSelected ? { backgroundColor: '#e8e8e8' } : {}),
        }}
      >
        <span style={{ color: '#555', fontSize: '0.75rem', userSelect: 'none', width: '0.75rem' }}>{open ? '▼' : '▶'}</span>
        <span>{page.title ?? page.id ?? '(untitled)'}</span>
        <span style={{ fontSize: '0.75rem', color: '#888', fontWeight: 400 }}>[{fields.length} field{fields.length !== 1 ? 's' : ''}]</span>
        {editing && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.125rem' }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); onMovePage(-1); }} className="usa-button usa-button--unstyled font-sans-3xs" title="Move up">&uarr;</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onMovePage(1); }} className="usa-button usa-button--unstyled font-sans-3xs" title="Move down">&darr;</button>
          </span>
        )}
      </div>
      {open && (
        <>
          {isPageSelected && (
            <div style={{ ...expandedStyle, marginLeft: '1.5rem', marginRight: '0.5rem' }}>
              <Prop label="id"><code style={monoStyle}>{page.id ?? '—'}</code></Prop>
              {editing ? (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className="text-base-dark" style={{ minWidth: '5rem', flexShrink: 0 }}>title:</span>
                  <TextInput
                    id={`page-title-${pageIndex}`}
                    name="title"
                    type="text"
                    value={(page.title as string) ?? ''}
                    onChange={(e) => onChange(updatePage(def, pageIndex, { title: e.target.value }))}
                    className="height-4"
                    style={{ flex: 1 }}
                  />
                </div>
              ) : (
                <Prop label="title">{page.title ?? '—'}</Prop>
              )}
            </div>
          )}
          <div style={{ borderLeft: '1px solid #ddd', marginLeft: '1.5rem' }}>
            {fields.map((field, fi) => {
              const fp = [fi];
              return (
                <FieldRow
                  key={fi}
                  field={field}
                  pageIndex={pageIndex}
                  fieldPath={fp}
                  editing={editing}
                  selected={isFieldSelected(fp)}
                  onSelect={() => {
                    const sel: Selection = { type: 'field', pageIndex, fieldPath: fp };
                    onSelect(selectionEquals(selection, sel) ? null : sel);
                  }}
                  onUpdate={(updates) => handleFieldUpdate(fp, updates)}
                  onMove={(dir) => handleMoveField(fi, dir)}
                  onRemove={() => handleRemoveField(fi)}
                  depth={0}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Editable row for a text metadata field */
function MetaTextRow({
  label, value, editing, onChange,
}: {
  label: string; value: string; editing: boolean; onChange: (v: string) => void;
}) {
  if (editing) {
    return (
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <span className="text-base-dark" style={{ minWidth: '5.5rem', flexShrink: 0 }}>{label}:</span>
        <TextInput
          id={`meta-${label}`}
          name={label}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="height-4"
          style={{ flex: 1 }}
        />
      </div>
    );
  }
  return <Prop label={label}>{value || '—'}</Prop>;
}

/** Editable row for a select metadata field */
function MetaSelectRow({
  label, value, options, editing, onChange,
}: {
  label: string; value: string; options: string[]; editing: boolean; onChange: (v: string) => void;
}) {
  if (editing) {
    return (
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <span className="text-base-dark" style={{ minWidth: '5.5rem', flexShrink: 0 }}>{label}:</span>
        <Select
          id={`meta-${label}`}
          name={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="height-4"
          style={{ flex: 1 }}
        >
          <option value="">—</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      </div>
    );
  }
  return <Prop label={label}>{value || '—'}</Prop>;
}

/** Metadata shown as a collapsible row, same pattern as pages */
function MetadataRow({
  def,
  editing,
  onChange,
}: {
  def: Record<string, unknown>;
  editing: boolean;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const form = getForm(def);
  const layout = (form.layout ?? {}) as Record<string, unknown>;

  return (
    <div>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.375rem 0.5rem',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: 600,
        }}
      >
        <span style={{ color: '#555', fontSize: '0.75rem', userSelect: 'none', width: '0.75rem' }}>{open ? '▼' : '▶'}</span>
        <span>Form Metadata</span>
      </div>
      {open && (
        <div style={{ ...expandedStyle, marginLeft: '1.5rem', marginRight: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <Prop label="id"><code style={monoStyle}>{(form.id as string) ?? '—'}</code></Prop>
          <MetaTextRow label="title" value={(form.title as string) ?? ''} editing={editing} onChange={(v) => onChange(updateForm(def, { title: v }))} />
          <MetaSelectRow label="schema" value={(form.schema as string) ?? ''} options={SCHEMA_NAMES} editing={editing} onChange={(v) => {
            const pages = generatePagesForSchema(v);
            if (pages) {
              onChange(updateForm(def, { schema: v, pages }));
            } else {
              onChange(updateForm(def, { schema: v }));
            }
          }} />
          <MetaSelectRow label="navigation" value={(layout.navigation as string) ?? ''} options={NAVIGATION_TYPES} editing={editing} onChange={(v) => onChange(updateLayout(def, 'navigation', v))} />
          <MetaSelectRow label="display" value={(layout.display as string) ?? ''} options={DISPLAY_TYPES} editing={editing} onChange={(v) => onChange(updateLayout(def, 'display', v))} />
          <MetaSelectRow label="role" value={(form.role as string) ?? ''} options={ROLES} editing={editing} onChange={(v) => onChange(updateForm(def, { role: v }))} />
        </div>
      )}
    </div>
  );
}

// --- Main component -------------------------------------------------------

export function FormTreeEditor({ definition, editing, onChange }: FormTreeEditorProps) {
  const [selection, setSelection] = useState<Selection>(null);
  const pages = getPages(definition);

  function handleMovePage(pageIndex: number, dir: -1 | 1) {
    const newPages = moveItem(pages, pageIndex, pageIndex + dir);
    onChange(updateForm(definition, { pages: newPages }));
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
      {/* Metadata — same visual weight as a page */}
      <MetadataRow
        def={definition}
        editing={editing}
        onChange={onChange}
      />

      {/* Pages & fields */}
      {pages.map((page, pi) => (
        <PageSection
          key={pi}
          page={page}
          pageIndex={pi}
          editing={editing}
          selection={selection}
          onSelect={setSelection}
          def={definition}
          onChange={onChange}
          onMovePage={(dir) => handleMovePage(pi, dir)}
        />
      ))}
      {pages.length === 0 && (
        <p className="text-base font-sans-3xs padding-1 margin-0">No pages defined.</p>
      )}
    </div>
  );
}
