import { useMemo, useState } from 'react';
import { useParams, useOutletContext, useNavigate } from 'react-router-dom';
import { Alert, Button } from '@trussworks/react-uswds';
import { z } from 'zod';
import { FormRenderer } from '@safety-net/form-engine-react';
import type { FormContract, PermissionsPolicy } from '@safety-net/form-engine-react';
import { useRole } from '../context/RoleContext';
import { genericApi } from '../api/generic';
import { generateContract } from '../lib/generateContract';
import type { ApiSpec } from '../hooks/useManifest';

// Eagerly load all saved detail contracts at build time (create uses the same form layout).
const detailYamlModules = import.meta.glob<Record<string, unknown>>(
  '@contracts/forms/*.detail.form.yaml',
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

export function ApiCreatePage() {
  const { apiName } = useParams<{ apiName: string }>();
  const navigate = useNavigate();
  const { role } = useRole();
  const { apis } = useOutletContext<{ apis: ApiSpec[] }>();

  const api = apis.find((a) => a.name === apiName);
  const basePath = api?.baseResource ?? `/${apiName}`;

  const [submitError, setSubmitError] = useState<string | null>(null);

  // Try saved YAML contract first
  const savedDoc = apiName ? findDetailYaml(apiName) : undefined;
  const savedContract = savedDoc ? { form: savedDoc.form } as FormContract : undefined;
  const savedPermissions = savedDoc?.permissions;

  // Fall back to runtime generation
  const generated = useMemo(() => {
    if (savedContract) return null;
    if (!api?.schemas) return null;
    const names = Object.keys(api.schemas);
    const createName = names.find((n) => n.includes('Create'));
    const primaryName = createName ?? names.find(
      (n) =>
        !n.includes('List') &&
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

  const permissionsPolicy = useMemo<PermissionsPolicy | undefined>(() => {
    if (generated?.permissions) return generated.permissions[role];
    if (savedPermissions) return savedPermissions.find((p) => p.role === role);
    return undefined;
  }, [generated, savedPermissions, role]);

  if (!contract) {
    return (
      <Alert type="warning" headingLevel="h3" heading="No schema available">
        Could not generate a form contract for this API.
      </Alert>
    );
  }

  const handleSubmit = async (formData: Record<string, unknown>) => {
    setSubmitError(null);
    try {
      const result = await genericApi(basePath).create(formData);
      const newId = (result as { id?: string }).id;
      if (newId) {
        navigate(`/explore/${apiName}/${newId}`);
      } else {
        navigate(`/explore/${apiName}`);
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
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

      <h2>Create {contract.form.title ?? api?.title ?? apiName}</h2>

      {submitError && (
        <Alert type="error" headingLevel="h3" heading="Create failed" slim>
          {submitError}
        </Alert>
      )}

      <FormRenderer
        contract={contract}
        schema={schema}
        permissionsPolicy={permissionsPolicy}
        role={role}
        onSubmit={(formData) => void handleSubmit(formData)}
      />
    </div>
  );
}
