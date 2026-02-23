import React, { useCallback, useMemo, useState } from 'react';
import { useParams, useOutletContext, useNavigate } from 'react-router-dom';
import { Alert, Button } from '@trussworks/react-uswds';
import { z } from 'zod';
import { FormRenderer, ActionBar } from '@safety-net/form-engine-react';
import type { ActionDefinition, FormContract, PermissionsPolicy, Role, AnnotationEntry } from '@safety-net/form-engine-react';
import { useApiData } from '../hooks/useApiData';
import { useRole } from '../context/RoleContext';
import { genericApi } from '../api/generic';
import { generateContract } from '../lib/generateContract';
import type { ApiSpec } from '../hooks/useManifest';

/**
 * Recursively strip keys from form data that don't exist in the original
 * and have empty/default values (empty string, false, empty object).
 * Then coerce remaining values to match the original's types.
 */
function cleanAndCoerce(formValue: unknown, originalValue: unknown): unknown {
  // Coerce types when original exists
  if (originalValue !== undefined && originalValue !== null) {
    if (typeof originalValue === 'boolean') {
      if (typeof formValue === 'string') return formValue === 'true';
      if (Array.isArray(formValue)) return formValue.includes('true');
      return Boolean(formValue);
    }
    if (typeof originalValue === 'number') {
      if (typeof formValue === 'string') {
        if (formValue === '') return undefined;
        const n = Number(formValue);
        return isNaN(n) ? formValue : n;
      }
      return formValue;
    }
  }

  // Recurse into arrays
  if (Array.isArray(formValue)) {
    const origArr = Array.isArray(originalValue) ? originalValue : [];
    return formValue.map((item, i) => cleanAndCoerce(item, origArr[i]));
  }

  // Recurse into objects — drop empty-valued keys that don't exist in original
  if (typeof formValue === 'object' && formValue !== null) {
    const orig = (typeof originalValue === 'object' && originalValue !== null)
      ? originalValue as Record<string, unknown>
      : {};
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(formValue as Record<string, unknown>)) {
      if (!(k in orig)) {
        // Key doesn't exist in original — only keep if non-empty
        if (v === '' || v === false || v === undefined || v === null) continue;
        if (typeof v === 'object' && v !== null) {
          const cleaned = cleanAndCoerce(v, undefined);
          if (cleaned === undefined) continue;
          if (typeof cleaned === 'object' && Object.keys(cleaned as object).length === 0) continue;
          result[k] = cleaned;
          continue;
        }
        result[k] = v;
        continue;
      }
      const cleaned = cleanAndCoerce(v, orig[k]);
      if (cleaned !== undefined) {
        result[k] = cleaned;
      }
    }
    return result;
  }

  return formValue;
}

/**
 * Compute a minimal PATCH payload: clean form data, coerce types, then diff.
 */
function buildPatch(
  original: Record<string, unknown> | undefined,
  formData: Record<string, unknown>,
): Record<string, unknown> {
  if (!original) return formData;
  const cleaned = cleanAndCoerce(formData, original) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cleaned)) {
    if (JSON.stringify(value) !== JSON.stringify(original[key])) {
      patch[key] = value;
    }
  }
  return patch;
}

// Eagerly load all saved detail contracts at build time.
const detailYamlModules = import.meta.glob<Record<string, unknown>>(
  '@contracts/forms/*.detail.form.yaml',
  { eager: true, import: 'default' },
);

// Eagerly load all separate permissions YAML files at build time.
const permYamlModules = import.meta.glob<Record<string, unknown>>(
  '@contracts/permissions/**/*.yaml',
  { eager: true, import: 'default' },
);

// Eagerly load all annotation YAML files at build time.
const annotYamlModules = import.meta.glob<Record<string, unknown>>(
  '@contracts/annotations/*.yaml',
  { eager: true, import: 'default' },
);

interface YamlDetailDoc {
  form: FormContract['form'];
  permissions?: PermissionsPolicy[];
}

