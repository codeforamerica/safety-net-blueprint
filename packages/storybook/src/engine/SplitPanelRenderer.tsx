import React, { useState } from 'react';
import type { ZodSchema } from 'zod';
import type { FormContract, Role, ViewMode, PermissionsPolicy } from './types';
import { FormRenderer } from './FormRenderer';
import { PageStepper } from './PageStepper';

interface SplitPanelRendererProps {
  contract: FormContract;
  schema: ZodSchema;
  role?: Role;
  panels: {
    left: { label: string; viewMode: ViewMode; data?: Record<string, unknown> };
    right: { label: string; viewMode: ViewMode; data?: Record<string, unknown> };
  };
  permissionsPolicy?: PermissionsPolicy;
  annotations?: Record<string, string[]>;
  onSubmit?: (data: Record<string, unknown>) => void;
}

export function SplitPanelRenderer({
  contract,
  schema,
  role = 'caseworker',
  panels,
  permissionsPolicy,
  annotations,
  onSubmit,
}: SplitPanelRendererProps) {
  const { pages } = contract.form;
  const [currentPage, setCurrentPage] = useState(0);

  const handleNext = () => {
    if (currentPage < pages.length - 1) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handleBack = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleSubmit = () => {
    onSubmit?.(panels.left.data ?? {});
  };

  return (
    <div className="grid-container">
      <h1>{contract.form.title}</h1>

      <PageStepper
        pages={pages}
        currentPage={currentPage}
        onNext={handleNext}
        onBack={handleBack}
        onSubmit={handleSubmit}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1.5rem',
          marginTop: '1rem',
        }}
      >
        {(['left', 'right'] as const).map((side) => {
          const panel = panels[side];
          return (
            <div key={side}>
              <h3
                style={{
                  borderBottom: '2px solid #005ea2',
                  paddingBottom: '0.5rem',
                  marginBottom: '1rem',
                  color: '#1b1b1b',
                }}
              >
                {panel.label}
              </h3>
              <FormRenderer
                contract={contract}
                schema={schema}
                role={role}
                viewMode={panel.viewMode}
                currentPage={currentPage}
                defaultValues={panel.data}
                permissionsPolicy={permissionsPolicy}
                annotations={annotations}
                onSubmit={onSubmit}
                hideChrome
                idPrefix={`${side}-`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
