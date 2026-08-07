#!/usr/bin/env node
/**
 * Produces a rules.html per fixture: rules diagram, vocabulary, and the
 * corticon.json + patterns.json source files for reference.
 *
 * Usage: node src/visualize-rules-html.js <slug>
 *   --classified  <patterns.json>
 *   --project     <corticon.json>
 *   --out         <output.html>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { buildRulesDiagramContent } from './visualize-rules.js';
import { jsonPanel } from '../../json-panel.js';
import { buildEntityAliasMap } from '../../graph/attribute-path.js';

import { COLORS, FONT } from '../../../../explorer/lib/theme.js';
import { esc } from '../../../../explorer/lib/html.js';

const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
const DARK_BLUE = COLORS.darkBlue;

function parseArgs(argv) {
  const args = argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const slug = args.find(a => !a.startsWith('--')) ?? 'output';
  return {
    slug,
    classifiedPath: get('--classified'),
    projectPath:    get('--project'),
    outFile:        get('--out') ?? `generated/${slug}-rules.html`,
  };
}

// ── Vocabulary tab ──────────────────────────────────────────────────────────

function renderVocabularyTab(projectPath) {
  if (!projectPath) return '<p style="color:#9ca3af;font-size:12px">No project file provided.</p>';
  let project;
  try { project = JSON.parse(readFileSync(projectPath, 'utf-8')); }
  catch { return '<p style="color:#9ca3af;font-size:12px">Could not load project file.</p>'; }

  // Build entity→attribute→type map by scanning rule terms using canonical entity types.
  // The vocabulary object only surfaces the root entity with associations, not the scalar
  // attributes of associated entities — rule terms are the authoritative source for those.
  const aliasMap = buildEntityAliasMap(project);
  const byEntity = new Map();
  for (const rulesheet of Object.values(project.rulesheets ?? {})) {
    for (const rule of rulesheet.rules ?? []) {
      for (const cell of [...(rule.conditions ?? []), ...(rule.actions ?? [])].filter(Boolean)) {
        for (const term of [...(cell.referencedTerms ?? []), ...(cell.modifiedTerms ?? [])]) {
          if (term.termtype !== 'ATTRIBUTE' || !term.parent?.text || !term.datatype) continue;
          const entityType = aliasMap.get(term.parent.text) ?? term.parent.text;
          if (!byEntity.has(entityType)) byEntity.set(entityType, new Map());
          if (!byEntity.get(entityType).has(term.text)) {
            byEntity.get(entityType).set(term.text, term.datatype);
          }
        }
      }
    }
  }

  if (!byEntity.size) return '<p style="color:#9ca3af;font-size:12px">No attributes found.</p>';

  const entityHtml = [...byEntity.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([entityName, attrs]) => {
    const rows = [...attrs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([attrName, typeName]) => {
      return `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:4px 16px 4px 0;font-family:${MONO};font-size:11.5px;color:#1f2937;white-space:nowrap">${esc(attrName)}</td>
        <td style="padding:4px 0;font-size:11px;color:#6b7280;white-space:nowrap">${esc(typeName)}</td>
      </tr>`;
    }).join('');
    return `<div style="break-inside:avoid;margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;color:#111827;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #e5e7eb">${esc(entityName)}</div>
      <table style="border-collapse:collapse;width:100%"><tbody>${rows}</tbody></table>
    </div>`;
  }).join('');

  return `<div style="columns:3 280px;column-gap:32px">${entityHtml}</div>`;
}

// ── Main render ─────────────────────────────────────────────────────────────

function render(opts) {
  const { slug, classifiedPath, projectPath } = opts;

  let rulesSvg = '';
  try { rulesSvg = buildRulesDiagramContent(classifiedPath, 'arrow-rules', { skipStrips: true }); }
  catch (e) { rulesSvg = `<p style="color:#991b1b;padding:1rem">Error: ${esc(e.message)}</p>`; }

  const vocabHtml = renderVocabularyTab(projectPath);

  const jsonFiles = [
    { id: 'json-project',    label: 'corticon.json',   path: projectPath },
    { id: 'json-classified', label: 'patterns.json', path: classifiedPath },
  ];
  const jsonNavItems   = jsonFiles.map(f => jsonPanel(f.id, f.label, f.path).navHtml).join('\n');
  const jsonPanelsHtml = jsonFiles.map(f => jsonPanel(f.id, f.label, f.path).panelHtml).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${esc(slug)} — Rules</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body { font-family: ${FONT}; background: #F3F3F3; color: #1a1a1a; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    #page-header { flex-shrink: 0; background: ${DARK_BLUE}; color: white; padding: 10px 20px; font-size: 14px; font-weight: 700; }
    #page-header span { font-weight: 400; opacity: 0.6; margin-left: 8px; font-size: 12px; }
    .page-layout { display: flex; flex: 1; min-height: 0; overflow: hidden; }
    #sidebar { width: 180px; min-width: 180px; background: ${DARK_BLUE}; flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden; }
    #sidebar-nav { padding: 0.5rem 0; overflow-y: auto; flex: 1; }
    a.nav-link { display: block; padding: 5px 0.75rem; font-size: 11px; color: rgba(255,255,255,0.65); text-decoration: none; cursor: pointer; transition: background 0.1s; }
    a.nav-link:hover { background: rgba(255,255,255,0.08); color: white; }
    a.nav-link.nav-active { background: rgba(255,255,255,0.15); color: white; font-weight: 700; }
    .nav-section-label { font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.35); padding: 0.75rem 0.75rem 0.2rem; }
    #content { flex: 1; min-width: 0; position: relative; overflow: hidden; }
    .tab-panel { display: none; position: absolute; inset: 0; overflow: auto; }
    .tab-panel.active { display: block; }
    .svg-panel { display: none; position: absolute; inset: 0; flex-direction: column; }
    .svg-panel.active { display: flex; }
    .svg-panel > .panel-header { flex-shrink: 0; padding: 1.25rem 2rem 0.75rem; border-bottom: 2px solid #e5e7eb; background: #F3F3F3; }
    .svg-panel > .panel-header h2 { font-size: 15px; font-weight: 700; color: #111827; }
    .svg-scroll { flex: 1; min-height: 0; overflow: auto; background: #fafafa; }
  </style>
</head>
<body>
  <div id="page-header">${esc(slug)}<span>Rules</span></div>
  <div class="page-layout">
    <nav id="sidebar">
      <div id="sidebar-nav">
        <div class="nav-section-label">VIEWS</div>
        <a class="nav-link" data-tab="rules-diagram">Rules</a>
        <a class="nav-link" data-tab="vocabulary">Vocabulary</a>
        <div class="nav-section-label" style="margin-top:0.5rem">JSON</div>
        ${jsonNavItems}
      </div>
    </nav>
    <main id="content">
      <div id="rules-diagram" class="svg-panel">
        <div class="panel-header"><h2>Rules</h2></div>
        <div class="svg-scroll">${rulesSvg}</div>
      </div>
      <div id="vocabulary" class="tab-panel" style="padding:1.5rem 2rem">
        <h2 style="font-size:15px;font-weight:700;color:#111827;margin-bottom:16px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">Vocabulary</h2>
        ${vocabHtml}
      </div>
      ${jsonPanelsHtml}
    </main>
  </div>
  <script>
    (function () {
      function activate(tabId) {
        document.querySelectorAll('#sidebar .nav-link[data-tab]').forEach(a => {
          a.classList.toggle('nav-active', a.dataset.tab === tabId);
        });
        document.querySelectorAll('#content .tab-panel, #content .svg-panel').forEach(p => {
          p.classList.remove('active');
        });
        const panel = document.getElementById(tabId);
        if (panel) panel.classList.add('active');
      }
      document.querySelectorAll('#sidebar .nav-link[data-tab]').forEach(a => {
        a.addEventListener('click', () => activate(a.dataset.tab));
      });
      const first = document.querySelector('#sidebar .nav-link[data-tab]');
      if (first) activate(first.dataset.tab);
    })();
  </script>
</body>
</html>`;
}

const opts = parseArgs(process.argv);
if (!opts.classifiedPath) {
  console.error('Usage: node src/visualize-rules-html.js <slug> --classified <f> [--project <f>] [--out <file.html>]');
  process.exit(1);
}

writeFileSync(opts.outFile, render(opts));
console.log(`Wrote rules output to ${opts.outFile}`);
