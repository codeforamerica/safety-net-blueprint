import React, { useState, useCallback } from 'react';
import { BreadcrumbBar, Breadcrumb, BreadcrumbLink } from '@trussworks/react-uswds';
import type { ZodSchema } from 'zod';
import { DataTableRenderer } from './DataTableRenderer';
import { FormRenderer } from './FormRenderer';
import type {
  Page,
  ReferenceColumn,
  AnnotationLayer,
  PermissionsPolicy,
  DataTableSource,
  FormContract,
  Role,
} from './types';
import type { ResolvedRow } from './data-table-resolvers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ListDetailRendererProps {
  pages: Page[];
  columns: ReferenceColumn[];
  title?: string;
  source?: DataTableSource;
  data?: Record<string, unknown>[];
  // Detail view props
  detailContract?: FormContract;
  detailSchema?: ZodSchema;
  detailRole?: Role;
  // Contract-source passthrough
  annotationLayers?: AnnotationLayer[];
  permissionsPolicies?: PermissionsPolicy[];
  schemaSpec?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ListDetailRenderer({
  pages,
  columns,
  title,
  source = 'contract',
  data,
  detailContract,
  detailSchema,
  detailRole,
  annotationLayers = [],
  permissionsPolicies = [],
  schemaSpec,
}: ListDetailRendererProps) {
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedRow, setSelectedRow] = useState<ResolvedRow | null>(null);

  const handleRowClick = useCallback((row: ResolvedRow) => {
    setSelectedRow(row);
    setView('detail');
  }, []);

  const handleBackToList = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setView('list');
    setSelectedRow(null);
  }, []);

  // No detail contract — delegate directly to DataTableRenderer
  if (!detailContract) {
    return (
      <DataTableRenderer
        pages={pages}
        columns={columns}
        title={title}
        source={source}
        data={data}
        annotationLayers={annotationLayers}
        permissionsPolicies={permissionsPolicies}
        schemaSpec={schemaSpec}
      />
    );
  }

  if (view === 'detail' && selectedRow && detailSchema && detailRole) {
    // Build default values from the selected row's data
    const defaultValues = (selectedRow.rawData ?? selectedRow.values) as Record<string, unknown>;
    // For API-source rows, the raw data object may be richer than column values
    const rowLabel = selectedRow.values[columns[0]?.from] ?? `Row ${selectedRow.idx}`;

    return (
      <div className="grid-container" style={{ maxWidth: '100%', padding: '1rem' }}>
        <BreadcrumbBar>
          <Breadcrumb>
            <BreadcrumbLink href="#" onClick={handleBackToList}>
              {title ?? 'List'}
            </BreadcrumbLink>
          </Breadcrumb>
          <Breadcrumb current>{rowLabel}</Breadcrumb>
        </BreadcrumbBar>
        <FormRenderer
          contract={detailContract}
          schema={detailSchema}
          role={detailRole}
          hideChrome
          defaultValues={defaultValues}
        />
      </div>
    );
  }

  return (
    <DataTableRenderer
      pages={pages}
      columns={columns}
      title={title}
      source={source}
      data={data}
      onRowClick={handleRowClick}
      annotationLayers={annotationLayers}
      permissionsPolicies={permissionsPolicies}
      schemaSpec={schemaSpec}
    />
  );
}
