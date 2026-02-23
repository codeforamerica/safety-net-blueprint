import React, { useState, useEffect, useRef } from 'react';
import type { Page } from './types';

interface FormInPageNavProps {
  pages: Page[];
}

/**
 * Sticky right-side "On this page" table of contents.
 * Uses IntersectionObserver to highlight the current section
 * and scrollIntoView on click (no anchor links, so it works in Storybook iframes).
 */
export function FormInPageNav({ pages }: FormInPageNavProps) {
  const [activeId, setActiveId] = useState(pages[0]?.id ?? '');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '0px 0px -60% 0px', threshold: 0 },
    );

    for (const page of pages) {
      const el = document.getElementById(page.id);
      if (el) observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [pages]);

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
    }
  };

  return (
    <nav className="usa-in-page-nav" aria-label="On this page">
      <h4 className="usa-in-page-nav__heading">On this page</h4>
      <ul className="usa-in-page-nav__list">
        {pages.map((page) => (
          <li key={page.id} className="usa-in-page-nav__item">
            <a
              href={`#${page.id}`}
              className={
                `usa-in-page-nav__link${activeId === page.id ? ' usa-current' : ''}`
              }
              onClick={(e) => {
                e.preventDefault();
                handleClick(page.id);
              }}
            >
              {page.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
