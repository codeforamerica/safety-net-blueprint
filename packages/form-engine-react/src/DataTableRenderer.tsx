import React, { useState, useMemo, useCallback } from 'react';
import { Table } from '@trussworks/react-uswds';
import type {
  Page,
  ReferenceColumn,
  PermissionsPolicy,
  AnnotationLayer,
  DataTableSource,
} from './types';
import {
  resolveContractRows,
  sortRows,
  type ResolvedRow,
  type SortDirection,
} from './data-table-resolvers';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DataTableRendererProps {
  pages: Page[];
  columns: ReferenceColumn[];
  title?: string;
  source?: DataTableSource;
  // source: contract props
  annotationLayers?: AnnotationLayer[];
  permissionsPolicies?: PermissionsPolicy[];
  schemaSpec?: Record<string, unknown>;
  // source: api props (future — #79)
  data?: Record<string, unknown>[];
  /** Callback when a row is clicked (used by master-detail navigation). */
  onRowClick?: (row: ResolvedRow) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataTableRenderer({
  pages,
  columns,
  title,
  source = 'contract',
  annotationLayers = [],
  permissionsPolicies = [],
  schemaSpec,
  data,
  onRowClick,
}: DataTableRendererProps) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // Pre-resolve every row with all column values
  const allRows = useMemo<ResolvedRow[]>(() => {
    if (source === 'api' && data) {
      // API source: map data rows directly to column values by key
      return data.map((row, idx) => ({
        idx,
        field: { ref: String(idx), component: 'text-input' as const },
        fullRef: String(idx),
        pageId: '',
        pageTitle: '',
        values: Object.fromEntries(
          columns.map((col) => [col.from, String(row[col.from] ?? '')]),
        ),
        rawData: row,
      }));
    }
    return resolveContractRows(pages, columns, annotationLayers, permissionsPolicies, schemaSpec);
  }, [source, pages, columns, annotationLayers, schemaSpec, permissionsPolicies, data]);

  // Global sorted view (null = no sort, use page grouping)
  const displayRows = useMemo<ResolvedRow[] | null>(() => {
    if (!sortCol) return null;
    return sortRows(allRows, sortCol, sortDir);
  }, [allRows, sortCol, sortDir]);

  const handleSort = useCallback((colFrom: string) => {
    setSortCol((prev) => {
      if (prev === colFrom) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return colFrom;
    });
  }, []);

  const clearSort = useCallback(() => {
    setSortCol(null);
    setSortDir('asc');
  }, []);

  if (columns.length === 0) {
    return <p>No columns configured in this data table.</p>;
  }

  const fieldCount = allRows.length;

  return (
    <div className="grid-container" style={{ maxWidth: '100%', padding: '1rem' }}>
      {title && <h1 className="margin-bottom-1">{title}</h1>}
      <p className="text-base margin-top-0 margin-bottom-3">
        {source === 'api' ? `${fieldCount} records` : `${fieldCount} fields across ${pages.length} sections`}
        {sortCol && (
          <button
            onClick={clearSort}
            className="margin-left-2 bg-transparent border-1px border-base radius-sm text-base font-sans-3xs padding-y-2px padding-x-1 cursor-pointer"
          >
            Clear sort
          </button>
        )}
      </p>

      <Table bordered striped compact className="font-sans-2xs">
        <thead>
          <tr>
            {columns.map((col) => {
              const active = sortCol === col.from;
              const arrow = active ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';
              return (
                <th
                  key={col.from}
                  role="columnheader"
                  aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  onClick={() => handleSort(col.from)}
                  style={{
                    whiteSpace: 'nowrap',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {col.label}{arrow}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {displayRows || source === 'api'
            ? (displayRows ?? allRows).map((row) => (
                <FieldRow key={row.idx} row={row} columns={columns} onClick={onRowClick} />
              ))
            : pages.map((page) => (
                <React.Fragment key={page.id}>
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="bg-ink text-white text-bold padding-y-1 padding-x-105 font-sans-xs"
                    >
                      {page.title}
                    </td>
                  </tr>
                  {allRows
                    .filter((r) => r.pageId === page.id)
                    .map((row) => (
                      <FieldRow key={row.idx} row={row} columns={columns} onClick={onRowClick} />
                    ))}
                </React.Fragment>
              ))
          }
        </tbody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

function FieldRow({
  row,
  columns,
  onClick,
}: {
  row: ResolvedRow;
  columns: ReferenceColumn[];
  onClick?: (row: ResolvedRow) => void;
}) {
  const isFieldArray = row.field.component === 'field-array';
  const clickable = !!onClick;

  const handleKeyDown = clickable
    ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(row);
        }
      }
    : undefined;

  const rowClass = [
    isFieldArray ? 'bg-base-lightest text-bold' : '',
    clickable ? 'cursor-pointer' : '',
  ].filter(Boolean).join(' ');

  return (
    <tr
      className={rowClass || undefined}
      onClick={clickable ? () => onClick(row) : undefined}
      onKeyDown={handleKeyDown}
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? 'link' : undefined}
      aria-label={clickable ? `View details for ${row.values[columns[0]?.from] ?? `row ${row.idx}`}` : undefined}
    >
      {columns.map((col) => {
        const value = row.values[col.from] ?? '';
        const parts = col.from.split('.');
        const isProgram = parts[0] === 'annotation' && parts.length >= 4 && parts[2] === 'programs';

        return (
          <td
            key={col.from}
            style={{
              padding: '6px 10px',
              whiteSpace: isProgram ? 'nowrap' : undefined,
            }}
          >
            {value}
          </td>
        );
      })}
    </tr>
  );
}
