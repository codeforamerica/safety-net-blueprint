/**
 * Shared HTML helpers for all explorer build scripts.
 */

import { COLORS, FONT } from './theme.js';

export const METHOD_STYLE = {
  get:     { bg: COLORS.lightGreen,  color: COLORS.deepGreen, border: COLORS.midGreen },
  post:    { bg: COLORS.paleBlue,    color: COLORS.darkBlue,  border: COLORS.midBlue  },
  patch:   { bg: COLORS.lightYellow, color: '#7A4800',        border: COLORS.warmYellow },
  put:     { bg: COLORS.lightYellow, color: '#7A4800',        border: COLORS.warmYellow },
  delete:  { bg: COLORS.lightRed,    color: '#7B0A11',        border: COLORS.richRed  },
  head:    { bg: '#f0f0f0',          color: '#444',           border: '#ccc' },
  options: { bg: '#f0f0f0',          color: '#444',           border: '#ccc' },
};

export const TYPE_STYLE = {
  string:  { bg: COLORS.lightGreen,  color: COLORS.deepGreen },
  integer: { bg: COLORS.paleBlue,    color: COLORS.darkBlue  },
  number:  { bg: COLORS.paleBlue,    color: COLORS.darkBlue  },
  boolean: { bg: COLORS.lightYellow, color: '#7A4800'        },
  object:  { bg: COLORS.sandMid,     color: '#6B3A2A'        },
  array:   { bg: COLORS.sandMid,     color: '#6B3A2A'        },
};

/** Render a colored HTTP method badge. */
export function methodBadge(method) {
  const m = method.toLowerCase();
  const c = METHOD_STYLE[m] ?? { bg: '#f0f0f0', color: '#444', border: '#ccc' };
  return `<span style="font-size:9.5px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;padding:2px 7px;border-radius:3px;background:${c.bg};color:${c.color};border:1px solid ${c.border};flex-shrink:0;font-family:${FONT};">${esc(method.toUpperCase())}</span>`;
}

/** Render a colored schema type badge. */
export function typeBadge(type) {
  const base = type.startsWith('array') ? 'array' : type;
  const c = TYPE_STYLE[base] ?? { bg: '#f0f0f0', color: '#555' };
  return `<span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;background:${c.bg};color:${c.color};font-family:monospace;">${esc(type)}</span>`;
}

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
    if (isLast) {
      return `<a href="#" style="color:${COLORS.white};text-decoration:none;">${esc(seg.label)}</a>`;
    }
    if (!seg.href) {
      return `<span style="color:${COLORS.white};">${esc(seg.label)}</span>`;
    }
    return `<a href="${seg.href}" style="color:${COLORS.lightBlue};text-decoration:none;">${esc(seg.label)}</a>`;
  });
  return `<div style="background:${COLORS.darkBlue};padding:0.5rem 1.25rem;display:flex;align-items:center;gap:0.5rem;font-size:12px;font-family:${FONT};color:${COLORS.lightBlue};">${parts.join(sep)}</div>`;
}

// ── Inline expand helpers ──────────────────────────────────────────────────

let _expandSerial = 0;
/** Allocate a unique expand ID for a chip/expand pair. */
export function nextEid() { return `exp-${_expandSerial++}`; }

/**
 * Render a pre-hidden expand block paired with a chip.
 * @param {string} eid        - ID from nextEid()
 * @param {string} contentHtml - inner HTML to show when expanded
 * @param {string} [style]    - additional inline CSS on the wrapper
 */
export function expandHidden(eid, contentHtml, style = '') {
  return `<div id="${eid}" style="display:none;border:1px solid #e0e0e0;border-radius:4px;overflow:hidden;background:#fff;${style}">${contentHtml}</div>`;
}

/** Render a chip that toggles an expand block via data-expand-id. No href — expands inline only. */
export function expandChip(label, eid, chipStyle) {
  return `<span role="button" tabindex="0" data-expand-id="${eid}" style="${chipStyle}cursor:pointer;"><span class="chip-arrow" style="font-size:9px;opacity:0.7;">&#x25B6;</span> ${label}</span>`;
}

/** Inline &lt;code&gt; style for use inside dark header bars. */
export const HEADER_CODE_STYLE = `color:rgba(255,255,255,0.8);background:rgba(255,255,255,0.12);border:none;border-radius:3px;padding:0 4px;font-size:10px;`;

/**
 * Render the dark-bar metadata subtitle row shown below the page title.
 * @param {string} domain - domain slug
 * @param {Array<[string, string]>} pairs - [label, displayValue] tuples, e.g. [['API spec', 'packages/generated/intake-openapi.yaml']]
 * @param {string} [trailingHtml] - optional HTML pushed to the right edge (e.g. a cross-link)
 */
export function headerMetaSubtitle(domain, pairs, trailingHtml = '') {
  const c = HEADER_CODE_STYLE;
  const pairsHtml = pairs.map(([label, value]) => `${label}: <code style="${c}">${esc(value)}</code>`).join(' · ');
  const trailing = trailingHtml ? `<span style="margin-left:auto;">${trailingHtml}</span>` : '';
  return `<div style="padding:0.2rem 1.25rem 0.45rem;font-size:11px;color:rgba(255,255,255,0.5);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">Domain: <code style="${c}">${esc(domain)}</code> · ${pairsHtml}${trailing}</div>`;
}

/** Render a status badge for lifecycle phase status values. */
export function statusBadge(status) {
  const base = `font-size:9px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:1px 6px;border-radius:100px;flex-shrink:0;`;
  if (status === 'implemented') {
    return `<span style="${base}background:rgba(0,173,147,0.25);color:#7ffff0;border:1px solid rgba(0,173,147,0.4);">Complete</span>`;
  }
  if (status === 'in-progress') {
    return `<span style="${base}background:rgba(194,192,232,0.2);color:${COLORS.lightBlue};border:1px solid rgba(194,192,232,0.3);">In progress</span>`;
  }
  if (status === 'stable') {
    return `<span style="${base}background:rgba(0,173,147,0.15);color:#5fcfb8;border:1px solid rgba(0,173,147,0.3);">Stable</span>`;
  }
  if (status === 'beta') {
    return `<span style="${base}background:rgba(90,120,220,0.15);color:#8aaaf0;border:1px solid rgba(90,120,220,0.3);">Beta</span>`;
  }
  if (status === 'alpha') {
    return `<span style="${base}background:rgba(194,192,232,0.12);color:#b0a8d8;border:1px solid rgba(194,192,232,0.2);">Alpha</span>`;
  }
  return `<span style="${base}background:rgba(233,204,190,0.15);color:#c8b0a0;border:1px solid rgba(233,204,190,0.25);">Planned</span>`;
}
