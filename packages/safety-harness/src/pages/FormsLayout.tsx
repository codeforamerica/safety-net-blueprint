import { useCallback, useState, useMemo, useRef, useLayoutEffect } from 'react';
import { Table, Alert, Button, Tag } from '@trussworks/react-uswds';
import { z } from 'zod';
import { FormRenderer, ActionBar } from '@safety-net/form-engine-react';
import type { FormContract, ActionDefinition, Role } from '@safety-net/form-engine-react';
import { useApiData } from '../hooks/useApiData';
import { genericApi } from '../api/generic';
import type { ListResponse } from '../api/generic';
import formsContract from '@contracts/forms-management.form.yaml';
import formContractSchema from '@contracts/form-contract.schema.json';
import { FormTreeEditor } from '../components/FormTreeEditor';

/** Permissive schema — form metadata fields are all optional strings/objects. */
const formMetadataSchema = z.object({}).passthrough();

const PAGE_SIZE = 25;

interface FormRecord {
  id: string;
  name: string;
  description?: string;
  status: string;
  version?: string;
  definition?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Validate a form definition against the JSON Schema (lightweight check). */
function validateDefinition(
  definition: unknown,
): string[] {
  const warnings: string[] = [];
  if (!definition || typeof definition !== 'object') {
    warnings.push('Definition is missing or not an object.');
    return warnings;
  }

  const def = definition as Record<string, unknown>;
  if (!def.form) {
    warnings.push('Definition must have a "form" property.');
    return warnings;
  }

  const form = def.form as Record<string, unknown>;

  // Check required top-level fields from schema
  const required = formContractSchema.properties.form.required as string[];
  for (const field of required) {
    if (!(field in form)) {
      warnings.push(`Missing required field: form.${field}`);
    }
  }

  // Check layout
  if (form.layout && typeof form.layout === 'object') {
    const layout = form.layout as Record<string, unknown>;
    const navDef = formContractSchema.$defs.NavigationType as { enum: string[] };
    const dispDef = formContractSchema.$defs.DisplayType as { enum: string[] };

    if (layout.navigation && !navDef.enum.includes(layout.navigation as string)) {
      warnings.push(`Invalid navigation type: "${layout.navigation}". Expected one of: ${navDef.enum.join(', ')}`);
    }
    if (layout.display && !dispDef.enum.includes(layout.display as string)) {
      warnings.push(`Invalid display type: "${layout.display}". Expected one of: ${dispDef.enum.join(', ')}`);
    }
  }

  // Check pages
  if (form.pages && Array.isArray(form.pages)) {
    for (let i = 0; i < form.pages.length; i++) {
      const page = form.pages[i] as Record<string, unknown>;
      if (!page.id) warnings.push(`Page ${i}: missing "id".`);
      if (!page.title) warnings.push(`Page ${i}: missing "title".`);

      // Check field components
      if (page.fields && Array.isArray(page.fields)) {
        const compDef = formContractSchema.$defs.ComponentType as { enum: string[] };
        for (const field of page.fields as Record<string, unknown>[]) {
          if (field.component && !compDef.enum.includes(field.component as string)) {
            warnings.push(`Page "${page.id}", field "${field.ref}": unknown component "${field.component}".`);
          }
        }
      }
    }
  }

  return warnings;
}


function FormDetail({
  form,
  onBack,
  onSave,
}: {
  form: FormRecord;
  onBack: () => void;
  onSave: (updated: FormRecord) => void;
}) {
  // Read actions from the forms-management contract
  const formsContractTyped = formsContract as unknown as FormContract;
  const actions = formsContractTyped.form.actions ?? [];
  const saveAction = actions.find((a) => a.method === 'PATCH');

  // Editing state
  const [editing, setEditing] = useState(false);
  const [definitionDraft, setDefinitionDraft] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Sync both panels to the same height (whichever is taller)
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;
    // Reset so we can measure natural heights
    left.style.height = 'auto';
    right.style.height = 'auto';
    const h = Math.max(left.scrollHeight, right.scrollHeight);
    setPanelHeight(h);
  }, [editing, definitionDraft, form.definition]);


  const validationWarnings = useMemo(
    () => validateDefinition(form.definition),
    [form.definition],
  );

  // Parse definition as a FormContract for the live preview
  const previewContract = useMemo<FormContract | null>(() => {
    const source = editing ? definitionDraft : form.definition;
    if (!source || typeof source !== 'object') return null;
    const def = source as Record<string, unknown>;
    if (!def.form || typeof def.form !== 'object') return null;
    return source as unknown as FormContract;
  }, [editing, definitionDraft, form.definition]);

  const previewRole = useMemo(() => {
    const source = editing ? definitionDraft : form.definition;
    const formObj = (source as Record<string, unknown>)?.form as Record<string, unknown> | undefined;
    return (typeof formObj?.role === 'string' ? formObj.role : 'applicant') as Role;
  }, [editing, definitionDraft, form.definition]);

  function handleEdit() {
    setEditing(true);
    setDefinitionDraft(structuredClone(form.definition ?? {}));
    setSaveError(null);
    setSaveSuccess(null);
  }

  function handleCancel() {
    setEditing(false);
    setDefinitionDraft(null);
    setSaveError(null);
  }

  async function handleAction(action: ActionDefinition) {
    if (action.method === 'PATCH') {
      setSaving(true);
      setSaveError(null);
      setSaveSuccess(null);
      try {
        const definition = definitionDraft;
        const endpoint = formsContractTyped.form.resource!.endpoint;
        await genericApi(endpoint).update(form.id, { definition });
        onSave({ ...form, definition } as FormRecord);
        setEditing(false);
        setDefinitionDraft(null);
        setSaveSuccess('Saved.');
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    }
  }

  return (
    <div>
      <Button
        type="button"
        unstyled
        className="margin-bottom-2"
        onClick={onBack}
      >
        &larr; Back to Form Definitions
      </Button>

      <div className="display-flex flex-justify flex-align-center">
        <div>
          <h2 className="margin-bottom-0">{form.name}</h2>
          <p className="usa-hint margin-top-05">
            ID: <code>{form.id}</code>
          </p>
        </div>
        {!editing && saveAction && (
          <Button type="button" outline onClick={handleEdit}>
            Edit
          </Button>
        )}
      </div>

      {saveSuccess && !editing && (
        <Alert type="success" headingLevel="h3" slim className="margin-bottom-2">
          {saveSuccess}
        </Alert>
      )}

      {validationWarnings.length > 0 && !editing && (
        <Alert
          type="warning"
          headingLevel="h3"
          heading="Definition validation warnings"
          className="margin-bottom-2"
        >
          <ul className="usa-list">
            {validationWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      {editing && (
        <div className="display-flex flex-justify margin-bottom-2">
          <ActionBar
            actions={actions}
            role="admin"
            onAction={handleAction}
          />
          <Button type="button" unstyled onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      )}

      {saveError && (
        <Alert type="error" headingLevel="h3" slim className="margin-bottom-2">
          {saveError}
        </Alert>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1.5rem',
          marginTop: '1rem',
        }}
      >
        {/* Left panel: structured tree editor */}
        <div ref={leftRef} style={{ minWidth: 0, height: panelHeight ? `${panelHeight}px` : undefined, overflow: 'auto' }}>
          <h3 className="border-bottom-2px border-primary padding-bottom-1 margin-bottom-2 text-ink">
            Definition
          </h3>
          <FormTreeEditor
            definition={editing ? definitionDraft! : (form.definition ?? {})}
            editing={editing}
            onChange={(updated) => setDefinitionDraft(updated)}
          />
        </div>

        {/* Right panel: live form preview */}
        <div ref={rightRef} style={{ minWidth: 0, height: panelHeight ? `${panelHeight}px` : undefined, overflow: 'auto' }}>
          <h3 className="border-bottom-2px border-primary padding-bottom-1 margin-bottom-2 text-ink">
            Preview
          </h3>
          {previewContract ? (
            <FormRenderer
              contract={previewContract}
              schema={formMetadataSchema}
              defaultValues={{}}
              role={previewRole}
              viewMode="readonly"
              idPrefix="preview-"
              onSubmit={() => {}}
            />
          ) : (
            <p className="usa-prose text-base">
              No preview available — the definition is missing or invalid.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function FormsLayout() {
  const [offset, setOffset] = useState(0);
  const [selectedForm, setSelectedForm] = useState<FormRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetcher = useCallback(
    () => genericApi('/forms').list({ limit: PAGE_SIZE, offset }),
    [offset, refreshKey],
  );
  const { data, loading, error } = useApiData<ListResponse>(fetcher);

  const contract = formsContract as unknown as FormContract;
  const columns = contract.form.columns ?? [
    { from: 'name', label: 'Name' },
    { from: 'status', label: 'Status' },
  ];

  function handleBack() {
    setSelectedForm(null);
    setRefreshKey((k) => k + 1);
  }

  if (selectedForm) {
    return (
      <FormDetail
        form={selectedForm}
        onBack={handleBack}
        onSave={(updated) => setSelectedForm(updated)}
      />
    );
  }

  if (loading) {
    return <p className="usa-prose">Loading form definitions...</p>;
  }

  if (error) {
    return (
      <Alert type="error" headingLevel="h3" heading="Error loading form definitions">
        {error}
      </Alert>
    );
  }

  const items = (data?.items ?? []) as FormRecord[];
  const total = data?.total ?? 0;
  const hasNext = data?.hasNext ?? false;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <h2>Form Definitions</h2>
      <p className="usa-hint">
        Form contracts managed through the Forms API — the harness eating its own dog food.
      </p>

      {items.length === 0 ? (
        <p className="usa-prose">No form definitions found.</p>
      ) : (
        <>
          <Table bordered fullWidth>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.from} scope="col">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => setSelectedForm(item)}
                  style={{ cursor: 'pointer' }}
                  className="hover:bg-base-lightest"
                >
                  {columns.map((col) => {
                    const val = item[col.from];
                    if (col.from === 'status') {
                      return (
                        <td key={col.from}>
                          <Tag
                            className={
                              val === 'published'
                                ? 'bg-success-dark text-white'
                                : 'bg-base-lighter'
                            }
                          >
                            {String(val ?? '')}
                          </Tag>
                        </td>
                      );
                    }
                    return (
                      <td key={col.from}>
                        {val == null ? '' : String(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>

          <div className="display-flex flex-justify flex-align-center margin-top-2">
            <div>
              <Button
                type="button"
                outline
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <span className="margin-x-1 font-sans-xs">
                Page {currentPage} of {totalPages} ({total} records)
              </span>
              <Button
                type="button"
                outline
                disabled={!hasNext}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
