import { ActorType, Blueprint, Card, CardType, Cell, Phase, SubPhase } from './types.js';

// ── Layout constants ──────────────────────────────────────────────────────────

const PHASE_WIDTH      = 280;
const LANE_LABEL_WIDTH = 120;
const HEADER_HEIGHT    = 72;   // two-row header: phase group (top) + sub-phase (bottom)
const PHASE_HEADER_H   = 30;   // height of the phase group row
const CELL_PADDING     = 12;
const CARD_WIDTH       = PHASE_WIDTH - CELL_PADDING * 2;  // 256
const CARD_PADDING     = 14;
const CARD_CORNER      = 8;
const CARD_GAP         = 12;
const KEY_CARD_WIDTH   = 220;
const KEY_PANEL_WIDTH  = KEY_CARD_WIDTH + 40;
const KEY_GAP          = 56;
const KEY_TOTAL        = KEY_PANEL_WIDTH + KEY_GAP;
const ROW_MIN_HEIGHT   = 80;

// ── Card palette ──────────────────────────────────────────────────────────────
// Colors match the established service blueprint convention.
// domain-event and data-entity use related teal/blue tones (both are data-layer concerns).
// No icon prefixes — Unicode characters don't match the SVG icons in existing blueprints.

interface CardPalette {
  headerBg: string;
  bodyBg:   string;
  headerFg: string;
  bodyFg:   string;
  label:    string;
}

const PALETTE: Record<CardType, CardPalette> = {
  'staff-action':  { headerBg: '#5C4B9A', bodyBg: '#EAE5F5', headerFg: '#FFFFFF', bodyFg: '#2A2040', label: 'STAFF ACTION'  },
  'system':        { headerBg: '#1E6B4A', bodyBg: '#D4EDE1', headerFg: '#FFFFFF', bodyFg: '#0A2E1E', label: 'SYSTEM'        },
  'policy':        { headerBg: '#C4A882', bodyBg: '#F5EDE0', headerFg: '#3D2B0E', bodyFg: '#3D2B0E', label: 'POLICY'        },
  'pain-point':    { headerBg: '#C05C5C', bodyBg: '#F5D4D4', headerFg: '#1A0A0A', bodyFg: '#2A1A1A', label: 'PAIN POINT'   },
  'opportunity':   { headerBg: '#E8A030', bodyBg: '#FFF0D0', headerFg: '#3D2800', bodyFg: '#3D2800', label: 'OPPORTUNITY'   },
  'domain-event':  { headerBg: '#0D7B8C', bodyBg: '#D0EEF2', headerFg: '#FFFFFF', bodyFg: '#0A2E34', label: 'EVENT'         },
  'data-entity':   { headerBg: '#2B5F8E', bodyBg: '#D0E2F0', headerFg: '#FFFFFF', bodyFg: '#0A1E34', label: 'DATA'          },
  'note':          { headerBg: '#FFFDE7', bodyBg: '#FFFDE7', headerFg: '#333333', bodyFg: '#555555', label: ''              },
  'person-action': { headerBg: '#5C4B9A', bodyBg: '#EAE5F5', headerFg: '#FFFFFF', bodyFg: '#2A2040', label: 'PERSON'        },
};

// Per-actor colors for person-action cards. Overrides PALETTE['person-action'] when actor is set.
const ACTOR_PALETTE: Record<ActorType, CardPalette> = {
  'applicant':  { headerBg: '#D97C20', bodyBg: '#FDECD4', headerFg: '#3D1800', bodyFg: '#3D1800', label: 'APPLICANT'  },
  'caseworker': { headerBg: '#5C4B9A', bodyBg: '#EAE5F5', headerFg: '#FFFFFF', bodyFg: '#2A2040', label: 'CASEWORKER' },
  'supervisor': { headerBg: '#3D5C8C', bodyBg: '#D4DCE8', headerFg: '#FFFFFF', bodyFg: '#0A1E34', label: 'SUPERVISOR' },
  'system':     { headerBg: '#1E6B4A', bodyBg: '#D4EDE1', headerFg: '#FFFFFF', bodyFg: '#0A2E1E', label: 'SYSTEM'     },
};

// ── Color helpers ─────────────────────────────────────────────────────────────

function rgb(h: string): RGB {
  return {
    r: parseInt(h.slice(1, 3), 16) / 255,
    g: parseInt(h.slice(3, 5), 16) / 255,
    b: parseInt(h.slice(5, 7), 16) / 255,
  };
}

function fill(color: string): SolidPaint[] {
  return [{ type: 'SOLID', color: rgb(color) }];
}

