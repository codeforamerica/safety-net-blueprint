import { Blueprint, Card, CardType, Cell, Lane, Phase } from './types.js';

// ── Layout constants ─────────────────────────────────────────────────────────

const LANE_LABEL_WIDTH = 140;
const PHASE_WIDTH      = 280;
const HEADER_HEIGHT    = 56;
const CELL_PADDING     = 12;
const CARD_GAP         = 8;
const CARD_CORNER      = 6;
const BORDER_COLOR     = '#DEE2E6';
const HEADER_BG        = '#1565C0';
const HEADER_FG        = '#FFFFFF';
const PHASE_SUB_FG     = '#90CAF9';

// ── Card color palette ───────────────────────────────────────────────────────

interface CardPalette { bg: string; fg: string; border: string; label: string }

const CARD_PALETTE: Record<CardType, CardPalette> = {
  'ux-opportunity':      { bg: '#E8F5E9', fg: '#2E7D32', border: '#66BB6A', label: 'UX opportunity' },
  'pain-point':          { bg: '#FBE9E7', fg: '#BF360C', border: '#FF8A65', label: 'Pain point' },
  'program-requirement': { bg: '#E3F2FD', fg: '#1565C0', border: '#64B5F6', label: 'Requirement' },
  'data-entity':         { bg: '#E0F2F1', fg: '#00695C', border: '#4DB6AC', label: 'Data' },
  'domain-event':        { bg: '#EDE7F6', fg: '#4527A0', border: '#9575CD', label: 'Event' },
  'note':                { bg: '#F5F5F5', fg: '#424242', border: '#BDBDBD', label: '' },
};

// ── Color helpers ────────────────────────────────────────────────────────────

function hex(h: string): RGB {
  return {
    r: parseInt(h.slice(1, 3), 16) / 255,
    g: parseInt(h.slice(3, 5), 16) / 255,
    b: parseInt(h.slice(5, 7), 16) / 255,
  };
}

function fill(color: string): SolidPaint[] {
  return [{ type: 'SOLID', color: hex(color) }];
}

function stroke(color: string): SolidPaint[] {
  return [{ type: 'SOLID', color: hex(color) }];
}

// ── Frame helpers ────────────────────────────────────────────────────────────

function frame(name: string): FrameNode {
  const f = figma.createFrame();
  f.name = name;
  f.fills = [];
  f.clipsContent = false;
  return f;
}

function hStack(name: string, gap = 0): FrameNode {
  const f = frame(name);
  f.layoutMode = 'HORIZONTAL';
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  f.primaryAxisAlignItems = 'MIN';
  f.counterAxisAlignItems = 'MIN';
  f.itemSpacing = gap;
  return f;
}

function vStack(name: string, gap = 0): FrameNode {
  const f = frame(name);
  f.layoutMode = 'VERTICAL';
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  f.primaryAxisAlignItems = 'MIN';
  f.counterAxisAlignItems = 'MIN';
  f.itemSpacing = gap;
  return f;
}

// ── Text helper ──────────────────────────────────────────────────────────────

function text(
  content: string,
  size: number,
  style: 'Regular' | 'Medium' | 'Semi Bold',
  color: string,
  width?: number
): TextNode {
  const t = figma.createText();
  t.fontName = { family: 'Inter', style };
  t.fontSize = size;
  t.fills = fill(color);
  t.characters = content;
  if (width !== undefined) {
    t.textAutoResize = 'HEIGHT';
    t.resize(width, t.height);
  }
  return t;
}

// ── Card renderer ────────────────────────────────────────────────────────────

function renderCard(card: Card): FrameNode {
  const palette = CARD_PALETTE[card.type];
  const textWidth = PHASE_WIDTH - CELL_PADDING * 2 - CARD_PADDING * 2;

  const wrapper = vStack(`card:${card.type}`, 4);
  wrapper.paddingTop    = CARD_PADDING;
  wrapper.paddingBottom = CARD_PADDING;
  wrapper.paddingLeft   = CARD_PADDING;
  wrapper.paddingRight  = CARD_PADDING;
  wrapper.fills         = fill(palette.bg);
  wrapper.strokes       = stroke(palette.border);
  wrapper.strokeWeight  = 1;
  wrapper.cornerRadius  = CARD_CORNER;
  wrapper.resize(PHASE_WIDTH - CELL_PADDING * 2, 1);
  wrapper.primaryAxisSizingMode   = 'AUTO';
  wrapper.counterAxisSizingMode   = 'FIXED';

  if (palette.label) {
    const label = text(palette.label, 9, 'Semi Bold', palette.fg, textWidth);
    wrapper.appendChild(label);
    label.layoutSizingHorizontal = 'FILL';
  }

  const main = text(card.text, 11, 'Medium', palette.fg, textWidth);
  wrapper.appendChild(main);
  main.layoutSizingHorizontal = 'FILL';

  if (card.subtext) {
    const sub = text(card.subtext, 10, 'Regular', palette.fg, textWidth);
    sub.opacity = 0.72;
    wrapper.appendChild(sub);
    sub.layoutSizingHorizontal = 'FILL';
  }

  return wrapper;
}

// ── Cell renderer ────────────────────────────────────────────────────────────

