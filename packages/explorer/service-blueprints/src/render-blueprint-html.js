#!/usr/bin/env node
/**
 * render-blueprint-html.js
 *
 * Renders a service blueprint JSON as an HTML swimlane diagram.
 * Reads a blueprint JSON file (same format as the Figma plugin input).
 * Writes to dist/<domain>-blueprint.html.
 *
 * Usage:
 *   node render-blueprint-html.js <blueprint.json> [--out <output.html>]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const inputPath = args.find(a => !a.startsWith('--'));
const outFlagIdx = args.indexOf('--out');
const outArg = outFlagIdx !== -1 ? args[outFlagIdx + 1] : null;

if (!inputPath) {
  console.error('Usage: node render-blueprint-html.js <blueprint.json> [--out <output.html>]');
  process.exit(1);
}

const blueprint = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
const inputDir  = dirname(resolve(inputPath));
const stem      = basename(inputPath, '.json');
const outPath   = outArg ? resolve(outArg) : join(inputDir, `${stem}-blueprint.html`);

// ── Theme ─────────────────────────────────────────────────────────────────────

const DEFAULT_THEME = {
  cards: {
    'staff-action':            { headerBg: '#2B1A78', bodyBg: '#EEEBFF', headerFg: '#FFFFFF', bodyFg: '#1A1040', label: 'STAFF ACTION'      },
    'system':                  { headerBg: '#137C69', bodyBg: '#F1FFFD', headerFg: '#FFFFFF', bodyFg: '#0A3A2E', label: 'SYSTEM'            },
    'policy':                  { headerBg: '#EDD7CD', bodyBg: '#F8F6F5', headerFg: '#3D2B0E', bodyFg: '#3D2B0E', label: 'POLICY'            },
    'pain-point':              { headerBg: '#EB646B', bodyBg: '#F9E9EA', headerFg: '#1A0000', bodyFg: '#2A0A0A', label: 'PAIN POINT'        },
    'opportunity':             { headerBg: '#FDAF49', bodyBg: '#FEF1DD', headerFg: '#3D2800', bodyFg: '#3D2800', label: 'OPPORTUNITY'       },
    'domain-event':            { headerBg: '#2E6276', bodyBg: '#E7F2F5', headerFg: '#FFFFFF', bodyFg: '#0A2E34', label: 'EVENT'             },
    'domain-event-published':  { headerBg: '#2E6276', bodyBg: '#E7F2F5', headerFg: '#FFFFFF', bodyFg: '#0A2E34', label: 'EVENT (PUBLISHED)' },
    'data-entity':             { headerBg: '#154C21', bodyBg: '#E3F5E1', headerFg: '#FFFFFF', bodyFg: '#0A2E1E', label: 'DATA'              },
    'note':                    { headerBg: '#FDDA40', bodyBg: '#FFFBE7', headerFg: '#333333', bodyFg: '#555555', label: ''                  },
    'person-action':           { headerBg: '#2B1A78', bodyBg: '#EEEBFF', headerFg: '#FFFFFF', bodyFg: '#1A1040', label: 'PERSON'            },
    'communications':          { headerBg: '#2672DE', bodyBg: '#EDF5FF', headerFg: '#FFFFFF', bodyFg: '#0A1E40', label: 'COMMUNICATIONS'    },
  },
  actors: {
    'applicant':  { headerBg: '#D97C20', bodyBg: '#FDECD4', headerFg: '#3D1800', bodyFg: '#3D1800', label: 'APPLICANT'  },
    'caseworker': { headerBg: '#2B1A78', bodyBg: '#EEEBFF', headerFg: '#FFFFFF', bodyFg: '#1A1040', label: 'CASEWORKER' },
    'supervisor': { headerBg: '#4F41B2', bodyBg: '#EEEBFF', headerFg: '#FFFFFF', bodyFg: '#1A1040', label: 'SUPERVISOR' },
    'system':     { headerBg: '#137C69', bodyBg: '#F1FFFD', headerFg: '#FFFFFF', bodyFg: '#0A3A2E', label: 'SYSTEM'     },
  },
};

function deepMerge(defaults, override) {
  if (!override || typeof override !== 'object') return defaults;
  const result = { ...defaults };
  for (const [k, v] of Object.entries(override)) {
    result[k] = (v && typeof v === 'object' && !Array.isArray(v))
      ? deepMerge(defaults[k] ?? {}, v) : v;
  }
  return result;
}

function loadTheme(dir) {
  const themePath = join(dir, 'theme.yaml');
  if (!existsSync(themePath)) return DEFAULT_THEME;
  try {
    return deepMerge(DEFAULT_THEME, yaml.load(readFileSync(themePath, 'utf8')) ?? {});
  } catch {
    return DEFAULT_THEME;
  }
}

const THEME = loadTheme(inputDir);

function getPalette(card) {
  if (card.type === 'person-action' && card.actor && THEME.actors[card.actor]) {
    return THEME.actors[card.actor];
  }
  const p = THEME.cards[card.type] ?? THEME.cards['note'];
  if (card.type === 'system' && card.domain) return { ...p, label: `SYSTEM (${card.domain.toUpperCase()})` };
  if (card.type === 'domain-event' && card.domain) return { ...p, label: `EVENT (${card.domain.toUpperCase()})` };
  return p;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Card HTML ─────────────────────────────────────────────────────────────────

function cardHtml(card) {
  const p = getPalette(card);
  const label = p.label || '';
  return `<div style="border-radius:6px;overflow:hidden;margin-bottom:6px;box-shadow:0 1px 3px rgba(0,0,0,0.15);">
    <div style="background:${p.headerBg};color:${p.headerFg};padding:7px 9px;">
      <div style="font-size:12px;font-weight:700;line-height:1.35;">${esc(card.text)}</div>
      ${label ? `<div style="font-size:9px;font-weight:800;letter-spacing:0.06em;margin-top:4px;opacity:0.9;">${esc(label)}</div>` : ''}
    </div>
    ${card.subtext || card.citation ? `<div style="background:${p.bodyBg};color:${p.bodyFg};padding:6px 9px;">
      ${card.subtext ? `<div style="font-size:11px;line-height:1.4;margin-bottom:${card.citation ? '4px' : '0'};">${esc(card.subtext)}</div>` : ''}
      ${card.citation ? `<div style="font-size:9px;font-weight:700;opacity:0.6;">${esc(card.citation)}</div>` : ''}
    </div>` : ''}
  </div>`;
}

// ── Blueprint HTML ────────────────────────────────────────────────────────────

function renderBlueprint(bp) {
  // Build sub-phase column list in order
  const columns = [];
  for (const phase of bp.phases) {
    for (const sub of phase.subPhases) {
      columns.push({ phase, sub });
    }
  }

  const cellMap = new Map();
  for (const cell of (bp.cells || [])) {
    cellMap.set(`${cell.laneId}/${cell.subPhaseId}`, cell);
  }

  const LANE_W = 120;
  const COL_W  = 230;
  const totalCols = 1 + columns.length; // lane label + sub-phase cols
  const gridTemplateColumns = `${LANE_W}px ${columns.map(() => `${COL_W}px`).join(' ')}`;

  // Phase header row — span across their sub-phases
  let phaseHeaders = `<div style="background:#fff;border-right:1px solid #ddd;"></div>`;
  for (const phase of bp.phases) {
    const span = phase.subPhases.length;
    phaseHeaders += `<div style="grid-column:span ${span};background:#1a1a1a;color:#fff;font-size:13px;font-weight:800;padding:10px 12px;border-left:2px solid #fff;display:flex;align-items:center;">${esc(phase.label)}</div>`;
  }

  // Sub-phase header row
  let subHeaders = `<div style="background:#f0f0f0;border-right:1px solid #ddd;font-size:10px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.05em;padding:8px 10px;display:flex;align-items:center;">Sub-phase</div>`;
  for (const { sub } of columns) {
    subHeaders += `<div style="background:#f0f0f0;border-left:1px solid #ddd;font-size:11px;font-weight:700;color:#333;padding:8px 10px;display:flex;align-items:center;">${esc(sub.label)}</div>`;
  }

  // Lane rows
  let laneRows = '';
  for (const lane of (bp.lanes || [])) {
    let row = `<div style="background:#fafafa;border-right:1px solid #ddd;border-top:1px solid #e8e8e8;font-size:11px;font-weight:700;color:#555;padding:10px 10px;display:flex;align-items:flex-start;justify-content:center;text-align:center;writing-mode:horizontal-lr;">${esc(lane.label)}</div>`;
    for (const { sub } of columns) {
      const cell = cellMap.get(`${lane.id}/${sub.id}`);
      const cards = (cell?.cards || []).map(cardHtml).join('');
      row += `<div style="border-left:1px solid #ddd;border-top:1px solid #e8e8e8;padding:8px;vertical-align:top;min-height:60px;">${cards}</div>`;
    }
    laneRows += `${row}`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; padding: 20px; }</style>
</head>
<body>
  <h1 style="font-size:15px;font-weight:800;color:#1a1a1a;margin-bottom:16px;">${esc(bp.name)}</h1>
  <div style="display:grid;grid-template-columns:${gridTemplateColumns};border:1px solid #ccc;border-radius:4px;overflow:hidden;">
    ${phaseHeaders}
    ${subHeaders}
    ${laneRows}
  </div>
</body>
</html>`;
}

// ── Write output ──────────────────────────────────────────────────────────────

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, renderBlueprint(blueprint));
console.log(`Wrote ${outPath}`);
