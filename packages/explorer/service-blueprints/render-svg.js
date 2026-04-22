#!/usr/bin/env node
/**
 * render-svg.js
 *
 * Reads a blueprint JSON file (the Figma plugin input format) and renders it
 * as an SVG file using the same layout constants and color palette as the
 * Figma plugin renderer (renderer.ts).
 *
 * Usage:
 *   node render-svg.js src/blueprints/intake.json
 *   node render-svg.js src/blueprints/intake.json --out dist/intake.svg
 *   npm run render -- src/blueprints/intake.json
 *
 * Output: <input-dir>/<domain>.svg  (or path specified by --out)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, join, basename } from 'path';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const inputPath = args.find(a => !a.startsWith('--'));
const outFlagIdx = args.indexOf('--out');
const outArg = outFlagIdx !== -1 ? args[outFlagIdx + 1] : null;

if (!inputPath) {
  console.error('Usage: node render-svg.js <blueprint.json> [--out <output.svg>]');
  process.exit(1);
}

const blueprint = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
const inputDir  = dirname(resolve(inputPath));
const stem      = basename(inputPath, '.json');
const outPath   = outArg ? resolve(outArg) : join(inputDir, `${stem}.svg`);

// ── Layout constants (match renderer.ts) ─────────────────────────────────────

const PHASE_WIDTH      = 280;
const LANE_LABEL_WIDTH = 120;
const PHASE_ROW_H      = 52;   // height of the Phase grouping row
const SUBPHASE_ROW_H   = 40;   // height of the Sub phase column-label row
const HEADER_HEIGHT    = PHASE_ROW_H + SUBPHASE_ROW_H;
const CELL_PADDING     = 12;
const CARD_WIDTH       = PHASE_WIDTH - CELL_PADDING * 2;   // 256
const CARD_PADDING     = 14;
const CARD_CORNER      = 8;
const CARD_GAP         = 12;
const KEY_CARD_WIDTH   = 220;
const KEY_PANEL_WIDTH  = KEY_CARD_WIDTH + 40;
const KEY_GAP          = 56;
const KEY_TOTAL        = KEY_PANEL_WIDTH + KEY_GAP;
const ROW_MIN_HEIGHT   = 80;
const ICON_SIZE        = 14;   // px — card-type icon rendered left of type label
const ICON_GAP         = 4;    // px — gap between icon and label text

// ── Color palette (from Figma Service Blueprint component library) ─────────────

const PALETTE = {
  'staff-action':  { headerBg: '#2B1A78', bodyBg: '#EEEBFF', headerFg: '#FFFFFF', bodyFg: '#1A1040', label: 'STAFF ACTION'  },
  'system':        { headerBg: '#137C69', bodyBg: '#F1FFFD', headerFg: '#FFFFFF', bodyFg: '#0A3A2E', label: 'SYSTEM'        },
  'policy':        { headerBg: '#EDD7CD', bodyBg: '#F8F6F5', headerFg: '#3D2B0E', bodyFg: '#3D2B0E', label: 'POLICY'        },
  'pain-point':    { headerBg: '#EB646B', bodyBg: '#F9E9EA', headerFg: '#1A0000', bodyFg: '#2A0A0A', label: 'PAIN POINT'   },
  'opportunity':   { headerBg: '#FDAF49', bodyBg: '#FEF1DD', headerFg: '#3D2800', bodyFg: '#3D2800', label: 'OPPORTUNITY'   },
  'domain-event':           { headerBg: '#2E6276', bodyBg: '#E7F2F5', headerFg: '#FFFFFF', bodyFg: '#0A2E34', label: 'EVENT'             },
  'domain-event-published': { headerBg: '#2E6276', bodyBg: '#E7F2F5', headerFg: '#FFFFFF', bodyFg: '#0A2E34', label: 'EVENT (PUBLISHED)' },
  'data-entity':   { headerBg: '#154C21', bodyBg: '#E3F5E1', headerFg: '#FFFFFF', bodyFg: '#0A2E1E', label: 'DATA'          },
  'note':          { headerBg: '#FDDA40', bodyBg: '#FFFBE7', headerFg: '#333333', bodyFg: '#555555', label: ''              },
  'person-action': { headerBg: '#2B1A78', bodyBg: '#EEEBFF', headerFg: '#FFFFFF', bodyFg: '#1A1040', label: 'PERSON'        },
};

const ACTOR_PALETTE = {
  'applicant':  { headerBg: '#D97C20', bodyBg: '#FDECD4', headerFg: '#3D1800', bodyFg: '#3D1800', label: 'APPLICANT'  },
  'caseworker': { headerBg: '#2B1A78', bodyBg: '#EEEBFF', headerFg: '#FFFFFF', bodyFg: '#1A1040', label: 'CASEWORKER' },
  'supervisor': { headerBg: '#4F41B2', bodyBg: '#EEEBFF', headerFg: '#FFFFFF', bodyFg: '#1A1040', label: 'SUPERVISOR' },
  'system':     { headerBg: '#137C69', bodyBg: '#F1FFFD', headerFg: '#FFFFFF', bodyFg: '#0A3A2E', label: 'SYSTEM'     },
};

function getPalette(card) {
  if (card.type === 'person-action' && card.actor && ACTOR_PALETTE[card.actor]) {
    return ACTOR_PALETTE[card.actor];
  }
  const p = PALETTE[card.type] ?? PALETTE['note'];
  if (card.type === 'system' && card.domain) {
    return { ...p, label: `SYSTEM (${card.domain.toUpperCase()})` };
  }
  return p;
}

// ── Card icons (extracted from Figma Service Blueprint component library) ─────
// Paths are in Figma coordinate space. cardIcon() applies a translate+scale
// transform to position each icon at the target (x, y) and scale to ICON_SIZE.

const ICON_DEFS = {
  'person-single': {
    minX: 180.737, minY: 335.559, w: 10.667, h: 10.667,
    d: 'M186.071 336.826C186.844 336.826 187.471 337.453 187.471 338.226C187.471 338.999 186.844 339.626 186.071 339.626C185.297 339.626 184.671 338.999 184.671 338.226C184.671 337.453 185.297 336.826 186.071 336.826ZM186.071 342.826C188.054 342.826 190.137 343.796 190.137 344.226V344.959H182.004V344.226C182.004 343.796 184.087 342.826 186.071 342.826ZM186.071 335.559C184.597 335.559 183.404 336.753 183.404 338.226C183.404 339.696 184.597 340.893 186.071 340.893C187.544 340.893 188.737 339.696 188.737 338.226C188.737 336.753 187.544 335.559 186.071 335.559ZM186.071 341.559C184.294 341.559 180.737 342.449 180.737 344.226V346.226H191.404V344.226C191.404 342.449 187.847 341.559 186.071 341.559Z',
  },
  'person-group': {
    minX: 178.737, minY: 659.226, w: 14.667, h: 9.333,
    d: 'M189.071 664.559C188.267 664.559 187.021 664.783 186.071 665.229C185.121 664.783 183.874 664.559 183.071 664.559C181.627 664.559 178.737 665.283 178.737 666.726V668.559H193.404V666.726C193.404 665.283 190.514 664.559 189.071 664.559ZM186.404 667.559H179.737V666.726C179.737 666.369 181.444 665.559 183.071 665.559C184.697 665.559 186.404 666.369 186.404 666.726V667.559ZM192.404 667.559H187.404V666.726C187.404 666.423 187.271 666.153 187.057 665.913C187.647 665.713 188.367 665.559 189.071 665.559C190.697 665.559 192.404 666.369 192.404 666.726V667.559ZM183.071 663.893C184.361 663.893 185.404 662.846 185.404 661.559C185.404 660.273 184.361 659.226 183.071 659.226C181.784 659.226 180.737 660.273 180.737 661.559C180.737 662.846 181.784 663.893 183.071 663.893ZM183.071 660.226C183.807 660.226 184.404 660.823 184.404 661.559C184.404 662.296 183.807 662.893 183.071 662.893C182.334 662.893 181.737 662.296 181.737 661.559C181.737 660.823 182.334 660.226 183.071 660.226ZM189.071 663.893C190.361 663.893 191.404 662.846 191.404 661.559C191.404 660.273 190.361 659.226 189.071 659.226C187.784 659.226 186.737 660.273 186.737 661.559C186.737 662.846 187.784 663.893 189.071 663.893ZM189.071 660.226C189.807 660.226 190.404 660.823 190.404 661.559C190.404 662.296 189.807 662.893 189.071 662.893C188.334 662.893 187.737 662.296 187.737 661.559C187.737 660.823 188.334 660.226 189.071 660.226Z',
  },
  'gear': {
    minX: 179.632, minY: 980.226, w: 12.88, h: 13.333,
    d: 'M187.405 980.226C187.572 980.226 187.713 980.346 187.733 980.506L187.985 982.273C188.392 982.439 188.766 982.659 189.112 982.926L190.773 982.259C190.806 982.246 190.846 982.24 190.886 982.24C191.006 982.24 191.119 982.299 191.179 982.406L192.512 984.712C192.592 984.859 192.559 985.039 192.433 985.139L191.026 986.24C191.052 986.453 191.072 986.666 191.072 986.893C191.072 987.119 191.052 987.333 191.026 987.546L192.433 988.646C192.559 988.746 192.592 988.926 192.512 989.073L191.179 991.379C191.119 991.486 191.006 991.546 190.893 991.546C190.853 991.546 190.813 991.539 190.773 991.526L189.112 990.86C188.766 991.12 188.392 991.346 187.985 991.513L187.733 993.28C187.712 993.439 187.572 993.559 187.405 993.559H184.739C184.573 993.559 184.432 993.439 184.412 993.28L184.159 991.513C183.753 991.346 183.379 991.126 183.032 990.86L181.372 991.526C181.339 991.539 181.299 991.546 181.259 991.546C181.139 991.546 181.026 991.486 180.966 991.379L179.632 989.073C179.552 988.926 179.585 988.746 179.712 988.646L181.119 987.546C181.093 987.333 181.072 987.113 181.072 986.893C181.072 986.673 181.093 986.453 181.119 986.24L179.712 985.139C179.586 985.039 179.545 984.859 179.632 984.712L180.966 982.406C181.026 982.299 181.139 982.24 181.252 982.24C181.292 982.24 181.332 982.246 181.372 982.259L183.032 982.926C183.379 982.666 183.753 982.439 184.159 982.273L184.412 980.506C184.432 980.346 184.573 980.226 184.739 980.226H187.405ZM185.472 982.459L185.365 983.212L184.659 983.499C184.386 983.613 184.112 983.772 183.825 983.986L183.226 984.439L182.532 984.159L181.686 983.82L181.219 984.626L181.939 985.186L182.532 985.653L182.439 986.406C182.419 986.606 182.405 986.76 182.405 986.893C182.405 987.026 182.419 987.18 182.439 987.386L182.532 988.139L181.939 988.606L181.219 989.166L181.686 989.973L182.532 989.632L183.239 989.346L183.846 989.813C184.112 990.013 184.379 990.166 184.665 990.285L185.372 990.573L185.479 991.326L185.606 992.226H186.539L186.672 991.326L186.779 990.573L187.485 990.285C187.759 990.172 188.032 990.012 188.318 989.799L188.919 989.346L189.612 989.626L190.459 989.966L190.926 989.159L190.205 988.599L189.612 988.132L189.705 987.379C189.725 987.179 189.739 987.033 189.739 986.893C189.739 986.753 189.732 986.612 189.705 986.406L189.612 985.653L190.205 985.186L190.919 984.619L190.452 983.813L189.606 984.153L188.899 984.439L188.292 983.973C188.025 983.773 187.758 983.619 187.472 983.499L186.766 983.212L186.659 982.459L186.532 981.559H185.606L185.472 982.459ZM186.072 984.226C187.546 984.226 188.739 985.42 188.739 986.893C188.739 988.366 187.546 989.559 186.072 989.559C184.599 989.559 183.406 988.366 183.405 986.893C183.405 985.42 184.599 984.226 186.072 984.226ZM186.072 985.559C185.339 985.559 184.739 986.16 184.739 986.893C184.74 987.626 185.339 988.226 186.072 988.226C186.806 988.226 187.405 987.626 187.405 986.893C187.405 986.16 186.806 985.559 186.072 985.559Z',
  },
  'document': {
    // Material Icons "description" — 24×24 viewBox, Apache 2.0
    minX: 0, minY: 0, w: 24, h: 24,
    d: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  },
  'lightning': {
    // Material Icons "bolt" — 24×24 viewBox, Apache 2.0
    minX: 0, minY: 0, w: 24, h: 24,
    d: 'M7 2v11h3v9l7-12h-4l4-8z',
  },
  'diamond-alert': {
    minX: 179.387, minY: 2272.21, w: 13.367, h: 13.37,
    d: 'M186.071 2285.58C185.893 2285.58 185.724 2285.54 185.562 2285.48C185.401 2285.41 185.254 2285.31 185.121 2285.19L179.771 2279.84C179.649 2279.71 179.554 2279.56 179.487 2279.4C179.421 2279.24 179.387 2279.07 179.387 2278.89C179.387 2278.71 179.421 2278.54 179.487 2278.38C179.554 2278.21 179.649 2278.06 179.771 2277.94L185.121 2272.59C185.254 2272.46 185.401 2272.36 185.562 2272.3C185.724 2272.24 185.893 2272.21 186.071 2272.21C186.249 2272.21 186.421 2272.24 186.587 2272.3C186.754 2272.36 186.899 2272.46 187.021 2272.59L192.371 2277.94C192.504 2278.06 192.601 2278.21 192.662 2278.38C192.724 2278.54 192.754 2278.71 192.754 2278.89C192.754 2279.07 192.724 2279.24 192.662 2279.4C192.601 2279.56 192.504 2279.71 192.371 2279.84L187.021 2285.19C186.899 2285.31 186.754 2285.41 186.587 2285.48C186.421 2285.54 186.249 2285.58 186.071 2285.58ZM186.071 2284.24L191.421 2278.89L186.071 2273.54L180.721 2278.89L186.071 2284.24ZM185.404 2279.56H186.737V2275.56H185.404V2279.56ZM186.071 2281.56C186.26 2281.56 186.418 2281.5 186.546 2281.37C186.674 2281.24 186.737 2281.08 186.737 2280.89C186.737 2280.7 186.674 2280.55 186.546 2280.42C186.418 2280.29 186.26 2280.23 186.071 2280.23C185.882 2280.23 185.724 2280.29 185.596 2280.42C185.468 2280.55 185.404 2280.7 185.404 2280.89C185.404 2281.08 185.468 2281.24 185.596 2281.37C185.724 2281.5 185.882 2281.56 186.071 2281.56Z',
  },
  'lightbulb': {
    minX: 181.404, minY: 2595.23, w: 9.333, h: 13.33,
    d: 'M184.071 2607.89C184.071 2608.26 184.371 2608.56 184.737 2608.56H187.404C187.771 2608.56 188.071 2608.26 188.071 2607.89V2607.23H184.071V2607.89ZM186.071 2595.23C183.494 2595.23 181.404 2597.32 181.404 2599.89C181.404 2601.48 182.197 2602.88 183.404 2603.72V2605.23C183.404 2605.59 183.704 2605.89 184.071 2605.89H188.071C188.437 2605.89 188.737 2605.59 188.737 2605.23V2603.72C189.944 2602.88 190.737 2601.48 190.737 2599.89C190.737 2597.32 188.647 2595.23 186.071 2595.23ZM187.974 2602.63L187.404 2603.02V2604.56H184.737V2603.03L184.167 2602.63C183.271 2602 182.737 2600.98 182.737 2599.9C182.737 2598.06 184.234 2596.56 186.071 2596.56C187.907 2596.56 189.404 2598.06 189.404 2599.9C189.404 2600.98 188.871 2602 187.974 2602.63Z',
  },
  'star': {
    minX: 179.404, minY: 2918.56, w: 13.333, h: 12.67,
    d: 'M192.737 2923.39L187.944 2922.97L186.071 2918.56L184.197 2922.98L179.404 2923.39L183.044 2926.54L181.951 2931.23L186.071 2928.74L190.191 2931.23L189.104 2926.54L192.737 2923.39ZM186.071 2927.49L183.564 2929.01L184.231 2926.15L182.017 2924.23L184.937 2923.98L186.071 2921.29L187.211 2923.99L190.131 2924.24L187.917 2926.16L188.584 2929.01L186.071 2927.49Z',
  },
  'building': {
    minX: 179.737, minY: 3241.23, w: 12.667, h: 13.33,
    d: 'M182.737 3247.23H181.404V3251.89H182.737V3247.23ZM186.737 3247.23H185.404V3251.89H186.737V3247.23ZM192.404 3253.23H179.737V3254.56H192.404V3253.23ZM190.737 3247.23H189.404V3251.89H190.737V3247.23ZM186.071 3242.73L189.544 3244.56H182.597L186.071 3242.73ZM186.071 3241.23L179.737 3244.56V3245.89H192.404V3244.56L186.071 3241.23Z',
  },
};

// Map card type + actor to an icon key
function iconKey(type, actor) {
  if (type === 'person-action') return actor === 'supervisor' ? 'person-group' : 'person-single';
  if (type === 'staff-action')  return 'person-single';
  return { system: 'gear', 'data-entity': 'document',
           'domain-event': 'lightning', 'domain-event-published': 'lightning',
           'pain-point': 'diamond-alert', opportunity: 'lightbulb', note: null,
           policy: 'building' }[type] ?? null;
}

/**
 * Render a card-type icon at (x, y) top-left, scaled to ICON_SIZE × ICON_SIZE.
 * Uses SVG transform to map Figma coordinates to the target position.
 * Returns empty string for card types with no icon.
 */
