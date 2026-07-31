/**
 * Shared page layout helpers for all explorer build scripts.
 *
 * twoColumnPage() — dark sticky sidebar with search + active nav + scrollable main.
 *   Used by: api-reference domain pages, client-reference domain pages.
 *
 * singleColumnPage() — centered single-column layout.
 *   Used by: event-catalog, state-machine-docs, index pages.
 *
 * Nav markup conventions for twoColumnPage:
 *   - Nav links:       <a class="nav-link" href="#some-id">...</a>
 *   - Section groups:  <div class="nav-section">
 *                        <div class="nav-section-label">Label</div>
 *                        <a class="nav-link" ...>...</a>
 *                      </div>
 *   Active highlighting and search filtering are applied automatically.
 *
 * Content markup conventions for twoColumnPage:
 *   - Top-level anchored sections: <section id="some-id"> or <div id="some-id">
 *     must match the href="#some-id" in nav links so IntersectionObserver can
 *     highlight the correct nav item.
 */

import { COLORS, FONT } from './theme.js';
import { breadcrumb as renderBreadcrumb } from './html.js';

// ── Two-column page ───────────────────────────────────────────────────────────

/**
 * @param {object}  opts
 * @param {string}  opts.title          <title> text
 * @param {Array}   opts.breadcrumbs    [{label, href?}] passed to breadcrumb()
 * @param {string}  opts.headerHtml     content of dark title bar below breadcrumb
 * @param {string}  opts.navHtml        sidebar content (use nav-link / nav-section classes)
 * @param {string}  opts.mainHtml       main scrollable content
 * @param {number} [opts.navWidth=260]  sidebar width in px
 * @param {boolean}[opts.navSearch]     add a search box that filters nav-link items
 * @param {string} [opts.extraStyle]    additional CSS
 * @param {string} [opts.extraScript]   additional JS (runs after shared scripts)
 */
