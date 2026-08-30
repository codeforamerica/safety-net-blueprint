#!/usr/bin/env node
/**
 * build-hub.js
 *
 * Generates <contentDir>/index.html.
 * Output tags on each card are discovered by scanning the tool/diagram output
 * directories — nothing is hard-coded.
 *
 * Usage:
 *   node build-hub.js [--content=<path>]
 *
 *   --content  Path to the content package (e.g. packages/safety-net-explorer).
 *              Contains config.yaml, diagrams/, and receives index.html output.
 *              Defaults to ../safety-net-explorer.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

const contentArg = process.argv.slice(2).find(a => a.startsWith('--content='));
const contentDir = contentArg
  ? resolve(process.cwd(), contentArg.slice('--content='.length))
  : resolve(__dirname, '..', '..', '..', '..', 'safety-net-explorer');

// ── Load content config ───────────────────────────────────────────────────────

const hubConfig     = yaml.load(readFileSync(join(contentDir, 'config.yaml'), 'utf8'));
const projectName   = hubConfig.name;
const githubUrl     = hubConfig.github;
const featuredLinks = hubConfig.featured_links ?? [];

// ── Directory scanning ────────────────────────────────────────────────────────

/**
 * Scan a directory for non-index HTML files and return sorted page entries.
 * @param {string} dir  Absolute path to scan.
 * @param {(slug: string) => string} labelFn  Slug → display label.
 */