function findDetailYaml(apiName: string): YamlDetailDoc | undefined {
  for (const [path, mod] of Object.entries(detailYamlModules)) {
    if (path.endsWith(`/${apiName}.detail.form.yaml`)) {
      return mod as unknown as YamlDetailDoc;
    }
  }
  return undefined;
}

/** Find a separate permissions YAML file for the given API and role. */
function findPermissions(apiName: string, role: Role): PermissionsPolicy | undefined {
  for (const [path, mod] of Object.entries(permYamlModules)) {
    if (path.includes(`/${apiName}/`) && path.endsWith(`/${role}.yaml`)) {
      return mod as unknown as PermissionsPolicy;
    }
  }
  return undefined;
}

interface AnnotationDoc {
  schema: string;
  fields: Record<string, { programs?: Record<string, string>; [k: string]: unknown }>;
}

/**
 * Convert an annotation YAML document into the Record<string, string[]> format
 * expected by FormRenderer. Keys are field refs, values are program name arrays.
 */
function deriveAnnotationLookup(doc: AnnotationDoc): Record<string, string[]> {
  const lookup: Record<string, string[]> = {};
  for (const [ref, meta] of Object.entries(doc.fields)) {
    if (meta.programs) {
      lookup[ref] = Object.keys(meta.programs);
    }
  }
  return lookup;
}

/** Find annotation data for a given API name and derive both legacy lookup and full entries. */
function findAnnotations(apiName: string): { lookup: Record<string, string[]>; entries: Record<string, AnnotationEntry> } | undefined {
  for (const [path, mod] of Object.entries(annotYamlModules)) {
    if (path.endsWith(`/${apiName}.yaml`)) {
      const doc = mod as unknown as AnnotationDoc;
      const lookup = deriveAnnotationLookup(doc);
      const entries: Record<string, AnnotationEntry> = {};
      for (const [ref, meta] of Object.entries(doc.fields)) {
        entries[ref] = meta as AnnotationEntry;
      }
      return { lookup, entries };
    }
  }
  return undefined;
}

/** Resolve the allOf composition to find a schema with properties. */
function resolveSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.allOf) {
    const merged: Record<string, unknown> = { type: 'object', properties: {}, required: [] };
    for (const part of schema.allOf as Record<string, unknown>[]) {
      const resolved = resolveSchema(part);
      if (resolved.properties) {
        (merged.properties as Record<string, unknown>) = {
          ...(merged.properties as Record<string, unknown>),
          ...(resolved.properties as Record<string, unknown>),
        };
      }
      if (resolved.required) {
        (merged.required as unknown[]) = [
          ...(merged.required as unknown[]),
          ...(resolved.required as unknown[]),
        ];
      }
    }
    return merged;
  }
  return schema;
}

/** Derive detail-page actions from API endpoints (same logic as generateContract). */
function deriveDetailActions(
  endpoints: { path: string; method: string; operationId: string; summary: string }[],
  basePath: string,
  apiName: string,
): ActionDefinition[] {
  const actions: ActionDefinition[] = [];
  for (const ep of endpoints) {
    const method = ep.method.toUpperCase() as ActionDefinition['method'];
    if (method === 'GET') continue;
    const isCollection = !ep.path.includes('{');
    if (method === 'POST' && isCollection) continue; // Create belongs on the list page
    if (method === 'PATCH' || method === 'PUT') {
      actions.push({ id: ep.operationId ?? 'update', label: 'Save', method, style: 'default' });
    } else if (method === 'DELETE') {
      actions.push({
        id: ep.operationId ?? 'delete',
        label: 'Delete',
        method: 'DELETE',
        style: 'warning',
        confirm: `Are you sure you want to delete this ${apiName.replace(/-/g, ' ')}?`,
        navigate: `/explore/${apiName}`,
      });
    }
  }
  return actions;
}