// ── Frame helpers ─────────────────────────────────────────────────────────────

function vFrame(name: string, gap = 0): FrameNode {
  const f = figma.createFrame();
  f.name = name;
  f.fills = [];
  f.layoutMode = 'VERTICAL';
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  f.itemSpacing = gap;
  f.clipsContent = false;
  return f;
}

function freeFrame(name: string): FrameNode {
  const f = figma.createFrame();
  f.name = name;
  f.fills = [];
  f.layoutMode = 'NONE';
  f.clipsContent = false;
  return f;
}

// ── Text helper ───────────────────────────────────────────────────────────────

function txt(
  content: string,
  size: number,
  style: 'Regular' | 'Medium' | 'Semi Bold',
  color: string,
  wrapWidth?: number
): TextNode {
  const t = figma.createText();
  t.fontName = { family: 'Inter', style };
  t.fontSize = size;
  t.fills = fill(color);
  t.characters = content;
  if (wrapWidth !== undefined) {
    t.textAutoResize = 'HEIGHT';
    t.resize(wrapWidth, t.height);
  }
  return t;
}

// ── Divider helpers ───────────────────────────────────────────────────────────

function hDivider(container: FrameNode, x: number, y: number, width: number, color = '#CCCCCC'): void {
  const r = figma.createRectangle();
  container.appendChild(r);
  r.x = x; r.y = y;
  r.resize(width, 1);
  r.fills = fill(color);
}

function vDivider(container: FrameNode, x: number, y: number, height: number, color = '#DDDDDD'): void {
  const r = figma.createRectangle();
  container.appendChild(r);
  r.x = x; r.y = y;
  r.resize(1, height);
  r.fills = fill(color);
}

// ── Card rendering ────────────────────────────────────────────────────────────

// Note cards: single cream section, no type label.
function renderNoteCard(card: Card, cardWidth: number): FrameNode {
  const p = PALETTE['note'];
  const textWidth = cardWidth - CARD_PADDING * 2;

  const f = vFrame('card:note', 6);
  f.fills = fill(p.headerBg);
  f.paddingTop = f.paddingBottom = CARD_PADDING;
  f.paddingLeft = f.paddingRight = CARD_PADDING;
  f.resize(cardWidth, 1);
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'FIXED';
  f.cornerRadius = CARD_CORNER;

  const titleNode = txt(card.text, 13, 'Semi Bold', p.headerFg, textWidth);
  f.appendChild(titleNode);
  titleNode.layoutSizingHorizontal = 'FILL';

  if (card.subtext) {
    const sub = txt(card.subtext, 11, 'Regular', p.bodyFg, textWidth);
    f.appendChild(sub);
    sub.layoutSizingHorizontal = 'FILL';
  }

  return f;
}

// Typed cards: colored header (title + label) + lighter body (subtext).
function renderTypedCard(card: Card, cardWidth: number): FrameNode {
  const p = card.type === 'person-action' && card.actor
    ? ACTOR_PALETTE[card.actor]
    : PALETTE[card.type];
  const textWidth = cardWidth - CARD_PADDING * 2;

  const header = vFrame('header', 6);
  header.fills = fill(p.headerBg);
  header.paddingTop = header.paddingBottom = CARD_PADDING;
  header.paddingLeft = header.paddingRight = CARD_PADDING;
  header.resize(cardWidth, 1);
  header.primaryAxisSizingMode = 'AUTO';
  header.counterAxisSizingMode = 'FIXED';

  const titleNode = txt(card.text, 14, 'Semi Bold', p.headerFg, textWidth);
  header.appendChild(titleNode);
  titleNode.layoutSizingHorizontal = 'FILL';

  const labelNode = txt(p.label, 11, 'Regular', p.headerFg, textWidth);
  header.appendChild(labelNode);
  labelNode.layoutSizingHorizontal = 'FILL';

  const cardFrame = vFrame(`card:${card.type}`, 0);
  cardFrame.resize(cardWidth, 1);
  cardFrame.primaryAxisSizingMode = 'AUTO';
  cardFrame.counterAxisSizingMode = 'FIXED';
  cardFrame.cornerRadius = CARD_CORNER;
  cardFrame.clipsContent = true;
  cardFrame.appendChild(header);

  if (card.subtext) {
    const body = vFrame('body', 0);
    body.fills = fill(p.bodyBg);
    body.paddingTop = body.paddingBottom = CARD_PADDING;
    body.paddingLeft = body.paddingRight = CARD_PADDING;
    body.resize(cardWidth, 1);
    body.primaryAxisSizingMode = 'AUTO';
    body.counterAxisSizingMode = 'FIXED';

    const sub = txt(card.subtext, 12, 'Regular', p.bodyFg, textWidth);
    body.appendChild(sub);
    sub.layoutSizingHorizontal = 'FILL';

    cardFrame.appendChild(body);
  }

  return cardFrame;
}

