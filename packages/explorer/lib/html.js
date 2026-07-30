/**
 * Shared HTML helpers for all explorer build scripts.
 */

import { COLORS, FONT } from './theme.js';

/** Escape HTML special characters. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert kebab-case or snake_case to Title Case. */
export function titleCase(str) {
  return String(str ?? '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Render a breadcrumb bar.
 * @param {Array<{label: string, href?: string}>} segments
 *   Last segment is always rendered as plain text (current page).
 */
export function breadcrumb(segments) {
  const sep = `<span style="opacity:0.5;">/</span>`;
  const parts = segments.map((seg, i) => {
    const isLast = i === segments.length - 1;
    if (isLast || !seg.href) {
      return `<span style="color:${COLORS.white};">${esc(seg.label)}</span>`;
    }
    return `<a href="${seg.href}" style="color:${COLORS.lightBlue};text-decoration:none;">${esc(seg.label)}</a>`;
  });
  return `<div style="background:${COLORS.darkBlue};padding:0.5rem 1.25rem;display:flex;align-items:center;gap:0.5rem;font-size:12px;font-family:${FONT};color:${COLORS.lightBlue};">${parts.join(sep)}</div>`;
}

/** Render a status badge for lifecycle phase status values. */
export function statusBadge(status) {
  if (status === 'implemented') {
    return `<span style="font-size:9px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:1px 6px;border-radius:100px;flex-shrink:0;background:rgba(0,173,147,0.25);color:#7ffff0;border:1px solid rgba(0,173,147,0.4);">Complete</span>`;
  }
  if (status === 'in-progress') {
    return `<span style="font-size:9px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:1px 6px;border-radius:100px;flex-shrink:0;background:rgba(194,192,232,0.2);color:${COLORS.lightBlue};border:1px solid rgba(194,192,232,0.3);">In progress</span>`;
  }
  return `<span style="font-size:9px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:1px 6px;border-radius:100px;flex-shrink:0;background:rgba(233,204,190,0.15);color:#c8b0a0;border:1px solid rgba(233,204,190,0.25);">Planned</span>`;
}
