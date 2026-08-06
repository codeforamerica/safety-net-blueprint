/**
 * Shared SVG-diagram primitives for this spike's visualizer scripts
 * (visualize-rules.js, visualize-fact-graph.js). Reuses
 * packages/explorer/context-map/src/render.js's own visual language (font,
 * palette) rather than inventing a new one, so a reader who's seen the context
 * map recognizes the same meaning -- and so this stays a natural fit if it's
 * ever folded into packages/explorer alongside context-map/state-machine-docs.
 */

import { basename } from 'node:path';

export const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
export const MONOSPACE = 'ui-monospace,SFMono-Regular,Menlo,monospace';

// Raw palette values, matching context-map's own colors. Each visualizer assigns
// its own semantic meaning to these (see each script's own COLOR mapping) --
// kept here just so the actual hex values live in one place.
export const PALETTE = {
  teal: { fill: '#E2F9F6', stroke: '#00AD93' },
  purple: { fill: '#E6EBF9', stroke: '#5650BE' },
  navy: { fill: 'rgba(43,26,120,0.08)', stroke: '#2B1A78' },
  amber: { fill: '#FFF8E1', stroke: '#E65100' },
  tan: { fill: '#F3F3F3', stroke: '#E9CCBE' },
  flag: '#AF121D',
};

export function escapeXml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Greedy word-wrap -- rough character-count estimate, not real font-metrics
 * measurement, but good enough for a diagram whose job is showing real content
 * exists, not perfect typesetting. Avoids orphaning a short trailing fragment
 * (e.g. an assignment's own "= true", split off from the attribute name it
 * belongs to) onto its own final line: confirmed confusing in practice -- a real
 * example split "THEN Applicant.isProgramBEligible" from its own "= true" across
 * two lines, reading like the rule was cut off mid-statement. If the last line
 * ends up much shorter than the wrap width, pull words back from the previous
 * line until it's reasonably balanced (or merge fully if it still fits).
 */
export function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/);
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

  while (lines.length > 1 && lines[lines.length - 1].length < maxChars * 0.3) {
    const last = lines.pop();
    const prev = lines.pop();
    const merged = `${prev} ${last}`;
    if (merged.length <= maxChars * 1.25) {
      lines.push(merged);
    } else {
      // Merging fully would overflow too much -- move just the last word of
      // `prev` down to `last` instead, one word at a time, to balance them.
      const prevWords = prev.split(' ');
      const movedWord = prevWords.pop();
      lines.push(prevWords.join(' '));
      lines.push(`${movedWord} ${last}`);
      break;
    }
  }
  return lines;
}

const HEADER_H = 24;
const SUBLABEL_H = 18;
const LINE_H = 15;
const BOX_PAD_V = 10;

/** Draws one box with a title, optional sublabel, and a list of pre-wrapped body lines (monospace, for expression/rule text), sizing the box to fit them. Returns the box's own height so the caller can position what comes next. */
export function box(x, y, width, title, sublabel, bodyLines, style, dashed) {
  const parts = [];
  const height = HEADER_H + (sublabel ? SUBLABEL_H : 0) + bodyLines.length * LINE_H + BOX_PAD_V * 2;
  parts.push(
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.5"${dashed ? ' stroke-dasharray="5,4"' : ''}/>`
  );
  let ty = y + BOX_PAD_V + 14;
  parts.push(`<text x="${x + 12}" y="${ty}" font-size="13" font-weight="700" fill="#111827" font-family="${FONT}">${escapeXml(title)}</text>`);
  if (sublabel) {
    ty += SUBLABEL_H;
    parts.push(`<text x="${x + 12}" y="${ty}" font-size="11" fill="#374151" font-family="${FONT}">${escapeXml(sublabel)}</text>`);
  }
  for (const line of bodyLines) {
    ty += LINE_H;
    parts.push(`<text x="${x + 12}" y="${ty}" font-size="10.5" fill="#1f2937" font-family="${MONOSPACE}">${escapeXml(line)}</text>`);
  }
  return { svg: parts.join('\n'), height };
}