/** Collapsible JSON tree node. Objects/arrays start collapsed. */
function JsonTree({ label, value, defaultOpen = false }: { label: string; value: unknown; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  if (value === null || value === undefined) {
    return <div className="font-mono-xs"><span className="text-base-dark">{label}:</span> <span className="text-base">null</span></div>;
  }

  if (typeof value !== 'object') {
    const color = typeof value === 'string' ? 'text-green' : typeof value === 'boolean' ? 'text-primary' : 'text-accent-cool-dark';
    const display = typeof value === 'string' ? `"${value}"` : String(value);
    return <div className="font-mono-xs"><span className="text-base-dark">{label}:</span> <span className={color}>{display}</span></div>;
  }

  const isArray = Array.isArray(value);
  const entries = isArray ? (value as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  const bracket = isArray ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div className="font-mono-xs">
      <span
        onClick={() => setOpen((v) => !v)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ display: 'inline-block', width: '1em', textAlign: 'center' }}>{open ? '\u25BE' : '\u25B8'}</span>
        <span className="text-base-dark">{label}:</span> <span className="text-base">{bracket}</span>
      </span>
      {open && (
        <div style={{ marginLeft: '1.2em', borderLeft: '1px solid #ddd', paddingLeft: '0.5em' }}>
          {entries.map(([k, v]) => <JsonTree key={k} label={k} value={v} />)}
        </div>
      )}
    </div>
  );
}

const DETAIL_FORM_ID = 'explore-detail-form';