export function renderCard(card: Card, cardWidth: number = CARD_WIDTH): FrameNode {
  return card.type === 'note'
    ? renderNoteCard(card, cardWidth)
    : renderTypedCard(card, cardWidth);
}

// ── Legend key ────────────────────────────────────────────────────────────────

function buildKey(blueprintName: string): FrameNode {
  const panel = freeFrame('Legend');
  panel.fills = fill('#F8F8F8');
  panel.resize(KEY_PANEL_WIDTH, 100);

  const title = txt(blueprintName, 13, 'Semi Bold', '#1A1A1A');
  panel.appendChild(title);
  title.x = 20; title.y = 24;

  const sub = txt('Card types — copy to add', 10, 'Regular', '#888888');
  panel.appendChild(sub);
  sub.x = 20; sub.y = 24 + title.height + 4;

  let y = 24 + title.height + 4 + sub.height + 20;

  // Standard card types (not person-action — those are shown per-actor below)
  const types: CardType[] = [
    'system', 'policy',
    'pain-point', 'opportunity',
    'domain-event', 'data-entity',
    'note',
  ];

  // Person-action actor variants shown first
  const actors: ActorType[] = ['applicant', 'caseworker', 'supervisor'];
  for (const actor of actors) {
    const sample = renderCard(
      { type: 'person-action', actor, text: ACTOR_PALETTE[actor].label, subtext: 'Action taken' },
      KEY_CARD_WIDTH
    );
    panel.appendChild(sample);
    sample.x = 20; sample.y = y;
    y += sample.height + 10;
  }

  for (const type of types) {
    const p = PALETTE[type];
    const sample = renderCard(
      { type, text: p.label || 'Note', subtext: 'Description' },
      KEY_CARD_WIDTH
    );
    panel.appendChild(sample);
    sample.x = 20; sample.y = y;
    y += sample.height + 10;
  }

  panel.resize(KEY_PANEL_WIDTH, y + 24);
  return panel;
}

// ── Main render ───────────────────────────────────────────────────────────────

// Flat sub-phase entry carrying its parent phase reference
interface SubPhaseEntry extends SubPhase {
  phase: Phase;
}

