import React from 'react';
import {
  StepIndicator,
  StepIndicatorStep,
  ButtonGroup,
  Button,
} from '@trussworks/react-uswds';
import type { Page } from './types';

interface PageStepperProps {
  pages: Page[];
  currentPage: number;
  onNext: () => void;
  onBack: () => void;
  onSubmit: () => void;
}

export function PageStepper({
  pages,
  currentPage,
  onNext,
  onBack,
  onSubmit,
}: PageStepperProps) {
  const isFirst = currentPage === 0;
  const isLast = currentPage === pages.length - 1;

  return (
    <>
      <StepIndicator headingLevel="h2">
        {pages.map((page, index) => {
          let status: 'current' | 'complete' | undefined;
          if (index === currentPage) status = 'current';
          else if (index < currentPage) status = 'complete';
          return (
            <StepIndicatorStep
              key={page.id}
              label={page.title}
              status={status}
            />
          );
        })}
      </StepIndicator>

      <ButtonGroup>
        {!isFirst && (
          <Button type="button" outline onClick={onBack}>
            Back
          </Button>
        )}
        {isLast ? (
          <Button type="button" onClick={onSubmit}>
            Submit
          </Button>
        ) : (
          <Button type="button" onClick={onNext}>
            Continue
          </Button>
        )}
      </ButtonGroup>
    </>
  );
}
