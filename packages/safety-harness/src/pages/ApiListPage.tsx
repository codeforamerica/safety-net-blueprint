import { useCallback, useMemo } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { Alert, Button } from '@trussworks/react-uswds';
import { DataTableRenderer } from '@safety-net/form-engine-react';
import type { FormContract, ResolvedRow } from '@safety-net/form-engine-react';
import { useApiData } from '../hooks/useApiData';
import { genericApi } from '../api/generic';
import type { ListResponse } from '../api/generic';
import type { ApiSpec } from '../hooks/useManifest';
import { generateListContract } from '../lib/generateContract';
import { useRole } from '../context/RoleContext';

const LIST_LIMIT = 100;

// Eagerly load all saved list contracts at build time.
// Vite HMR will pick up changes to these files automatically.
const listYamlModules = import.meta.glob<Record<string, unknown>>(
  '@contracts/forms/*.list.form.yaml',
  { eager: true, import: 'default' },
);

function findListYaml(apiName: string): FormContract | undefined {
  for (const [path, mod] of Object.entries(listYamlModules)) {
    if (path.endsWith(`/${apiName}.list.form.yaml`)) {
      return mod as unknown as FormContract;
    }
  }
  return undefined;
}

export function ApiListPage() {
  const { apiName } = useParams<{ apiName: string }>();
  const navigate = useNavigate();
  const { apis } = useOutletContext<{ apis: ApiSpec[] }>();
  const { role } = useRole();

  const api = apis.find((a) => a.name === apiName);
  const basePath = api?.baseResource ?? `/${apiName}`;

  const fetcher = useCallback(
    () => genericApi(basePath).list({ limit: LIST_LIMIT }),
    [basePath],
  );
  const { data, loading, error } = useApiData<ListResponse>(fetcher);

  const resourceSchema = useMemo(() => {
    if (!api?.schemas) return undefined;
    const names = Object.keys(api.schemas);
    const primary = names.find(
      (n) =>
        !n.includes('List') &&
        !n.includes('Create') &&
        !n.includes('Update') &&
        !n.includes('Error') &&
        !n.includes('Pagination'),
    );
    return primary ? (api.schemas[primary] as Record<string, unknown>) : undefined;
  }, [api?.schemas]);

  // Try to load saved YAML contract; fall back to runtime generation
  const savedListContract = apiName ? findListYaml(apiName) : undefined;

  const listResult = useMemo(() => {
    if (savedListContract) {
      const page = savedListContract.form.pages?.[0];
      const columns = page?.columns ?? [{ from: 'id', label: 'ID' }];
      return { contract: savedListContract, columns };
    }
    if (!apiName || !api) return null;
    const detailFormId = `${apiName}-detail`;
    const detailFetch = basePath + '/{id}';
    return generateListContract(
      apiName,
      api.title ?? apiName,
      resourceSchema as any,
      detailFormId,
      detailFetch,
    );
  }, [savedListContract, apiName, api, resourceSchema, basePath]);

  // Create action — derived from endpoint discovery
  const hasCreate = api?.endpoints?.some((e) => e.method === 'POST' && !e.path.includes('{'));

  const handleRowClick = useCallback((row: ResolvedRow) => {
    const id = row.rawData?.id ?? row.values.id;
    if (id) {
      navigate(`/explore/${apiName}/${id}`);
    }
  }, [navigate, apiName]);

  if (loading) {
    return <p className="usa-prose">Loading {api?.title ?? apiName}...</p>;
  }

  if (error) {
    return (
      <Alert type="error" headingLevel="h3" heading={`Error loading ${api?.title ?? apiName}`}>
        {error}
      </Alert>
    );
  }

  const items = (data?.items ?? []) as Record<string, unknown>[];

  return (
    <div>
      {hasCreate && (
        <div className="display-flex flex-justify-end margin-bottom-1">
          <Button
            type="button"
            onClick={() => navigate(`/explore/${apiName}/new`)}
          >
            Create
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="usa-prose">No records found.</p>
      ) : listResult ? (
        <DataTableRenderer
          pages={listResult.contract.form.pages}
          columns={listResult.columns}
          title={listResult.contract.form.title ?? api?.title ?? apiName}
          source="api"
          data={items}
          onRowClick={handleRowClick}
        />
      ) : null}
    </div>
  );
}
