import React, { useState } from 'react';
import type { ZodSchema } from 'zod';
import type { FormContract, Role, ViewMode, PermissionsPolicy } from './types';
import { FormRenderer } from './FormRenderer';
import { PageStepper } from './PageStepper';
import { FormSideNav } from './FormSideNav';
import { resolveLayout } from './layout-utils';

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
  const { pages, layout } = contract.form;
  const config = resolveLayout(layout);
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

  const handlePageSelect = (index: number) => {
    setCurrentPage(index);
  };

  const handleSubmit = () => {
    onSubmit?.(panels.left.data ?? {});
  };

  const panelContent = (
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
        const otherSide = side === 'left' ? 'right' : 'left';
        const otherPanel = panels[otherSide];
        // Only pass compareValues to the editable panel so only it shows diff highlights
        const compareValues =
          panel.viewMode === 'editable' ? otherPanel.data : undefined;
        return (
          <div key={side}>
            <h3
              className="border-bottom-2px border-primary padding-bottom-1 margin-bottom-2 text-ink"
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
              compareValues={compareValues}
            />
          </div>
        );
      })}
    </div>
  );

  if (config.navigation === 'side-nav') {
    return (
      <div className="grid-container">
        <h1>{contract.form.title}</h1>
        <div className="grid-row grid-gap">
          <div className="grid-col-2">
            <FormSideNav
              pages={pages}
              currentPage={currentPage}
              onPageSelect={handlePageSelect}
            />
          </div>
          <div className="grid-col-10">
            {panelContent}
          </div>
        </div>
      </div>
    );
  }

  if (config.navigation === 'step-indicator') {
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
        {panelContent}
      </div>
    );
  }

  // navigation: 'none' or 'in-page'
  return (
    <div className="grid-container">
      <h1>{contract.form.title}</h1>
      {panelContent}
    </div>
  );
}
