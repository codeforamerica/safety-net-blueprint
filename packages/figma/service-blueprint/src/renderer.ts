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
  'staff-action':  { headerBg: '#2B1A78', bodyBg: '#EEEBFF', headerFg: '#FFFFFF', bodyFg: '#1A1040', label: 'STAFF ACTION'  },
  'system':        { headerBg: '#137C69', bodyBg: '#F1FFFD', headerFg: '#FFFFFF', bodyFg: '#0A3A2E', label: 'SYSTEM'        },
  'policy':        { headerBg: '#EDD7CD', bodyBg: '#F8F6F5', headerFg: '#3D2B0E', bodyFg: '#3D2B0E', label: 'POLICY'        },
  'pain-point':    { headerBg: '#EB646B', bodyBg: '#F9E9EA', headerFg: '#1A0000', bodyFg: '#2A0A0A', label: 'PAIN POINT'   },
  'opportunity':   { headerBg: '#FDAF49', bodyBg: '#FEF1DD', headerFg: '#3D2800', bodyFg: '#3D2800', label: 'OPPORTUNITY'   },
  'domain-event':  { headerBg: '#2E6276', bodyBg: '#E7F2F5', headerFg: '#FFFFFF', bodyFg: '#0A2E34', label: 'EVENT'         },
  'data-entity':   { headerBg: '#154C21', bodyBg: '#E3F5E1', headerFg: '#FFFFFF', bodyFg: '#0A2E1E', label: 'DATA'          },
  'note':          { headerBg: '#FDDA40', bodyBg: '#FFFBE7', headerFg: '#333333', bodyFg: '#555555', label: ''              },
  'person-action': { headerBg: '#2B1A78', bodyBg: '#EEEBFF', headerFg: '#FFFFFF', bodyFg: '#1A1040', label: 'PERSON'        },
};