export function ApiDetailPage() {
  const { apiName, id } = useParams<{ apiName: string; id: string }>();
  const navigate = useNavigate();
  const { role } = useRole();
  const { apis } = useOutletContext<{ apis: ApiSpec[] }>();

  const api = apis.find((a) => a.name === apiName);
  const basePath = api?.baseResource ?? `/${apiName}`;

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const fetcher = useCallback(
    () => genericApi(basePath).get(id!),
    [basePath, id],
  );
  const { data, loading, error } = useApiData(fetcher);

  // Try saved YAML contract first
  const savedDoc = apiName ? findDetailYaml(apiName) : undefined;
  const savedContract = savedDoc ? { form: savedDoc.form } as FormContract : undefined;
  const savedPermissions = savedDoc?.permissions;

  // Find the primary resource schema and generate contract (fallback)
  const generated = useMemo(() => {
    if (savedContract) return null;
    if (!api?.schemas) return null;
    const names = Object.keys(api.schemas);
    const primaryName = names.find(
      (n) =>
        !n.includes('List') &&
        !n.includes('Create') &&
        !n.includes('Update') &&
        !n.includes('Error') &&
        !n.includes('Pagination'),
    );
    if (!primaryName) return null;
    const rawSchema = api.schemas[primaryName] as Record<string, unknown>;
    const resolved = resolveSchema(rawSchema);
    return generateContract(
      api.name,
      api.title,
      resolved,
      api.baseResource,
      api.endpoints as { path: string; method: string; operationId: string; summary: string }[],
    );
  }, [savedContract, api]);

  const contract = savedContract ?? generated?.contract;
  const schema = generated?.schema ?? z.record(z.string(), z.unknown());

  // Resolve permissions for current role:
  // 1. Separate YAML file (contracts/permissions/{apiName}/{role}.yaml)
  // 2. Embedded permissions array in the detail YAML
  // 3. Generated permissions from generateContract()
  const permissionsPolicy = useMemo<PermissionsPolicy | undefined>(() => {
    if (apiName) {
      const separate = findPermissions(apiName, role);
      if (separate) return separate;
    }
    if (savedPermissions) return savedPermissions.find((p) => p.role === role);
    if (generated?.permissions) return generated.permissions[role];
    return undefined;
  }, [apiName, generated, savedPermissions, role]);

  // Load annotation data for this API (program badges on fields)
  const annotationResult = useMemo(() => {
    return apiName ? findAnnotations(apiName) : undefined;
  }, [apiName]);

  if (loading) {
    return <p className="usa-prose">Loading record...</p>;
  }

  if (error) {
    return (
      <Alert type="error" headingLevel="h3" heading="Error loading record">
        {error}
      </Alert>
    );
  }

  if (!contract) {
    return (
      <Alert type="warning" headingLevel="h3" heading="No schema available">
        Could not generate a form contract for this API.
      </Alert>
    );
  }

  const actions = api?.endpoints
    ? deriveDetailActions(
        api.endpoints as { path: string; method: string; operationId: string; summary: string }[],
        basePath,
        apiName!,
      )
    : [];

  const handleSubmit = async (formData: Record<string, unknown>) => {
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      // Compute a PATCH payload: only send fields that differ from the original.
      // This avoids sending type-coerced values (e.g. booleans as strings) for
      // fields the user didn't touch.
      const patch = buildPatch(data as Record<string, unknown> | undefined, formData);
      if (Object.keys(patch).length === 0) {
        setSubmitSuccess('No changes to save.');
        return;
      }
      await genericApi(basePath).update(id!, patch);
      setSubmitSuccess('Record updated successfully.');
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAction = (action: ActionDefinition) => {
    setSubmitError(null);
    setSubmitSuccess(null);

    // Save/Update → trigger the form's submit (FormRenderer handles onSubmit)
    if (action.method === 'PATCH' || action.method === 'PUT') {
      const form = document.getElementById(DETAIL_FORM_ID) as HTMLFormElement | null;
      form?.requestSubmit();
      return;
    }

    const run = async () => {
      try {
        const client = genericApi(basePath);
        if (action.method === 'DELETE') {
          await client.remove(id!);
          navigate(`/explore/${apiName}`);
          return;
        } else if (action.method === 'POST') {
          await client.create({});
        }
        if (action.navigate) {
          navigate(action.navigate.replace('{id}', id!));
        }
      } catch (err: unknown) {
        setSubmitError(err instanceof Error ? err.message : String(err));
      }
    };
    void run();
  };

  return (
    <div>
      <Button
        type="button"
        unstyled
        className="margin-bottom-2"
        onClick={() => navigate(`/explore/${apiName}`)}
      >
        &larr; Back to {api?.title ?? apiName}
      </Button>

      <h2>{contract.form.title ?? api?.title ?? apiName}</h2>
      <p className="usa-hint">
        ID: <code>{id}</code>
      </p>

      <ActionBar
        actions={actions}
        role={role}
        data={data as Record<string, unknown> | undefined}
        onAction={handleAction}
      />

      {submitError && (
        <Alert type="error" headingLevel="h3" heading="Action failed" slim>
          {submitError}
        </Alert>
      )}
      {submitSuccess && (
        <Alert type="success" headingLevel="h3" heading="Success" slim>
          {submitSuccess}
        </Alert>
      )}

      <div className="display-flex flex-justify-end margin-bottom-1">
        <Button type="button" unstyled className="font-sans-xs" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? 'Hide' : 'Show'} raw JSON
        </Button>
      </div>

      {showRaw && (
        <div className="bg-base-lightest border-1px border-base-lighter radius-sm padding-2 margin-bottom-2" style={{ maxHeight: '400px', overflow: 'auto' }}>
          {data && typeof data === 'object'
            ? Object.entries(data as Record<string, unknown>).map(([k, v]) => (
                <JsonTree key={k} label={k} value={v} />
              ))
            : <span className="font-mono-xs">{JSON.stringify(data)}</span>
          }
        </div>
      )}

      <FormRenderer
        contract={contract}
        schema={schema}
        permissionsPolicy={permissionsPolicy}
        annotations={annotationResult?.lookup}
        annotationEntries={annotationResult?.entries}
        role={role}
        defaultValues={data as Record<string, unknown> | undefined}
        onSubmit={(formData) => void handleSubmit(formData)}
        formId={DETAIL_FORM_ID}
      />
    </div>
  );
}