function cardIcon(type, actor, x, y, color) {
  const key = iconKey(type, actor);
  if (!key) return '';
  const def = ICON_DEFS[key];
  if (!def) return '';
  const scale = ICON_SIZE / Math.max(def.w, def.h);
  const tx    = (x - def.minX * scale).toFixed(3);
  const ty    = (y - def.minY * scale).toFixed(3);
  return `<g transform="translate(${tx},${ty}) scale(${scale.toFixed(5)})"><path d="${def.d}" fill="${color}"/></g>`;
}

// ── SVG text helpers ──────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Word-wrap text to fit within wrapWidth at the given fontSize.
 * Returns an array of line strings.
 */
function wrapText(text, fontSize, wrapWidth) {
  const avgCharWidth = fontSize * 0.55;
  const maxChars = Math.max(1, Math.floor(wrapWidth / avgCharWidth));
  const words = String(text).split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

const LINE_HEIGHT_RATIO = 1.4;

function lineHeight(fontSize) {
  return fontSize * LINE_HEIGHT_RATIO;
}

/**
 * Render wrapped text as SVG <text> + <tspan> elements.
 * x, y are the top-left position of the text block (y is the top of the first line).
 */
function svgText(lines, x, y, fontSize, fill, bold = false) {
  const lh = lineHeight(fontSize);
  const weight = bold ? 'bold' : 'normal';
  // First tspan dy=fontSize positions the baseline at y+fontSize, so the visual
  // top of the text sits at approximately y. Subsequent tspans step down by lineHeight.
  const tspans = lines.map((line, i) => {
    const dy = i === 0 ? fontSize : lh;
    return `<tspan x="${x}" dy="${dy.toFixed(1)}">${escapeXml(line)}</tspan>`;
  }).join('');
  return `<text x="${x}" y="${y.toFixed(1)}" font-family="Inter, system-ui, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${tspans}</text>`;
}

function textBlockHeight(lines, fontSize) {
  return lines.length * lineHeight(fontSize);
}

// ── Card rendering ────────────────────────────────────────────────────────────

let clipIdCounter = 0;

/**
 * Render a card at (x, y) and return { svg: string, height: number }.
 */
function renderCard(card, x, y, cardWidth = CARD_WIDTH) {
  const p    = getPalette(card);
  const tw   = cardWidth - CARD_PADDING * 2;
  const parts = [];

  if (card.type === 'note') {
    const titleLines   = wrapText(card.text, 13, tw);
    const titleH       = textBlockHeight(titleLines, 13);
    let totalH         = CARD_PADDING + titleH + CARD_PADDING;
    let subtextLines   = [];
    if (card.subtext) {
      subtextLines = wrapText(card.subtext, 11, tw);
      totalH += 6 + textBlockHeight(subtextLines, 11);
    }

    parts.push(`<rect x="${x}" y="${y}" width="${cardWidth}" height="${totalH.toFixed(1)}" rx="${CARD_CORNER}" fill="${p.headerBg}"/>`);
    parts.push(svgText(titleLines, x + CARD_PADDING, y + CARD_PADDING, 13, p.headerFg, true));
    if (card.subtext) {
      const subtextY = y + CARD_PADDING + titleH + 6;
      parts.push(svgText(subtextLines, x + CARD_PADDING, subtextY, 11, p.bodyFg));
    }
    return { svg: parts.join('\n'), height: totalH };
  }

  // Typed card (header + optional body)
  const titleLines = wrapText(card.text, 14, tw);
  const titleH     = textBlockHeight(titleLines, 14);
  const labelLines = p.label ? [p.label] : [];
  const labelH     = p.label ? lineHeight(11) : 0;
  const headerH    = CARD_PADDING + titleH + (p.label ? 6 : 0) + labelH + CARD_PADDING;

  let bodyH        = 0;
  let subtextLines = [];
  if (card.subtext) {
    subtextLines = wrapText(card.subtext, 12, tw);
    bodyH = CARD_PADDING + textBlockHeight(subtextLines, 12) + CARD_PADDING;
  }
  const totalH = headerH + bodyH;

  const clipId = `cc${++clipIdCounter}`;
  parts.push(`<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${cardWidth}" height="${totalH.toFixed(1)}" rx="${CARD_CORNER}"/></clipPath>`);
  parts.push(`<g clip-path="url(#${clipId})">`);
  parts.push(`  <rect x="${x}" y="${y}" width="${cardWidth}" height="${headerH.toFixed(1)}" fill="${p.headerBg}"/>`);
  if (bodyH > 0) {
    parts.push(`  <rect x="${x}" y="${(y + headerH).toFixed(1)}" width="${cardWidth}" height="${bodyH.toFixed(1)}" fill="${p.bodyBg}"/>`);
  }
  parts.push(`</g>`);

  // Header text
  parts.push(svgText(titleLines, x + CARD_PADDING, y + CARD_PADDING, 14, p.headerFg, true));
  if (p.label) {
    const labelY = y + CARD_PADDING + titleH + 6;
    const icon = cardIcon(card.type, card.actor, x + CARD_PADDING, labelY, p.headerFg);
    if (icon) {
      parts.push(icon);
      parts.push(svgText(labelLines, x + CARD_PADDING + ICON_SIZE + ICON_GAP, labelY, 11, p.headerFg));
    } else {
      parts.push(svgText(labelLines, x + CARD_PADDING, labelY, 11, p.headerFg));
    }
  }

  // Body text
  if (card.subtext) {
    parts.push(svgText(subtextLines, x + CARD_PADDING, y + headerH + CARD_PADDING, 12, p.bodyFg));
  }

  return { svg: parts.join('\n'), height: totalH };
}

// ── Legend panel ──────────────────────────────────────────────────────────────

function renderLegend(blueprintName, x, y) {
  const parts = [];
  parts.push(`<rect x="${x}" y="${y}" width="${KEY_PANEL_WIDTH}" height="100" fill="#F8F8F8" id="legend-bg"/>`);

  // Title
  parts.push(`<text x="${x + 20}" y="${y + 24 + 13}" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="bold" fill="#1A1A1A">${escapeXml(blueprintName)}</text>`);
  parts.push(`<text x="${x + 20}" y="${y + 24 + 13 + 16 + 4 + 10}" font-family="Inter, system-ui, sans-serif" font-size="10" fill="#888888">Card types — copy to add</text>`);

  const sampleTypes = [
    { type: 'applicant-action',  card: { type: 'person-action', actor: 'applicant',  text: 'APPLICANT',  subtext: 'Description' } },
    { type: 'caseworker-action', card: { type: 'person-action', actor: 'caseworker', text: 'CASEWORKER', subtext: 'Description' } },
    { type: 'supervisor-action', card: { type: 'person-action', actor: 'supervisor', text: 'SUPERVISOR', subtext: 'Description' } },
    { type: 'system',                card: { type: 'system',                domain: 'domain', text: 'SYSTEM',     subtext: 'Description' } },
    { type: 'policy',                card: { type: 'policy',                               text: 'POLICY',     subtext: 'Description' } },
    { type: 'domain-event-published',  card: { type: 'domain-event-published',  text: 'EVENT',  subtext: 'Description' } },
    { type: 'data-entity',           card: { type: 'data-entity',                          text: 'DATA',       subtext: 'Description' } },
    { type: 'note',                  card: { type: 'note',                                 text: 'Note',       subtext: 'Description' } },
  ];

  let cardY = y + 24 + 13 + 16 + 4 + 10 + 14 + 20;
  const cardSvgParts = [];
  for (const { card } of sampleTypes) {
    const { svg, height } = renderCard(card, x + 20, cardY, KEY_CARD_WIDTH);
    cardSvgParts.push(svg);
    cardY += height + 10;
  }

  // Fix legend background height now that we know content height
  const legendHeight = cardY - y + 24;
  const fixedBg = `<rect x="${x}" y="${y}" width="${KEY_PANEL_WIDTH}" height="${legendHeight}" fill="#F8F8F8"/>`;
  parts[0] = fixedBg;
  parts.push(...cardSvgParts);

  return { svg: parts.join('\n'), height: legendHeight };
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderBlueprint(bp) {
  // Flatten phase → subPhase hierarchy into ordered column list
  const columns = []; // { phase, subPhase }
  for (const phase of bp.phases) {
    for (const subPhase of phase.subPhases) {
      columns.push({ phase, subPhase });
    }
  }
  const numCols = columns.length;

  const cellMap = new Map();
  for (const cell of bp.cells) {
    cellMap.set(`${cell.laneId}/${cell.subPhaseId}`, cell);
  }

  // First pass: render all cards, compute row heights
  // cardGrid[laneIdx][colIdx] = { rendered, srcCards }
  const cardGrid   = [];
  const rowHeights = [];

  for (let li = 0; li < bp.lanes.length; li++) {
    const lane    = bp.lanes[li];
    const laneRow = [];
    let maxH      = ROW_MIN_HEIGHT;

    for (let ci = 0; ci < numCols; ci++) {
      const { subPhase } = columns[ci];
      const entry    = cellMap.get(`${lane.id}/${subPhase.id}`);
      const srcCards = entry?.cards ?? [];

      const rendered = srcCards.map(c => renderCard(c, 0, 0, CARD_WIDTH));

      let h = CELL_PADDING;
      for (const r of rendered) h += r.height + CARD_GAP;
      h = rendered.length > 0 ? h - CARD_GAP + CELL_PADDING : CELL_PADDING * 2;

      const contentH = Math.max(h, ROW_MIN_HEIGHT);
      laneRow.push({ rendered, srcCards, contentH });
      maxH = Math.max(maxH, contentH);
    }

    cardGrid.push(laneRow);
    rowHeights.push(maxH);
  }

  const tableWidth  = LANE_LABEL_WIDTH + numCols * PHASE_WIDTH;
  const tableHeight = HEADER_HEIGHT + rowHeights.reduce((a, b) => a + b, 0);
  const totalWidth  = KEY_TOTAL + tableWidth;
  const totalHeight = Math.max(tableHeight, 400);

  const parts = [];

  // SVG root
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`);
  parts.push(`<defs></defs>`);
  parts.push(`<rect width="${totalWidth}" height="${totalHeight}" fill="#FFFFFF"/>`);

  // Legend
  const { svg: legendSvg } = renderLegend(bp.name, 0, 0);
  parts.push(legendSvg);

  const bpX  = KEY_TOTAL; // blueprint left edge
  const font = 'font-family="Inter, system-ui, sans-serif"';

  // ── Phase row ────────────────────────────────────────────────────────────────
  // "Phase" label in left column; phase label spanning its sub-phase columns.
  const phaseRowMidY = PHASE_ROW_H / 2 + 5; // approximate vertical center for text baseline
  parts.push(`<text x="${bpX + LANE_LABEL_WIDTH / 2}" y="${phaseRowMidY}" text-anchor="middle" ${font} font-size="13" font-weight="bold" fill="#1A1A1A">Phase</text>`);

  let colStart = 0;
  for (const phase of bp.phases) {
    const spanCols = phase.subPhases.length;
    const phaseX   = bpX + LANE_LABEL_WIDTH + colStart * PHASE_WIDTH;
    const phaseW   = spanCols * PHASE_WIDTH;
    const phaseMid = phaseX + phaseW / 2;
    parts.push(`<text x="${phaseMid}" y="${phaseRowMidY}" text-anchor="middle" ${font} font-size="15" font-weight="bold" fill="#1A1A1A">${escapeXml(phase.label)}</text>`);
    colStart += spanCols;
  }

  // Heavy rule below Phase row
  parts.push(`<line x1="${bpX}" y1="${PHASE_ROW_H}" x2="${bpX + tableWidth}" y2="${PHASE_ROW_H}" stroke="#1A1A1A" stroke-width="2"/>`);

  // ── Sub phase row ─────────────────────────────────────────────────────────────
  // "Sub phase" label in left column; sub-phase label per column.
  const subRowY    = PHASE_ROW_H;
  const subRowMidY = subRowY + SUBPHASE_ROW_H / 2 + 4;
  parts.push(`<text x="${bpX + LANE_LABEL_WIDTH / 2}" y="${subRowMidY}" text-anchor="middle" ${font} font-size="11" font-weight="bold" fill="#1A1A1A">Sub phase</text>`);

  for (let ci = 0; ci < numCols; ci++) {
    const { subPhase } = columns[ci];
    const colX   = bpX + LANE_LABEL_WIDTH + ci * PHASE_WIDTH;
    const colMid = colX + PHASE_WIDTH / 2;
    parts.push(`<text x="${colMid}" y="${subRowMidY}" text-anchor="middle" ${font} font-size="13" font-weight="bold" fill="#1A1A1A">${escapeXml(subPhase.label)}</text>`);
  }

  // Light rule below Sub phase row
  parts.push(`<line x1="${bpX}" y1="${HEADER_HEIGHT}" x2="${bpX + tableWidth}" y2="${HEADER_HEIGHT}" stroke="#AAAAAA" stroke-width="1"/>`);

  // ── Lane rows ─────────────────────────────────────────────────────────────────
  let rowY = HEADER_HEIGHT;

  for (let li = 0; li < bp.lanes.length; li++) {
    const lane = bp.lanes[li];
    const rowH = rowHeights[li];

    if (li > 0) {
      parts.push(`<line x1="${bpX}" y1="${rowY}" x2="${bpX + tableWidth}" y2="${rowY}" stroke="#CCCCCC" stroke-width="1"/>`);
    }

    // Lane label
    const midY = rowY + rowH / 2;
    parts.push(`<text x="${bpX + LANE_LABEL_WIDTH / 2}" y="${midY + 4}" text-anchor="middle" ${font} font-size="11" font-weight="bold" fill="#555555">${escapeXml(lane.label)}</text>`);

    // Lane label column divider
    parts.push(`<line x1="${bpX + LANE_LABEL_WIDTH}" y1="${rowY}" x2="${bpX + LANE_LABEL_WIDTH}" y2="${rowY + rowH}" stroke="#DDDDDD" stroke-width="1"/>`);

    // Cards in each sub-phase column
    for (let ci = 0; ci < numCols; ci++) {
      const { rendered, srcCards } = cardGrid[li][ci];
      const baseX = bpX + LANE_LABEL_WIDTH + ci * PHASE_WIDTH;

      let cardY = rowY + CELL_PADDING;
      for (let ri = 0; ri < rendered.length; ri++) {
        const { svg } = renderCard(srcCards[ri], baseX + CELL_PADDING, cardY, CARD_WIDTH);
        parts.push(svg);
        cardY += rendered[ri].height + CARD_GAP;
      }

      // Column divider — slightly heavier at phase boundaries
      if (ci < numCols - 1) {
        const isPhaseEnd = columns[ci].phase !== columns[ci + 1].phase;
        const divColor = isPhaseEnd ? '#1A1A1A' : '#DDDDDD';
        const divWidth = isPhaseEnd ? 3 : 1;
        parts.push(`<line x1="${baseX + PHASE_WIDTH}" y1="${rowY}" x2="${baseX + PHASE_WIDTH}" y2="${rowY + rowH}" stroke="${divColor}" stroke-width="${divWidth}"/>`);
      }
    }

    rowY += rowH;
  }

  // Outer edges
  parts.push(`<line x1="${bpX}" y1="${rowY}" x2="${bpX + tableWidth}" y2="${rowY}" stroke="#AAAAAA" stroke-width="1"/>`);
  parts.push(`<line x1="${bpX}" y1="${HEADER_HEIGHT}" x2="${bpX}" y2="${rowY}" stroke="#AAAAAA" stroke-width="1"/>`);
  parts.push(`<line x1="${bpX + tableWidth}" y1="${HEADER_HEIGHT}" x2="${bpX + tableWidth}" y2="${rowY}" stroke="#AAAAAA" stroke-width="1"/>`);

  parts.push(`</svg>`);

  return parts.join('\n');
}

// ── Write output ──────────────────────────────────────────────────────────────

const svg = renderBlueprint(blueprint);
writeFileSync(outPath, svg);
console.log(`Wrote ${outPath}`);