// Per-actor colors for person-action cards. Overrides PALETTE['person-action'] when actor is set.
const ACTOR_PALETTE: Record<ActorType, CardPalette> = {
  'applicant':  { headerBg: '#D97C20', bodyBg: '#FDECD4', headerFg: '#3D1800', bodyFg: '#3D1800', label: 'APPLICANT'  },
  'caseworker': { headerBg: '#2B1A78', bodyBg: '#EEEBFF', headerFg: '#FFFFFF', bodyFg: '#1A1040', label: 'CASEWORKER' },
  'supervisor': { headerBg: '#4F41B2', bodyBg: '#EEEBFF', headerFg: '#FFFFFF', bodyFg: '#1A1040', label: 'SUPERVISOR' },
  'system':     { headerBg: '#137C69', bodyBg: '#F1FFFD', headerFg: '#FFFFFF', bodyFg: '#0A3A2E', label: 'SYSTEM'     },
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

// ── Card icons ────────────────────────────────────────────────────────────────
// Paths extracted from the Figma Service Blueprint component library SVG export.
// Coordinates are in Figma canvas space; Figma normalises the bounding box when
// rendering, so the raw d strings can be passed directly to vectorPaths.

const ICON_SIZE = 14;  // px — rendered icon size
const ICON_GAP  = 4;   // px — gap between icon and label text

interface IconDef { minX: number; minY: number; w: number; h: number; d: string }

const ICON_DEFS: Record<string, IconDef> = {
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
  // Stacked-ellipses / cylinder — data storage, from Figma library
  'database': {
    minX: 180.071, minY: 1303.89, w: 12, h: 12,
    d: 'M186.071 1315.89C184.393 1315.89 182.974 1315.63 181.812 1315.12C180.651 1314.6 180.071 1313.97 180.071 1313.23V1306.56C180.071 1305.83 180.657 1305.2 181.829 1304.68C183.001 1304.15 184.415 1303.89 186.071 1303.89C187.726 1303.89 189.14 1304.15 190.312 1304.68C191.485 1305.2 192.071 1305.83 192.071 1306.56V1313.23C192.071 1313.97 191.49 1314.6 190.329 1315.12C189.168 1315.63 187.749 1315.89 186.071 1315.89ZM186.071 1307.91C187.06 1307.91 188.054 1307.77 189.054 1307.48C190.054 1307.2 190.615 1306.9 190.737 1306.58C190.615 1306.25 190.057 1305.95 189.062 1305.66C188.068 1305.37 187.071 1305.23 186.071 1305.23C185.06 1305.23 184.068 1305.37 183.096 1305.65C182.124 1305.93 181.56 1306.24 181.404 1306.58C181.56 1306.91 182.124 1307.21 183.096 1307.49C184.068 1307.77 185.06 1307.91 186.071 1307.91ZM186.071 1311.23C186.537 1311.23 186.987 1311.2 187.421 1311.16C187.854 1311.11 188.268 1311.05 188.662 1310.97C189.057 1310.88 189.429 1310.78 189.779 1310.66C190.129 1310.54 190.449 1310.4 190.737 1310.24V1308.24C190.449 1308.4 190.129 1308.54 189.779 1308.66C189.429 1308.78 189.057 1308.88 188.662 1308.97C188.268 1309.05 187.854 1309.11 187.421 1309.16C186.987 1309.2 186.537 1309.23 186.071 1309.23C185.604 1309.23 185.149 1309.2 184.704 1309.16C184.26 1309.11 183.84 1309.05 183.446 1308.97C183.051 1308.88 182.682 1308.78 182.337 1308.66C181.993 1308.54 181.682 1308.4 181.404 1308.24V1310.24C181.682 1310.4 181.993 1310.54 182.337 1310.66C182.682 1310.78 183.051 1310.88 183.446 1310.97C183.84 1311.05 184.26 1311.11 184.704 1311.16C185.149 1311.2 185.604 1311.23 186.071 1311.23ZM186.071 1314.56C186.582 1314.56 187.101 1314.52 187.629 1314.44C188.157 1314.36 188.643 1314.26 189.087 1314.13C189.532 1314.01 189.904 1313.86 190.204 1313.7C190.504 1313.54 190.682 1313.38 190.737 1313.21V1311.58C190.449 1311.73 190.129 1311.87 189.779 1311.99C189.429 1312.11 189.057 1312.22 188.662 1312.3C188.268 1312.38 187.854 1312.45 187.421 1312.49C186.987 1312.54 186.537 1312.56 186.071 1312.56C185.604 1312.56 185.149 1312.54 184.704 1312.49C184.26 1312.45 183.84 1312.38 183.446 1312.3C183.051 1312.22 182.682 1312.11 182.337 1311.99C181.993 1311.87 181.682 1311.73 181.404 1311.58V1313.23C181.46 1313.39 181.635 1313.55 181.929 1313.71C182.224 1313.86 182.593 1314.01 183.037 1314.13C183.482 1314.26 183.971 1314.36 184.504 1314.44C185.037 1314.52 185.56 1314.56 186.071 1314.56Z',
  },
  // Checkmark-with-hand — domain event / delivery, from Figma library
  'delivery': {
    minX: 178.071, minY: 1948.3, w: 16, h: 15.18,
    d: 'M187.157 1954.76L183.918 1951.52L185.004 1950.45L187.157 1952.61L191.48 1948.3L192.547 1949.37L187.157 1954.76ZM182.642 1960.44L187.937 1961.88L192.471 1960.47C192.407 1960.36 192.315 1960.26 192.195 1960.18C192.074 1960.1 191.937 1960.05 191.785 1960.05H187.937C187.595 1960.05 187.322 1960.04 187.118 1960.02C186.915 1959.99 186.706 1959.94 186.49 1959.86L184.718 1959.27L185.137 1957.79L186.68 1958.3C186.896 1958.37 187.15 1958.42 187.442 1958.45C187.734 1958.49 188.166 1958.52 188.737 1958.53C188.737 1958.39 188.696 1958.26 188.614 1958.13C188.531 1958 188.433 1957.92 188.318 1957.88L183.861 1956.24H182.642V1960.44ZM178.071 1963.1V1954.72H183.861C183.95 1954.72 184.039 1954.73 184.128 1954.75C184.217 1954.77 184.299 1954.79 184.376 1954.82L188.852 1956.47C189.271 1956.63 189.61 1956.89 189.871 1957.27C190.131 1957.65 190.261 1958.07 190.261 1958.53H191.785C192.42 1958.53 192.96 1958.74 193.404 1959.16C193.849 1959.58 194.071 1960.13 194.071 1960.82V1961.58L187.976 1963.48L182.642 1962V1963.1H178.071ZM179.595 1961.58H181.118V1956.24H179.595V1961.58Z',
  },
  'diamond-alert': {
    minX: 179.387, minY: 2272.21, w: 13.367, h: 13.37,
    d: 'M186.071 2285.58C185.893 2285.58 185.724 2285.54 185.562 2285.48C185.401 2285.41 185.254 2285.31 185.121 2285.19L179.771 2279.84C179.649 2279.71 179.554 2279.56 179.487 2279.4C179.421 2279.24 179.387 2279.07 179.387 2278.89C179.387 2278.71 179.421 2278.54 179.487 2278.38C179.554 2278.21 179.649 2278.06 179.771 2277.94L185.121 2272.59C185.254 2272.46 185.401 2272.36 185.562 2272.3C185.724 2272.24 185.893 2272.21 186.071 2272.21C186.249 2272.21 186.421 2272.24 186.587 2272.3C186.754 2272.36 186.899 2272.46 187.021 2272.59L192.371 2277.94C192.504 2278.06 192.601 2278.21 192.662 2278.38C192.724 2278.54 192.754 2278.71 192.754 2278.89C192.754 2279.07 192.724 2279.24 192.662 2279.4C192.601 2279.56 192.504 2279.71 192.371 2279.84L187.021 2285.19C186.899 2285.31 186.754 2285.41 186.587 2285.48C186.421 2285.54 186.249 2285.58 186.071 2285.58ZM186.071 2284.24L191.421 2278.89L186.071 2273.54L180.721 2278.89L186.071 2284.24ZM185.404 2279.56H186.737V2275.56H185.404V2279.56ZM186.071 2281.56C186.26 2281.56 186.418 2281.5 186.546 2281.37C186.674 2281.24 186.737 2281.08 186.737 2280.89C186.737 2280.7 186.674 2280.55 186.546 2280.42C186.418 2280.29 186.26 2280.23 186.071 2280.23C185.882 2280.23 185.724 2280.29 185.596 2280.42C185.468 2280.55 185.404 2280.7 185.404 2280.89C185.404 2281.08 185.468 2281.24 185.596 2281.37C185.724 2281.5 185.882 2281.56 186.071 2281.56Z',
  },
  'lightbulb': {
    minX: 181.404, minY: 2595.23, w: 9.333, h: 13.33,
    d: 'M184.071 2607.89C184.071 2608.26 184.371 2608.56 184.737 2608.56H187.404C187.771 2608.56 188.071 2608.26 188.071 2607.89V2607.23H184.071V2607.89ZM186.071 2595.23C183.494 2595.23 181.404 2597.32 181.404 2599.89C181.404 2601.48 182.197 2602.88 183.404 2603.72V2605.23C183.404 2605.59 183.704 2605.89 184.071 2605.89H188.071C188.437 2605.89 188.737 2605.59 188.737 2605.23V2603.72C189.944 2602.88 190.737 2601.48 190.737 2599.89C190.737 2597.32 188.647 2595.23 186.071 2595.23ZM187.974 2602.63L187.404 2603.02V2604.56H184.737V2603.03L184.167 2602.63C183.271 2602 182.737 2600.98 182.737 2599.9C182.737 2598.06 184.234 2596.56 186.071 2596.56C187.907 2596.56 189.404 2598.06 189.404 2599.9C189.404 2600.98 188.871 2602 187.974 2602.63Z',
  },
  'building': {
    minX: 179.737, minY: 3241.23, w: 12.667, h: 13.33,
    d: 'M182.737 3247.23H181.404V3251.89H182.737V3247.23ZM186.737 3247.23H185.404V3251.89H186.737V3247.23ZM192.404 3253.23H179.737V3254.56H192.404V3253.23ZM190.737 3247.23H189.404V3251.89H190.737V3247.23ZM186.071 3242.73L189.544 3244.56H182.597L186.071 3242.73ZM186.071 3241.23L179.737 3244.56V3245.89H192.404V3244.56L186.071 3241.23Z',
  },
};

function iconKey(type: CardType, actor?: ActorType): string | null {
  if (type === 'person-action') return actor === 'supervisor' ? 'person-group' : 'person-single';
  if (type === 'staff-action')  return 'person-single';
  const map: Partial<Record<CardType, string>> = {
    system:          'gear',
    'data-entity':   'database',
    'domain-event':  'delivery',
    'pain-point':    'diamond-alert',
    opportunity:     'lightbulb',
    policy:          'building',
  };
  return map[type] ?? null;
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

  // Icon + label row (horizontal sub-frame)
  const key = p.label ? iconKey(card.type, card.actor) : null;
  const def = key ? ICON_DEFS[key] : null;

  if (def && p.label) {
    const labelRow = figma.createFrame();
    labelRow.name = 'label-row';
    labelRow.fills = [];
    labelRow.layoutMode = 'HORIZONTAL';
    labelRow.itemSpacing = ICON_GAP;
    labelRow.primaryAxisSizingMode = 'AUTO';
    labelRow.counterAxisSizingMode = 'AUTO';
    labelRow.counterAxisAlignItems = 'CENTER';

    const iconScale = ICON_SIZE / Math.max(def.w, def.h);
    const v = figma.createVector();
    v.vectorPaths = [{ windingRule: 'NONZERO', data: def.d }];
    v.fills = fill(p.headerFg);
    v.strokes = [];
    v.resize(def.w * iconScale, def.h * iconScale);
    v.layoutSizingHorizontal = 'FIXED';
    v.layoutSizingVertical = 'FIXED';
    labelRow.appendChild(v);

    const labelNode = txt(p.label, 11, 'Regular', p.headerFg);
    labelRow.appendChild(labelNode);

    header.appendChild(labelRow);
  } else if (p.label) {
    const labelNode = txt(p.label, 11, 'Regular', p.headerFg, textWidth);
    header.appendChild(labelNode);
    labelNode.layoutSizingHorizontal = 'FILL';
  }

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
