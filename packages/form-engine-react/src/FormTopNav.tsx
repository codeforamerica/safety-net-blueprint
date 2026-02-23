import React, { useState } from 'react';
import { Header, PrimaryNav, NavMenuButton } from '@trussworks/react-uswds';
import type { Page } from './types';

interface FormTopNavProps {
  pages: Page[];
  currentPage: number;
  onPageSelect: (index: number) => void;
}

export function FormTopNav({ pages, currentPage, onPageSelect }: FormTopNavProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const handleToggleMobile = () => {
    setMobileExpanded((prev) => !prev);
  };

  const items = pages.map((page, index) => (
    <a
      key={page.id}
      href={`#${page.id}`}
      className={index === currentPage ? 'usa-nav__link usa-current' : 'usa-nav__link'}
      onClick={(e) => {
        e.preventDefault();
        onPageSelect(index);
        setMobileExpanded(false);
      }}
    >
      <span>{page.title}</span>
    </a>
  ));

  return (
    <Header basic showMobileOverlay={mobileExpanded}>
      <div className="usa-nav-container">
        <div className="usa-navbar">
          <NavMenuButton onClick={handleToggleMobile} label="Menu" />
        </div>
        <PrimaryNav
          items={items}
          mobileExpanded={mobileExpanded}
          onToggleMobileNav={handleToggleMobile}
        />
      </div>
    </Header>
  );
}