export function twoColumnPage({
  title,
  breadcrumbs,
  headerHtml,
  navHtml,
  mainHtml,
  navWidth = 260,
  navSearch = false,
  extraStyle = '',
  extraScript = '',
}) {
  const searchHtml = navSearch ? `
      <div style="padding:0.5rem 0.75rem;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;">
        <input id="nav-search" type="search" placeholder="Filter…"
          style="width:100%;padding:0.3rem 0.5rem;border:1px solid rgba(255,255,255,0.2);border-radius:4px;background:rgba(255,255,255,0.1);color:white;font-size:0.75rem;outline:none;"
          aria-label="Filter navigation" />
      </div>` : '';

  const searchJs = navSearch ? `
    (function () {
      // Returns only text that is currently visible — skips content inside closed <details>
      function visibleText(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
        if (node.tagName === 'DETAILS' && !node.open) {
          const summary = node.querySelector('summary');
          return summary ? summary.textContent : '';
        }
        return [...node.childNodes].map(visibleText).join('');
      }
      function clearHighlights() {
        document.querySelectorAll('#content mark.search-hl').forEach(el => {
          const parent = el.parentNode;
          el.replaceWith(document.createTextNode(el.textContent));
          parent?.normalize();
        });
      }
      // Only highlight text in visible nodes (skip closed <details> bodies)
      function highlightInElement(root, q) {
        function walk(node) {
          if (node.tagName === 'DETAILS' && !node.open) {
            // Only walk the summary
            const summary = node.querySelector('summary');
            if (summary) walk(summary);
            return;
          }
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            const lower = text.toLowerCase();
            if (!lower.includes(q)) return;
            const frag = document.createDocumentFragment();
            let last = 0, idx = lower.indexOf(q);
            while (idx !== -1) {
              if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
              const mark = document.createElement('mark');
              mark.className = 'search-hl';
              mark.textContent = text.slice(idx, idx + q.length);
              frag.appendChild(mark);
              last = idx + q.length;
              idx = lower.indexOf(q, last);
            }
            if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
            node.parentNode.replaceChild(frag, node);
            return;
          }
          for (const child of [...node.childNodes]) walk(child);
        }
        walk(root);
      }
      document.getElementById('nav-search')?.addEventListener('input', function () {
        const q = this.value.trim().toLowerCase();
        clearHighlights();
        document.querySelectorAll('#sidebar .nav-link[href^="#"]').forEach(a => {
          const id = a.getAttribute('href').slice(1);
          const el = document.getElementById(id);
          const items = el ? [...el.querySelectorAll('.content-item')] : [];
          const navMatches = !q || a.textContent.toLowerCase().includes(q);
          const anyItemMatches = q && items.some(item => visibleText(item).toLowerCase().includes(q));
          // Section visible if nav label matches, any item matches, or (no items) visible section text matches
          const sectionMatches = !q || navMatches || anyItemMatches ||
            (el && !items.length && visibleText(el).toLowerCase().includes(q));
          a.style.display = sectionMatches ? '' : 'none';
          if (el) {
            el.style.display = sectionMatches ? '' : 'none';
            if (items.length > 0) {
              items.forEach(item => {
                // Show all items when nav label matched; otherwise filter by visible text only
                item.style.display = (!q || navMatches || visibleText(item).toLowerCase().includes(q)) ? '' : 'none';
              });
            }
          }
        });
        document.querySelectorAll('#sidebar .nav-section').forEach(sec => {
          const any = [...sec.querySelectorAll('.nav-link')].some(a => a.style.display !== 'none');
          sec.style.display = any ? '' : 'none';
        });
        if (q) {
          // Highlight within visible content items; fall back to top-level id'd sections without content items
          document.querySelectorAll('#content .content-item:not([style*="display: none"])').forEach(el => highlightInElement(el, q));
          document.querySelectorAll('#content > *[id]:not([style*="display: none"])').forEach(el => {
            if (!el.querySelector('.content-item')) highlightInElement(el, q);
          });
        }
      });
    })();` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body { font-family: ${FONT}; background: ${COLORS.bg}; color: ${COLORS.text}; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    details summary::-webkit-details-marker { display: none; }

    /* Full-viewport layout: header pinned, sidebar + content fill remaining height */
    #page-header { flex-shrink: 0; }
    .page-layout { display: flex; flex: 1; min-height: 0; overflow: hidden; }
    #sidebar {
      width: ${navWidth}px;
      min-width: ${navWidth}px;
      background: ${COLORS.darkBlue};
      color: white;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #sidebar-nav { padding: 0.5rem 0; overflow-y: auto; flex: 1; min-height: 0; }
    #content { flex: 1; min-width: 0; padding: 2rem 2.5rem 4rem; overflow-y: auto; }
    mark.search-hl { background: #fff176; color: inherit; border-radius: 2px; padding: 0 1px; }
    #content [id]:target { scroll-margin-top: 1rem; outline: none; box-shadow: none; }

    /* Nav links */
    a.nav-link {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      padding: 4px 0.75rem; font-size: 11px;
      color: rgba(255,255,255,0.65); text-decoration: none;
      transition: background 0.1s;
    }
    a.nav-link:hover { background: rgba(255,255,255,0.08); color: white; }
    a.nav-link.nav-active { background: rgba(255,255,255,0.15); color: white; font-weight: 700; }
    /* Make inline code readable on the dark sidebar */
    #sidebar a.nav-link code {
      color: rgba(255,255,255,0.55); background: transparent; border: none; font-size: 10px;
    }
    .nav-section-label {
      font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
      color: rgba(255,255,255,0.35); padding: 0.75rem 0.75rem 0.2rem;
    }
    .nav-count {
      font-size: 0.65rem; font-weight: 400;
      background: rgba(255,255,255,0.15); border-radius: 8px;
      padding: 0.1rem 0.35rem; margin-left: auto;
    }

    /* Interactive element hover states — applied centrally so all tools get consistent behavior */
    .content-item { transition: border-color 0.1s, background 0.1s; }
    .content-item:hover { border-color: ${COLORS.midBlue}; background: ${COLORS.paleBlue}; }
    details summary { transition: background 0.1s; }
    details summary:hover { background: ${COLORS.sandMid}; }
    [data-expand-id] { transition: opacity 0.1s; }
    [data-expand-id]:hover { opacity: 0.75; }
    ${extraStyle}
  </style>
</head>
<body>
  <div id="page-header">
    ${renderBreadcrumb(breadcrumbs)}
    ${headerHtml}
  </div>
  <div class="page-layout">
    <nav id="sidebar">
      ${searchHtml}
      <div id="sidebar-nav">
        ${navHtml}
      </div>
    </nav>
    <main id="content">
      ${mainHtml}
    </main>
  </div>
  <script>
    // Chevron toggle for <details> — set initial state and keep in sync on toggle
    document.querySelectorAll('details').forEach(d => {
      const ch = d.querySelector('.chevron');
      if (ch) ch.textContent = d.open ? '\u25BC' : '\u25B6';
      d.addEventListener('toggle', () => {
        const ch = d.querySelector('.chevron');
        if (ch) ch.textContent = d.open ? '\u25BC' : '\u25B6';
      });
    });
    // data-expand-id toggles — click any [data-expand-id] element to show/hide the
    // element with the matching id. Works for any target element type (<div>, <tr>, etc.)
    document.querySelectorAll('[data-expand-id]').forEach(btn => {
      const target = document.getElementById(btn.getAttribute('data-expand-id'));
      if (!target) return;
      btn.addEventListener('click', () => {
        const visible = target.style.display !== 'none';
        target.style.display = visible ? 'none' : '';
        const ch = btn.querySelector('.chevron, .chip-arrow');
        if (ch) ch.textContent = visible ? '\u25B6' : '\u25BC';
      });
    });
    // Active nav highlighting — click sets immediately; IntersectionObserver keeps it current on scroll
    (function () {
      const links = Array.from(document.querySelectorAll('#sidebar a.nav-link[href^="#"]'));
      if (!links.length) return;
      function setActive(id) {
        links.forEach(a => a.classList.toggle('nav-active', a.getAttribute('href') === '#' + id));
      }
      // Highlight immediately on click so there's instant feedback
      links.forEach(a => a.addEventListener('click', () => setActive(a.getAttribute('href').slice(1))));
      const sections = links
        .map(a => document.getElementById(a.getAttribute('href').slice(1)))
        .filter(Boolean);
      if (!sections.length) return;
      const io = new IntersectionObserver(entries => {
        const hit = entries.find(e => e.isIntersecting);
        if (hit) setActive(hit.target.id);
      }, { root: document.getElementById('content'), rootMargin: '0px 0px -70% 0px', threshold: 0 });
      sections.forEach(s => io.observe(s));
      setActive(sections[0].id);
    })();
    ${searchJs}
    ${extraScript}
  </script>
</body>
</html>`;
}

// ── Single-column page ────────────────────────────────────────────────────────

/**
 * @param {object}  opts
 * @param {string}  opts.title
 * @param {Array}   opts.breadcrumbs    [{label, href?}]
 * @param {string}  opts.bodyHtml       content rendered after breadcrumb, inside <body>
 * @param {string} [opts.extraStyle]    additional CSS
 * @param {string} [opts.extraScript]   JS — omit the <script> tags
 */
export function singleColumnPage({
  title,
  breadcrumbs,
  bodyHtml,
  extraStyle = '',
  extraScript = '',
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${FONT}; background: ${COLORS.bg}; color: ${COLORS.text}; font-size: 14px; line-height: 1.6; }
    a { color: ${COLORS.midBlue}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 12px; background: ${COLORS.sandMid}; padding: 1px 5px; border-radius: 3px; border: 1px solid ${COLORS.sandDark}; color: #2a2a2a; }
    table { border-collapse: collapse; width: 100%; }
    th { background: ${COLORS.sandMid}; color: ${COLORS.text}; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; padding: 8px 12px; text-align: left; border-bottom: 2px solid ${COLORS.sandDark}; }
    td { padding: 10px 12px; border-bottom: 1px solid ${COLORS.sandDark}; vertical-align: top; font-size: 13px; word-break: break-word; overflow-wrap: anywhere; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: ${COLORS.sandMid}; }
    .content-item { transition: border-color 0.1s, background 0.1s; }
    .content-item:hover { border-color: ${COLORS.midBlue}; background: ${COLORS.paleBlue}; }
    details summary { transition: background 0.1s; }
    details summary:hover { background: ${COLORS.sandMid}; }
    [data-expand-id] { transition: opacity 0.1s; }
    [data-expand-id]:hover { opacity: 0.75; }
    ${extraStyle}
  </style>
</head>
<body>
  ${renderBreadcrumb(breadcrumbs)}
  ${bodyHtml}
  <script>
    document.querySelectorAll('[data-expand-id]').forEach(btn => {
      const target = document.getElementById(btn.getAttribute('data-expand-id'));
      if (!target) return;
      btn.addEventListener('click', () => {
        const visible = target.style.display !== 'none';
        target.style.display = visible ? 'none' : '';
        const ch = btn.querySelector('.chevron, .chip-arrow');
        if (ch) ch.textContent = visible ? '\u25B6' : '\u25BC';
      });
    });
    ${extraScript}
  </script>
</body>
</html>`;
}