function renderCell(cards: Card[], phaseId: string, laneId: string): FrameNode {
  const cell = vStack(`cell:${laneId}/${phaseId}`, CARD_GAP);
  cell.paddingTop    = CELL_PADDING;
  cell.paddingBottom = CELL_PADDING;
  cell.paddingLeft   = CELL_PADDING;
  cell.paddingRight  = CELL_PADDING;
  cell.resize(PHASE_WIDTH, 1);
  cell.primaryAxisSizingMode = 'AUTO';
  cell.counterAxisSizingMode = 'FIXED';
  cell.strokes      = stroke(BORDER_COLOR);
  cell.strokeWeight = 1;
  cell.strokeAlign  = 'INSIDE';

  for (const card of cards) {
    cell.appendChild(renderCard(card));
  }

  return cell;
}

// ── Phase header cell ────────────────────────────────────────────────────────

function renderPhaseHeader(phase: Phase): FrameNode {
  const cell = vStack(`phase:${phase.id}`, 4);
  cell.paddingTop    = 10;
  cell.paddingBottom = 10;
  cell.paddingLeft   = 12;
  cell.paddingRight  = 12;
  cell.resize(PHASE_WIDTH, HEADER_HEIGHT);
  cell.primaryAxisSizingMode = 'FIXED';
  cell.counterAxisSizingMode = 'FIXED';
  cell.primaryAxisAlignItems = 'CENTER';
  cell.fills   = fill(HEADER_BG);
  cell.strokes = stroke(BORDER_COLOR);
  cell.strokeWeight = 1;
  cell.strokeAlign  = 'INSIDE';

  cell.appendChild(text(phase.label, 13, 'Semi Bold', HEADER_FG));
  if (phase.sublabel) {
    cell.appendChild(text(phase.sublabel, 11, 'Regular', PHASE_SUB_FG));
  }

  return cell;
}

// ── Lane label cell ──────────────────────────────────────────────────────────

function renderLaneLabel(lane: Lane, height: number): FrameNode {
  const cell = vStack(`lane:${lane.id}`);
  cell.resize(LANE_LABEL_WIDTH, height);
  cell.primaryAxisSizingMode = 'FIXED';
  cell.counterAxisSizingMode = 'FIXED';
  cell.primaryAxisAlignItems = 'CENTER';
  cell.counterAxisAlignItems = 'CENTER';
  cell.fills   = fill(lane.headerBg);
  cell.strokes = stroke(BORDER_COLOR);
  cell.strokeWeight = 1;
  cell.strokeAlign  = 'INSIDE';

  const label = text(lane.label, 12, 'Semi Bold', lane.headerFg);
  label.textAlignHorizontal = 'CENTER';
  label.textAutoResize = 'WIDTH_AND_HEIGHT';
  cell.appendChild(label);

  return cell;
}

// ── Corner cell ──────────────────────────────────────────────────────────────

function renderCorner(): FrameNode {
  const cell = frame('corner');
  cell.resize(LANE_LABEL_WIDTH, HEADER_HEIGHT);
  cell.fills   = fill(HEADER_BG);
  cell.strokes = stroke(BORDER_COLOR);
  cell.strokeWeight = 1;
  cell.strokeAlign  = 'INSIDE';
  return cell;
}

// ── Main render function ─────────────────────────────────────────────────────

export async function renderBlueprint(blueprint: Blueprint): Promise<void> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  // Index cells by "laneId/phaseId"
  const cellMap = new Map<string, Cell>();
  for (const cell of blueprint.cells) {
    cellMap.set(`${cell.laneId}/${cell.phaseId}`, cell);
  }

  const outer = vStack(blueprint.name, 0);
  outer.fills = fill('#FFFFFF');

  // ── Header row ──
  const headerRow = hStack('header', 0);
  headerRow.appendChild(renderCorner());
  for (const phase of blueprint.phases) {
    headerRow.appendChild(renderPhaseHeader(phase));
  }
  outer.appendChild(headerRow);

  // ── Lane rows ──
  for (const lane of blueprint.lanes) {
    // Render all phase cells first so we can measure the tallest one
    const cells: FrameNode[] = blueprint.phases.map((phase) => {
      const entry = cellMap.get(`${lane.id}/${phase.id}`);
      return renderCell(entry?.cards ?? [], phase.id, lane.id);
    });

    // Row height = tallest cell (after auto-layout settles)
    // Figma auto-layout sizes frames when children are added to the canvas.
    // We use a temporary parent to force layout, then measure.
    const tempRow = hStack('_measure', 0);
    figma.currentPage.appendChild(tempRow);
    for (const c of cells) tempRow.appendChild(c);
    const rowHeight = Math.max(tempRow.height, 80);
    // Detach children to re-parent into the real row
    for (const c of cells) c.remove();
    tempRow.remove();

    const row = hStack(`lane:${lane.id}`, 0);
    if (lane.rowBg) row.fills = fill(lane.rowBg);

    row.appendChild(renderLaneLabel(lane, rowHeight));
    for (const c of cells) row.appendChild(c);

    outer.appendChild(row);
  }

  figma.currentPage.appendChild(outer);
  figma.viewport.scrollAndZoomIntoView([outer]);

  figma.notify(`Generated: ${blueprint.name}`);
}
