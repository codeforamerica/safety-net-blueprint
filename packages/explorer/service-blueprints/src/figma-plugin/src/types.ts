export type CardType =
  | 'staff-action'   // purple — caseworker or staff action (legacy; prefer person-action)
  | 'system'         // green  — automated system action or output
  | 'policy'         // beige  — regulatory or policy requirement
  | 'pain-point'     // salmon — friction or barrier
  | 'opportunity'    // amber  — UX opportunity or improvement idea
  | 'domain-event'   // teal   — event emitted by the system
  | 'data-entity'    // dark green — data entity created or updated (related to domain-event)
  | 'note'           // cream  — general annotation (sticky-note style)
  | 'person-action'  // actor-tinted — action taken by a named actor (applicant, caseworker, supervisor)
  | 'communications' // blue   — communication action or notification
  | 'metrics'        // light teal — metric or performance indicator
  | 'question'       // gray   — open question or knowledge gap
  | 'touchpoint';    // dark   — service touchpoint or channel interaction

// Actors who can perform a person-action. Drives card color when type === 'person-action'.
export type ActorType = 'applicant' | 'caseworker' | 'supervisor' | 'system';

export interface Card {
  type: CardType;
  text: string;
  subtext?: string; // appears in the lighter body section below the colored header
  actor?: ActorType; // required when type === 'person-action'; sets the card color
}

export interface Lane {
  id: string;
  label: string;
}

export interface SubPhase {
  id: string;
  label: string;
}

export interface Phase {
  id: string;
  label: string;
  subPhases: SubPhase[];
}

// A cell is the intersection of one lane and one sub-phase column.
export interface Cell {
  laneId: string;
  subPhaseId: string;
  cards: Card[];
}

export interface Blueprint {
  id: string;
  name: string;
  lanes: Lane[];
  phases: Phase[];
  cells: Cell[];
}

// ── Card export data ──────────────────────────────────────────────────────────
// Used by the "Cards" mode to generate standalone card frames grouped by
// domain → phase → sub-phase, independent of the full service blueprint grid.

export interface CardEntry {
  type: CardType;
  text: string;
  subtext?: string;
  citation?: string; // CFR/statutory citation for policy cards; merged into subtext display
  actor?: ActorType;
}

export interface CardSubPhase {
  id: string;
  label: string;
  cards: CardEntry[];
}

export interface CardPhase {
  id: string;
  label: string;
  subPhases: CardSubPhase[];
}

export interface CardData {
  domain: string;
  name: string;
  phases: CardPhase[];
}