export async function renderBlueprint(blueprint: Blueprint): Promise<void> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  // Build flat column list from nested phases → subPhases
  const columns: SubPhaseEntry[] = [];
  for (const phase of blueprint.phases) {
    for (const sp of phase.subPhases) {
      columns.push({ ...sp, phase });
    }
  }

  const cellMap = new Map<string, Cell>();
  for (const cell of blueprint.cells) {
    cellMap.set(`${cell.laneId}/${cell.subPhaseId}`, cell);
  }

  // ── First pass: render all cards, compute row heights ──────────────────────
  // Cards are NOT wrapped in cell frames — they become direct children of the
  // container so designers can select and drag them with a single click.

  interface RenderedCell { cards: FrameNode[]; contentHeight: number }
  const cellGrid: RenderedCell[][] = [];
  const rowHeights: number[] = [];

  for (const lane of blueprint.lanes) {
    const laneRow: RenderedCell[] = [];
    let maxH = ROW_MIN_HEIGHT;

    for (const col of columns) {
      const entry = cellMap.get(`${lane.id}/${col.id}`);
      const cards = (entry?.cards ?? []).map(c => renderCard(c, CARD_WIDTH));

      let h = CELL_PADDING;
      for (const card of cards) h += card.height + CARD_GAP;
      if (cards.length > 0) h = h - CARD_GAP + CELL_PADDING;
      else h = CELL_PADDING * 2;

      const contentHeight = Math.max(h, ROW_MIN_HEIGHT);
      laneRow.push({ cards, contentHeight });
      maxH = Math.max(maxH, contentHeight);
    }

    cellGrid.push(laneRow);
    rowHeights.push(maxH);
  }

  const tableWidth  = LANE_LABEL_WIDTH + columns.length * PHASE_WIDTH;
  const tableHeight = HEADER_HEIGHT + rowHeights.reduce((a, b) => a + b, 0);
  const totalWidth  = KEY_TOTAL + tableWidth;

  // ── Container ──────────────────────────────────────────────────────────────
  const container = freeFrame(blueprint.name);
  container.fills = fill('#FFFFFF');
  container.resize(totalWidth, Math.max(tableHeight, 400));
  figma.currentPage.appendChild(container);

  // ── Legend key ─────────────────────────────────────────────────────────────
  const key = buildKey(blueprint.name);
  container.appendChild(key);
  key.x = 0; key.y = 0;

  const bpX = KEY_TOTAL; // blueprint left edge

  // ── Phase group headers (top row) ──────────────────────────────────────────
  // One label per phase, spanning all its sub-phase columns.
  {
    let colOffset = 0;
    for (const phase of blueprint.phases) {
      const spanW = phase.subPhases.length * PHASE_WIDTH;
      const spanX = bpX + LANE_LABEL_WIDTH + colOffset * PHASE_WIDTH;

      const label = txt(phase.label, 13, 'Semi Bold', '#1A1A1A');
      container.appendChild(label);
      label.x = spanX + (spanW - label.width) / 2;
      label.y = 8;

      colOffset += phase.subPhases.length;

      // Phase group divider (right edge, not after last phase)
      if (colOffset < columns.length) {
        vDivider(container, bpX + LANE_LABEL_WIDTH + colOffset * PHASE_WIDTH, 0, HEADER_HEIGHT, '#AAAAAA');
      }
    }
  }

  // Mid-header rule separating phase row from sub-phase row
  hDivider(container, bpX + LANE_LABEL_WIDTH, PHASE_HEADER_H, tableWidth - LANE_LABEL_WIDTH, '#CCCCCC');

  // ── Sub-phase headers (bottom row) ─────────────────────────────────────────
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const colX = bpX + LANE_LABEL_WIDTH + i * PHASE_WIDTH;

    const label = txt(col.label, 11, 'Regular', '#555555');
    container.appendChild(label);
    label.x = colX + (PHASE_WIDTH - label.width) / 2;
    label.y = PHASE_HEADER_H + 6;

    // Sub-phase divider (lighter, within a phase group)
    if (i < columns.length - 1 && columns[i + 1].phase.id === col.phase.id) {
      vDivider(container, colX + PHASE_WIDTH, PHASE_HEADER_H, HEADER_HEIGHT - PHASE_HEADER_H, '#DDDDDD');
    }
  }

  hDivider(container, bpX, HEADER_HEIGHT, tableWidth, '#AAAAAA');

  // ── Lane rows ──────────────────────────────────────────────────────────────
  let y = HEADER_HEIGHT;

  for (let li = 0; li < blueprint.lanes.length; li++) {
    const lane = blueprint.lanes[li];
    const rowH = rowHeights[li];

    if (li > 0) hDivider(container, bpX, y, tableWidth, '#CCCCCC');

    // Lane label
    const laneLabel = txt(lane.label, 11, 'Semi Bold', '#555555');
    container.appendChild(laneLabel);
    laneLabel.x = bpX + (LANE_LABEL_WIDTH - laneLabel.width) / 2;
    laneLabel.y = y + (rowH - laneLabel.height) / 2;

    // Lane label column divider
    vDivider(container, bpX + LANE_LABEL_WIDTH, y, rowH);

    // Cards — placed directly in container (no cell wrapper)
    for (let ci = 0; ci < columns.length; ci++) {
      const { cards } = cellGrid[li][ci];
      const baseX = bpX + LANE_LABEL_WIDTH + ci * PHASE_WIDTH;

      let cardY = y + CELL_PADDING;
      for (const card of cards) {
        container.appendChild(card);
        card.x = baseX + CELL_PADDING;
        card.y = cardY;
        cardY += card.height + CARD_GAP;
      }

      // Column divider — heavier at phase boundaries, lighter within a phase
      if (ci < columns.length - 1) {
        const isPhaseBreak = columns[ci + 1].phase.id !== columns[ci].phase.id;
        vDivider(container, baseX + PHASE_WIDTH, y, rowH, isPhaseBreak ? '#AAAAAA' : '#DDDDDD');
      }
    }

    y += rowH;
  }

  // Outer edges
  hDivider(container, bpX, y, tableWidth, '#AAAAAA');
  vDivider(container, bpX, HEADER_HEIGHT, y - HEADER_HEIGHT, '#AAAAAA');
  vDivider(container, bpX + tableWidth, HEADER_HEIGHT, y - HEADER_HEIGHT, '#AAAAAA');

  container.resize(totalWidth, Math.max(y, 400));

  figma.viewport.scrollAndZoomIntoView([container]);
  figma.notify(`Generated: ${blueprint.name}`);
}
