import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Alert } from '@trussworks/react-uswds';
import { useApiData } from '../hooks/useApiData';
import { fetchApplications } from '../api/dispatch';
import type { RouteDefinition } from '../config/routes';
import type { ContractRegistryEntry } from '../lib/registry';
import type { Application } from '../generated/api/applications/types.gen';

interface ListPageProps {
  route: RouteDefinition;
  entry: ContractRegistryEntry;
}

interface ColumnDef {
  from: string;
  label: string;
}

function getApplicantName(app: Application): string {
  const self = app.household?.members?.find((m) => m.relationship === 'self');
  if (!self?.name) return '';
  return [self.name.firstName, self.name.lastName].filter(Boolean).join(' ');
}

function getProgramsList(app: Application): string {
  const programs: string[] = [];
  if (app.programs?.snap) programs.push('SNAP');
  if (app.programs?.cashPrograms?.tanfProgram) programs.push('TANF');
  if (app.programs?.cashPrograms?.adultFinancial) programs.push('Adult Financial');
  if (app.programs?.medicalAssistance) programs.push('Medical');
  return programs.join(', ') || 'None';
}

function getCellValue(app: Application, from: string): string {
  switch (from) {
    case 'applicantName':
      return getApplicantName(app);
    case 'programsAppliedFor':
      return getProgramsList(app);
    case 'status':
      return app.status ?? '';
    case 'id':
      return app.id;
    default:
      return String((app as Record<string, unknown>)[from] ?? '');
  }
}

export function ListPage({ route, entry }: ListPageProps) {
  const navigate = useNavigate();
  const fetcher = useCallback(() => fetchApplications(), []);
  const { data, loading, error } = useApiData(fetcher);

  const page0 = entry.contract.form.pages?.[0] as unknown as
    | { columns?: ColumnDef[] }
    | undefined;
  const columns: ColumnDef[] = page0?.columns ?? [];

  if (loading) {
    return <p className="usa-prose">Loading...</p>;
  }

  if (error) {
    return (
      <Alert type="error" headingLevel="h3" heading="Error loading data">
        {error}
      </Alert>
    );
  }

  const items = data?.items ?? [];

  return (
    <div>
      <h2>{entry.contract.form.title ?? route.contract}</h2>
      {items.length === 0 ? (
        <p className="usa-prose">No applications found.</p>
      ) : (
        <Table bordered fullWidth>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.from} scope="col">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((app) => (
              <tr
                key={app.id}
                onClick={() => navigate(`/cases/${app.id}`)}
                style={{ cursor: 'pointer' }}
                className="hover:bg-base-lightest"
              >
                {columns.map((col) => (
                  <td key={col.from}>{getCellValue(app, col.from)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
