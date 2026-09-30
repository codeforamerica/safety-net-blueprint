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
  const pairsHtml = pairs.map(([label, value, href]) => {
    const inner = href
      ? `<a href="${href}" style="color:rgba(255,255,255,0.8);text-decoration:none;"><code style="${c}">${esc(value)}</code></a>`
      : `<code style="${c}">${esc(value)}</code>`;
    return `${label}: ${inner}`;
  }).join(' · ');
  const trailing = trailingHtml ? `<span style="margin-left:auto;">${trailingHtml}</span>` : '';
  return `<div style="padding:0.2rem 1.25rem 0.45rem;font-size:11px;color:rgba(255,255,255,0.5);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">Domain: <code style="${c}">${esc(domain)}</code> · ${pairsHtml}${trailing}</div>`;
}

// ── Cross-artifact URL helpers ─────────────────────────────────────────────────
// One function per artifact type. Call sites pass a relative base so each page
// can resolve links from its own output location.

/** Compute the anchor ID for an API endpoint. */
export function apiEndpointSlug(method, path) {
  return `op-${method.toLowerCase()}-${path.replace(/\//g, '-').replace(/[{}]/g, '').replace(/--+/g, '-').replace(/^-|-$/g, '')}`;
}

/** URL to an annotations-explorer entry. */
export function annotationsExplorerHref(field, entryId, base = '../annotations-explorer') {
  const typeSlug = field.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const entrySlug = String(entryId).replace(/[^a-z0-9]/gi, '-').toLowerCase();
  return `${base}/${typeSlug}.html#entry--${entrySlug}`;
}

/** URL to a data-dictionary field entry. */
export function dataDictFieldHref(domain, fieldPath, base = '../data-dictionaries') {
  return `${base}/${domain}.html#field-${encodeURIComponent(fieldPath)}`;
}

/** URL to an API reference endpoint. */
export function apiReferenceHref(domain, method, path, base = '../api-reference') {
  return `${base}/${domain}.html#${apiEndpointSlug(method, path)}`;
}

/** URL to a state-machine-docs action. */
export function stateMachineDocsHref(domain, actionId, base = '../state-machine-docs') {
  return `${base}/${domain}.html#action-${actionId}`;
}

/** URL to a rules-docs ruleset page, optionally anchored to a fact. */
export function rulesDocsHref(domain, ruleset, factName = null, base = '../rules-docs') {
  return `${base}/${domain}-${ruleset}.html${factName ? `#fact-${factName}` : ''}`;
}

/** URL to an event-catalog entry. */
export function eventCatalogHref(eventKey, base = '../event-catalog') {
  return `${base}/index.html#event-${eventKey}`;
}

// ── Cross-artifact link renderers ──────────────────────────────────────────────
// One function per link style. Styling is preserved exactly as-is per artifact.
// Pass an href from the URL helpers above; optionally pass extraStyle for
// caller-specific layout adjustments (margin, flex-shrink, font-size overrides).

const _relBadge = `font-size:10px;border:1px solid;border-radius:3px;padding:1px 6px;text-decoration:none;white-space:nowrap;`;

/** Monospace field-name link with underline on hover (API reference → data dictionary). */
export function fieldNameLink(name, href) {
  return `<a href="${esc(href)}" style="font-family:monospace;font-size:12px;font-weight:600;color:${COLORS.text};text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${esc(name)}</a>`;
}

/** Purple badge link to a state machine action. */
export function stateMachineLink(href, title = '', extraStyle = '') {
  const titleAttr = title ? ` title="${esc(title)}"` : '';
  return `<a href="${esc(href)}"${titleAttr} style="${_relBadge}background:#f0ecff;border-color:#d4c5f5;color:#6b4fa8;${extraStyle}">State machine →</a>`;
}

/** Blue badge link to a rules-docs page. */
export function rulesLink(href, title = '', extraStyle = '') {
  const titleAttr = title ? ` title="${esc(title)}"` : '';
  return `<a href="${esc(href)}"${titleAttr} style="${_relBadge}background:#f0f7ff;border-color:#bfdbfe;color:#1d4ed8;${extraStyle}">Rules →</a>`;
}

/** Blue badge link to an API reference page. */
export function apiReferenceLink(href, label = 'API ref →', extraStyle = '', title = '') {
  const titleAttr = title ? ` title="${esc(title)}"` : '';
  return `<a href="${esc(href)}"${titleAttr} style="${_relBadge}background:${COLORS.paleBlue};border-color:${COLORS.lightBlue};color:${COLORS.midBlue};${extraStyle}">${esc(label)}</a>`;
}

/**
 * Render a section+key usage chip linking to the artifact page where that annotation is used.
 * Used in the annotations explorer to show where each annotation entry appears.
 *
 * @param {string} section - annotation section (e.g. 'schema', 'operations', 'facts', 'events')
 * @param {string} key     - annotation key (e.g. 'application.submittedAt')
 * @param {string|null} href - link target, or null for an unlinked chip
 */
export function usageChip(section, key, href) {
  const inner =
    `<span style="padding:1px 5px;background:#e8ecf5;color:${COLORS.midBlue};font-size:10px;font-weight:600;border-right:1px solid ${COLORS.sandDark};">${esc(section)}</span>` +
    `<code style="padding:1px 6px;background:#f8f9fc;font-size:11px;">${esc(key)}</code>`;
  const chipStyle = `display:inline-flex;align-items:center;gap:0;border:1px solid ${COLORS.sandDark};border-radius:4px;overflow:hidden;text-decoration:none;color:inherit;`;
  if (href) {
    return `<a href="${esc(href)}" style="${chipStyle}" onmouseover="this.style.borderColor='${COLORS.midBlue}'" onmouseout="this.style.borderColor='${COLORS.sandDark}'">${inner}</a>`;
  }
  return `<span style="${chipStyle}">${inner}</span>`;
}

/**
 * Render an array of annotation entry IDs as linked chips pointing to the annotations explorer.
 * Consuming pages must define CSS for the 'ann-chip' class.
 *
 * @param {string} field - annotation field name (e.g. 'programs', 'policies')
 * @param {string[]} values - array of entry IDs
 * @param {string} explorerBase - relative URL to the annotations-explorer directory
 * @param {function} [labelFn] - optional label transform, defaults to identity
 */
export function annotationChips(field, values, explorerBase, labelFn = v => String(v)) {
  return values.map(v => {
    const href = annotationsExplorerHref(field, String(v), explorerBase);
    return `<a href="${esc(href)}" class="ann-chip">${esc(labelFn(v))}</a>`;
  }).join('');
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
