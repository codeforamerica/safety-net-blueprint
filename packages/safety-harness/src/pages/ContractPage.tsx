import { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Alert } from '@trussworks/react-uswds';
import { FormRenderer } from '@safety-net/form-engine-react';
import { useRole } from '../context/RoleContext';
import { getContractEntry } from '../lib/registry';
import { useApiData } from '../hooks/useApiData';
import { fetchApplication, submitApplication, patchApplication } from '../api/dispatch';
import { ListPage } from './ListPage';
import type { RouteDefinition } from '../config/routes';

interface ContractPageProps {
  route: RouteDefinition;
}

export function ContractPage({ route }: ContractPageProps) {
  const { role } = useRole();
  const params = useParams();
  const navigate = useNavigate();
  const entry = getContractEntry(route.contract);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const applicationId = params.applicationId;

  const fetcher = useCallback(
    () => fetchApplication(applicationId!),
    [applicationId],
  );

  const shouldFetch = !!(route.api.get && applicationId);
  const { data, loading, error } = useApiData(shouldFetch ? fetcher : null);

  if (!entry) {
    return (
      <div className="usa-alert usa-alert--error">
        <div className="usa-alert__body">
          <p className="usa-alert__text">
            Contract "{route.contract}" not found in registry.
          </p>
        </div>
      </div>
    );
  }

  // List route → delegate to ListPage
  if (route.type === 'list') {
    return <ListPage route={route} entry={entry} />;
  }

  // Detail route with loading state
  if (loading) {
    return <p className="usa-prose">Loading...</p>;
  }

  if (error) {
    return (
      <Alert type="error" headingLevel="h3" heading="Error loading application">
        {error}
      </Alert>
    );
  }

  const handleSubmit = async (formData: Record<string, unknown>) => {
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      if (route.api.create) {
        // Create route (e.g. /apply)
        await submitApplication(formData);
        navigate('/cases');
      } else if (route.api.update && applicationId) {
        // Update route (e.g. /cases/:id)
        await patchApplication(applicationId, formData);
        setSubmitSuccess('Application updated successfully.');
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <h2>{route.contract}</h2>
      <p className="usa-hint">
        Role: <strong>{role}</strong> | Route: <code>{route.path}</code>
        {applicationId && <> | ID: <code>{applicationId}</code></>}
      </p>

      {submitError && (
        <Alert type="error" headingLevel="h3" heading="Submit failed" slim>
          {submitError}
        </Alert>
      )}
      {submitSuccess && (
        <Alert type="success" headingLevel="h3" heading="Success" slim>
          {submitSuccess}
        </Alert>
      )}

      <FormRenderer
        contract={entry.contract}
        schema={entry.schema}
        permissionsPolicy={entry.permissions[role]}
        role={role}
        defaultValues={data as Record<string, unknown> | undefined}
        onSubmit={(formData) => void handleSubmit(formData)}
      />
    </div>
  );
}