export function arrow(x1, y1, x2, y2, label) {
  const parts = [];
  parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#6b7280" stroke-width="1.5" marker-end="url(#arrow)"/>`);
  if (label) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    parts.push(`<rect x="${mx - label.length * 3.2 - 4}" y="${my - 9}" width="${label.length * 6.4 + 8}" height="16" fill="white"/>`);
    parts.push(`<text x="${mx}" y="${my + 3}" font-size="11" fill="#374151" text-anchor="middle" font-family="${FONT}">${escapeXml(label)}</text>`);
  }
  return parts.join('\n');
}

/**
 * Renders a flat text list of attribute paths in field-inventory format
 * (e.g. "ApplicationMember.dob: Date"), grouped by vocabulary file and arranged
 * in up to 3 columns. Used for the inputs strip (top) and outputs strip (bottom)
 * of the rules and graph diagrams. No connecting edges -- reference panels only.
 *
 * attrMap: object or Map mapping "Entity.attribute" -> { entity, attribute, datatype, vocabFile }
 */
export function layoutAttributeStrip(attrMap, stripLabel, originX, originY) {
  const entries = attrMap instanceof Map ? [...attrMap.values()] : Object.values(attrMap);
  if (!entries.length) return { svg: '', width: 0, exitY: originY };

  // Group by vocabFile, sort within each group
  const byVocab = new Map();
  for (const { entity, attribute, datatype, vocabFile } of entries) {
    const key = vocabFile ?? null;
    if (!byVocab.has(key)) byVocab.set(key, []);
    byVocab.get(key).push(`${entity}.${attribute}: ${datatype ?? '?'}`);
  }
  for (const lines of byVocab.values()) lines.sort();

  // Flatten with "Vocabulary: <file>" header before each group
  const lines = [];
  for (const [vocabFile, attrLines] of byVocab) {
    const label = vocabFile ? `Vocabulary: ${basename(vocabFile)}` : 'Vocabulary: (not in vocabulary file)';
    lines.push({ text: label, isHeader: true });
    for (const entry of attrLines) lines.push({ text: entry, isHeader: false });
  }

  const dataLines = lines.filter(l => !l.isHeader).length;
  const COLS = Math.min(3, dataLines);
  const colSize = Math.ceil(lines.length / COLS);
  const LINE_H = 15;
  const COL_W = 380;
  const startY = originY + 22;

  const svg = [];
  svg.push(`<text x="${originX}" y="${originY}" font-size="13" font-weight="700" fill="#374151" font-family="${FONT}">${escapeXml(stripLabel)}</text>`);

  lines.forEach((line, i) => {
    const col = Math.floor(i / colSize);
    const row = i % colSize;
    const x = originX + col * COL_W;
    const y = startY + row * LINE_H;
    if (line.isHeader) {
      svg.push(`<text x="${x}" y="${y}" font-size="10.5" font-weight="700" fill="#6b7280" font-family="${FONT}">${escapeXml(line.text)}</text>`);
    } else {
      svg.push(`<text x="${x}" y="${y}" font-size="10.5" fill="#1f2937" font-family="${MONOSPACE}">${escapeXml(line.text)}</text>`);
    }
  });

  return { svg: svg.join('\n'), width: COLS * COL_W, exitY: startY + colSize * LINE_H };
}

/**
 * Returns just the bare `<svg>` element with the shared arrowhead defs. Used by
 * visualize-combined.js to embed SVGs inline -- the arrow marker id must be
 * unique per SVG (passed as markerId) to avoid id collisions across two diagrams
 * in the same HTML document.
 */
export function rawSvgElement(markerId, width, height, bodySvg) {
  const markerRef = markerId ?? 'arrow';
  // Replace url(#arrow) with url(#<markerId>) so references stay local
  const body = markerRef === 'arrow' ? bodySvg : bodySvg.replaceAll('url(#arrow)', `url(#${markerRef})`);
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="${markerRef}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0 L8,4 L0,8 Z" fill="#6b7280"/>
    </marker>
  </defs>
  ${body}
</svg>`;
}

/** Wraps rendered SVG body content into a complete, standalone HTML document. */
export function wrapSvgAsHtml(title, width, height, bodySvg) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeXml(title)}</title></head>
<body style="margin:0;background:#fafafa;font-family:${FONT}">
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0 L8,4 L0,8 Z" fill="#6b7280"/>
    </marker>
  </defs>
  ${bodySvg}
</svg>
</body></html>`;
}
