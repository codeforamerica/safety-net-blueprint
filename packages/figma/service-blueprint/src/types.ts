export type CardType =
  | 'ux-opportunity'       // green  — user experience improvement opportunity
  | 'pain-point'           // orange — friction or barrier in the current experience
  | 'program-requirement'  // blue   — regulatory or policy requirement
  | 'data-entity'          // teal   — data entity created or updated
  | 'domain-event'         // purple — event emitted by the system
  | 'note';                // grey   — general annotation or process step

export interface Card {
  type: CardType;
  text: string;
  subtext?: string; // secondary line: citation, field list, detail
}

export interface Lane {
  id: string;
  label: string;
  headerBg: string; // hex — background color for the lane label cell
  headerFg: string; // hex — text color for the lane label
  rowBg?: string;   // hex — optional tint for the lane row background
}

export interface Phase {
  id: string;
  label: string;
  sublabel?: string;
}

// A cell is the intersection of one lane and one phase.
export interface Cell {
  laneId: string;
  phaseId: string;
  cards: Card[];
}

export interface Blueprint {
  id: string;
  name: string;
  lanes: Lane[];
  phases: Phase[];
  cells: Cell[];
}
