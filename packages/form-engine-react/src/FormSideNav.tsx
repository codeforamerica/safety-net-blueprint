import React from 'react';
import { SideNav } from '@trussworks/react-uswds';
import type { Page } from './types';

interface FormSideNavProps {
  pages: Page[];
  currentPage: number;
  onPageSelect: (index: number) => void;
}

export function FormSideNav({ pages, currentPage, onPageSelect }: FormSideNavProps) {
  const items = pages.map((page, index) => (
    <a
      key={page.id}
      href={`#${page.id}`}
      className={index === currentPage ? 'usa-current' : undefined}
      onClick={(e) => {
        e.preventDefault();
        onPageSelect(index);
      }}
    >
      {page.title}
    </a>
  ));

  return <SideNav items={items} />;
}