function scanPages(dir, labelFn = defaultLabel) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.html') && f !== 'index.html')
    .map(f => ({ slug: f.replace('.html', ''), label: labelFn(f.replace('.html', '')) }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function defaultLabel(slug) {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Output tag HTML ───────────────────────────────────────────────────────────

function outputTags(pages, basePath, dotClass) {
  if (!pages.length) return '';
  const tags = pages.map(({ slug, label }) =>
    `            <a href="${basePath}/${slug}.html" class="output-tag">
              <span class="dot ${dotClass}"></span>${label}
            </a>`
  ).join('\n');
  return `
          <div class="card-outputs">
${tags}
          </div>`;
}

// Context map pages have a `domain_` prefix — strip it for the label
function contextMapLabel(slug) {
  return slug.replace(/^domain_/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Discover pages ────────────────────────────────────────────────────────────

const apiPages     = scanPages(join(contentDir, 'api-reference'));
const dictPages    = scanPages(join(contentDir, 'data-dictionaries'));
const clientPages  = scanPages(join(contentDir, 'client-reference'));
const smPages      = scanPages(join(contentDir, 'state-machine-docs'));
const contextPages = scanPages(join(contentDir, 'context-map'), contextMapLabel)
  .filter(p => p.slug.startsWith('domain_'));
const seqPages     = scanPages(join(contentDir, 'sequence-diagrams'));

// ── Featured links HTML ───────────────────────────────────────────────────────

const featuredLinksHtml = featuredLinks.length ? `
    <div style="margin-top:1.5rem;display:flex;justify-content:center;align-items:center;gap:0.5rem;flex-wrap:wrap;">
      <span style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.5);letter-spacing:0.04em;text-transform:uppercase;">For state leadership</span>
      ${featuredLinks.map(l => `<a href="${l.href}" style="font-size:12.5px;font-weight:600;color:white;text-decoration:none;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);padding:0.3rem 0.875rem;border-radius:100px;">${l.label}</a>`).join('\n      ')}
    </div>` : '';

// ── HTML ──────────────────────────────────────────────────────────────────────

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName} — Explorer</title>
  <style>
    :root {
      --dark-blue:    #2B1A78;
      --mid-blue:     #5650BE;
      --light-blue:   #C2C0E8;
      --pale-blue:    #E6EBF9;
      --deep-green:   #006152;
      --mid-green:    #00AD93;
      --light-green:  #E2F9F6;
      --sand-dark:    #E9CCBE;
      --sand-mid:     #F7EDE8;
      --warm-yellow:  #FFB446;
      --text:         #1a1a1a;
      --text-mid:     #444;
      --text-light:   #666;
      --bg:           #F3F3F3;
      --white:        #FFFFFF;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    /* ── Header ──────────────────────────────────────────────────── */

    header {
      background: var(--dark-blue);
      color: var(--white);
      padding: 0 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 52px;
      border-bottom: 3px solid var(--mid-blue);
    }

    .wordmark {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .wordmark svg { width: 22px; height: 22px; flex-shrink: 0; }

    header h1 {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    header nav a {
      color: var(--light-blue);
      font-size: 12px;
      text-decoration: none;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }

    header nav a:hover { color: var(--white); background: rgba(255,255,255,0.1); }

    /* ── Hero ────────────────────────────────────────────────────── */

    .hero {
      background: linear-gradient(135deg, var(--dark-blue) 0%, #3d2a9a 60%, var(--mid-blue) 100%);
      color: var(--white);
      padding: 4rem 2rem 3.5rem;
      text-align: center;
      position: relative;
      overflow: hidden;
    }

    .hero::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image:
        radial-gradient(circle at 20% 50%, rgba(194,192,232,0.12) 0%, transparent 50%),
        radial-gradient(circle at 80% 20%, rgba(0,173,147,0.08) 0%, transparent 40%);
      pointer-events: none;
    }

    .hero-badge {
      display: inline-block;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 100px;
      padding: 0.25rem 0.875rem;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--light-blue);
      margin-bottom: 1.25rem;
    }

    .hero h2 {
      font-size: 2.25rem;
      font-weight: 800;
      line-height: 1.15;
      margin-bottom: 0.75rem;
      letter-spacing: -0.02em;
    }

    .hero p {
      font-size: 1rem;
      color: rgba(255,255,255,0.75);
      max-width: 520px;
      margin: 0 auto;
      line-height: 1.6;
    }

    /* ── Main layout ─────────────────────────────────────────────── */

    main {
      max-width: 1080px;
      margin: 0 auto;
      padding: 3rem 2rem 4rem;
    }

    /* ── Section headers ─────────────────────────────────────────── */

    .section-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }

    .pill {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 0.3rem 0.75rem;
      border-radius: 100px;
    }

    .pill-diagrams {
      background: var(--pale-blue);
      color: var(--dark-blue);
      border: 1px solid var(--light-blue);
    }

    .pill-tools {
      background: var(--light-green);
      color: var(--deep-green);
      border: 1px solid #b2e8e2;
    }

    .section-header h3 {
      font-size: 1.125rem;
      font-weight: 700;
    }

    .section-divider {
      border: none;
      border-top: 1px solid var(--sand-dark);
      margin: 2.5rem 0;
    }

    /* ── Card grid ───────────────────────────────────────────────── */

    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1rem;
    }

    .card {
      background: var(--white);
      border: 1px solid var(--sand-dark);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      position: relative;
      transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
    }

    .card:hover {
      border-color: var(--mid-blue);
      box-shadow: 0 4px 16px rgba(43,26,120,0.1);
      transform: translateY(-1px);
    }

    .card-title { color: inherit; font: inherit; }

    .card-link {
      text-decoration: none;
      color: inherit;
    }

    .card-link::after {
      content: '';
      position: absolute;
      inset: 0;
      z-index: 0;
    }

    .card-accent { height: 4px; }

    .accent-blue   { background: linear-gradient(90deg, var(--dark-blue), var(--mid-blue)); }
    .accent-green  { background: linear-gradient(90deg, var(--deep-green), var(--mid-green)); }
    .accent-yellow { background: linear-gradient(90deg, #c98a00, var(--warm-yellow)); }
    .accent-sand   { background: linear-gradient(90deg, #b5917a, var(--sand-dark)); }

    .card-body {
      padding: 1.25rem 1.375rem 1.375rem;
      display: flex;
      flex-direction: column;
      flex: 1;
    }

    .card-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 0.875rem;
      flex-shrink: 0;
    }

    .icon-blue   { background: var(--pale-blue); }
    .icon-green  { background: var(--light-green); }
    .icon-yellow { background: #FFF3E0; }
    .icon-sand   { background: var(--sand-mid); }

    .card-icon svg { width: 20px; height: 20px; display: block; }

    .card-header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 0.375rem;
    }

    .card h4 {
      font-size: 0.9375rem;
      font-weight: 700;
      color: var(--dark-blue);
      line-height: 1.3;
    }

    .card p {
      font-size: 0.8125rem;
      color: var(--text-light);
      line-height: 1.55;
      flex: 1;
    }

    /* ── Status badges ───────────────────────────────────────────── */

    .status-badge {
      font-size: 9.5px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 0.15rem 0.5rem;
      border-radius: 100px;
      flex-shrink: 0;
      margin-left: 0.5rem;
      margin-top: 1px;
    }

    .badge-complete { background: var(--light-green);  color: var(--deep-green); border: 1px solid #b2e8e2; }
    .badge-progress { background: var(--pale-blue);    color: var(--mid-blue);   border: 1px solid var(--light-blue); }
    .badge-planned  { background: var(--sand-mid);     color: #7a6050;           border: 1px solid var(--sand-dark); }

    /* ── Output tags ─────────────────────────────────────────────── */

    .card-outputs {
      margin-top: 1rem;
      padding-top: 0.875rem;
      border-top: 1px solid var(--sand-dark);
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      position: relative;
      z-index: 1;
    }

    .output-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 10.5px;
      font-weight: 600;
      color: var(--text-mid);
      background: var(--bg);
      border: 1px solid var(--sand-dark);
      border-radius: 4px;
      padding: 0.2rem 0.5rem;
      text-decoration: none;
      position: relative;
      z-index: 1;
      transition: border-color 0.15s, color 0.15s;
    }

    .output-tag:hover { border-color: var(--mid-blue); color: var(--mid-blue); }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .dot-blue   { background: var(--mid-blue); }
    .dot-green  { background: var(--mid-green); }
    .dot-yellow { background: var(--warm-yellow); }
    .dot-grey   { background: #aaa; }

    /* ── Footer ──────────────────────────────────────────────────── */

    footer {
      border-top: 1px solid var(--sand-dark);
      background: var(--white);
      padding: 1.5rem 2rem;
      text-align: center;
      font-size: 12px;
      color: var(--text-light);
    }

    footer a { color: var(--mid-blue); text-decoration: none; }
    footer a:hover { text-decoration: underline; }

    @media (max-width: 600px) {
      .hero h2 { font-size: 1.625rem; }
      main { padding: 2rem 1rem 3rem; }
    }
  </style>
</head>
<body>

  <header>
    <div class="wordmark">
      <svg viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <polygon points="11,1 20,6 20,16 11,21 2,16 2,6" fill="none" stroke="#C2C0E8" stroke-width="1.5"/>
        <polygon points="11,5 17,8.5 17,13.5 11,17 5,13.5 5,8.5" fill="#5650BE"/>
      </svg>
      <h1>${projectName}</h1>
    </div>
    <nav>
      <a href="${githubUrl}">GitHub</a>
    </nav>
  </header>

  <div class="hero">
    <div class="hero-badge">Explorer</div>
    <h2>Systems integration artifacts</h2>
    <p>Diagrams, tools, and reference outputs for the ${projectName} — a shared contract layer for state benefits programs.</p>${featuredLinksHtml}
  </div>

  <main>

    <!-- ── Tools ─────────────────────────────────────────────────── -->

    <div class="section-header">
      <span class="pill pill-tools">Tools</span>
      <h3>Data &amp; reference tools</h3>
    </div>

    <div class="card-grid">

      <div class="card">
        <div class="card-accent accent-green"></div>
        <div class="card-body">
          <div class="card-icon icon-green">
            <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="3" y="3" width="14" height="3" rx="1.5" fill="#006152"/>
              <rect x="3" y="8.5" width="9" height="2" rx="1" fill="#00AD93"/>
              <rect x="3" y="12" width="11" height="2" rx="1" fill="#00AD93"/>
              <rect x="3" y="15.5" width="7" height="2" rx="1" fill="#00AD93"/>
            </svg>
          </div>
          <div class="card-header-row">
            <h4><a href="api-reference/index.html" class="card-link">API Reference</a></h4>
            <span class="status-badge badge-progress">In progress</span>
          </div>
          <p>Static reference for all contract APIs — endpoints, parameters, request and response schemas. No running mock server required.</p>${outputTags(apiPages, `api-reference`, 'dot-green')}
        </div>
      </div>

      <div class="card">
        <div class="card-accent accent-green"></div>
        <div class="card-body">
          <div class="card-icon icon-green">
            <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="1" y="1" width="18" height="18" rx="2.5" fill="#006152"/>
              <rect x="1" y="1" width="18" height="5.5" rx="2.5" fill="#00AD93"/>
              <rect x="1" y="6.5" width="5.5" height="12.5" fill="#00AD93"/>
              <rect x="1" y="6.5" width="5.5" height="5.5" fill="#33c4ad"/>
            </svg>
          </div>
          <div class="card-header-row">
            <h4><a href="data-dictionaries/index.html" class="card-link">Data Dictionary</a></h4>
            <span class="status-badge badge-progress">In progress</span>
          </div>
          <p>Field-level reference for the blueprint data model — types, enums, relationships, and annotations from the OpenAPI specs.</p>${outputTags(dictPages, `data-dictionaries`, 'dot-green')}
        </div>
      </div>

      <div class="card">
        <div class="card-accent accent-sand"></div>
        <div class="card-body">
          <div class="card-icon icon-sand">
            <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="3" y="2" width="9" height="12" rx="1.5" fill="#b5917a"/>
              <rect x="5" y="5" width="5" height="1.5" rx="0.75" fill="#f7ede8"/>
              <rect x="5" y="8" width="4" height="1.5" rx="0.75" fill="#f7ede8"/>
              <circle cx="14.5" cy="14.5" r="4" fill="#e9ccbe" stroke="#b5917a" stroke-width="1.5"/>
              <line x1="13" y1="14.5" x2="16" y2="14.5" stroke="#b5917a" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="14.5" y1="13" x2="14.5" y2="16" stroke="#b5917a" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="card-header-row">
            <h4><a href="client-reference/index.html" class="card-link">Client Reference</a></h4>
            <span class="status-badge badge-progress">In progress</span>
          </div>
          <p>Generated TypeScript client reference — SDK functions, types, and Zod schemas for each domain, with search helper documentation.</p>${outputTags(clientPages, `client-reference`, 'dot-grey')}
        </div>
      </div>

      <div class="card">
        <div class="card-accent accent-blue"></div>
        <div class="card-body">
          <div class="card-icon icon-blue">
            <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="4" cy="10" r="3" fill="#2B1A78"/>
              <circle cx="16" cy="4.5" r="3" fill="#5650BE"/>
              <circle cx="16" cy="15.5" r="3" fill="#5650BE"/>
              <line x1="7" y1="9" x2="13" y2="5.5" stroke="#5650BE" stroke-width="1.5"/>
              <line x1="7" y1="11" x2="13" y2="14.5" stroke="#5650BE" stroke-width="1.5"/>
            </svg>
          </div>
          <div class="card-header-row">
            <h4><a href="state-machine-docs/index.html" class="card-link">State Machine Docs</a></h4>
            <span class="status-badge badge-progress">In progress</span>
          </div>
          <p>Generated reference for the state machines defined in the blueprint contracts — states, transitions, actions, and event subscriptions.</p>${outputTags(smPages, `state-machine-docs`, 'dot-blue')}
        </div>
      </div>

      <div class="card">
        <div class="card-accent accent-blue"></div>
        <div class="card-body">
          <div class="card-icon icon-blue">
            <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="10" cy="10" r="4" fill="#5650BE"/>
              <circle cx="10" cy="10" r="1.5" fill="white"/>
              <circle cx="3.5" cy="5" r="2" fill="#2B1A78"/>
              <circle cx="16.5" cy="5" r="2" fill="#2B1A78"/>
              <circle cx="3.5" cy="15" r="2" fill="#2B1A78"/>
              <circle cx="16.5" cy="15" r="2" fill="#2B1A78"/>
              <line x1="6" y1="6.5" x2="8" y2="8.5" stroke="#5650BE" stroke-width="1.5"/>
              <line x1="14" y1="6.5" x2="12" y2="8.5" stroke="#5650BE" stroke-width="1.5"/>
              <line x1="6" y1="13.5" x2="8" y2="11.5" stroke="#5650BE" stroke-width="1.5"/>
              <line x1="14" y1="13.5" x2="12" y2="11.5" stroke="#5650BE" stroke-width="1.5"/>
            </svg>
          </div>
          <div class="card-header-row">
            <h4><a href="event-catalog/index.html" class="card-link">Event Catalog</a></h4>
            <span class="status-badge badge-progress">In progress</span>
          </div>
          <p>Cross-domain event reference — every published event with its emitting domain and all subscribers, derived from state machine contracts.</p>
        </div>
      </div>

    </div>

    <hr class="section-divider">

    <!-- ── Diagrams ──────────────────────────────────────────────── -->

    <div class="section-header">
      <span class="pill pill-diagrams">Diagrams</span>
      <h3>Architecture &amp; process diagrams</h3>
    </div>

    <div class="card-grid">

      <div class="card">
        <div class="card-accent accent-blue"></div>
        <div class="card-body">
          <div class="card-icon icon-blue">
            <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="10" cy="10" r="3.5" fill="#5650BE"/>
              <circle cx="3" cy="4" r="2.5" fill="#2B1A78"/>
              <circle cx="17" cy="4" r="2.5" fill="#2B1A78"/>
              <circle cx="3" cy="16" r="2.5" fill="#2B1A78"/>
              <circle cx="17" cy="16" r="2.5" fill="#2B1A78"/>
              <line x1="5" y1="5.5" x2="7.5" y2="8" stroke="#5650BE" stroke-width="1.5"/>
              <line x1="15" y1="5.5" x2="12.5" y2="8" stroke="#5650BE" stroke-width="1.5"/>
              <line x1="5" y1="14.5" x2="7.5" y2="12" stroke="#5650BE" stroke-width="1.5"/>
              <line x1="15" y1="14.5" x2="12.5" y2="12" stroke="#5650BE" stroke-width="1.5"/>
            </svg>
          </div>
          <div class="card-header-row">
            <h4><a href="context-map/domains.html" class="card-link">Context Map</a></h4>
            <span class="status-badge badge-progress">In progress</span>
          </div>
          <p>Visual map of the bounded contexts, systems, and integration relationships across the safety net platform.</p>${outputTags(contextPages, `context-map`, 'dot-blue')}
        </div>
      </div>

      <div class="card">
        <div class="card-accent accent-blue"></div>
        <div class="card-body">
          <div class="card-icon icon-blue">
            <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <line x1="2" y1="5" x2="10" y2="5" stroke="#5650BE" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="2" y1="10" x2="18" y2="10" stroke="#2B1A78" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="10" y1="15" x2="18" y2="15" stroke="#5650BE" stroke-width="1.5" stroke-linecap="round"/>
              <polygon points="10,5 13,3 13,7" fill="#5650BE"/>
              <polygon points="18,10 15,8 15,12" fill="#2B1A78"/>
              <polygon points="18,15 15,13 15,17" fill="#5650BE"/>
            </svg>
          </div>
          <div class="card-header-row">
            <h4><a href="sequence-diagrams/index.html" class="card-link">Sequence Diagrams</a></h4>
            <span class="status-badge badge-progress">In progress</span>
          </div>
          <p>Contract-driven event chain diagrams tracing how a triggering action propagates across domain boundaries.</p>${outputTags(seqPages, `sequence-diagrams`, 'dot-blue')}
        </div>
      </div>

    </div>

  </main>

  <footer>
    <a href="${githubUrl}">${projectName}</a>
    &nbsp;·&nbsp;
    Code for America
  </footer>

</body>
</html>`;

writeFileSync(join(contentDir, 'index.html'), html, 'utf8');
console.log(`  wrote ${join(contentDir, 'index.html')}`);
