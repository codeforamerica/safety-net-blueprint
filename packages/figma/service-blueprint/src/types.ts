export type CardType =
  | 'staff-action'   // purple — caseworker or staff action (legacy; prefer person-action)
  | 'system'         // green  — automated system action or output
  | 'policy'         // beige  — regulatory or policy requirement
  | 'pain-point'     // salmon — friction or barrier
  | 'opportunity'    // amber  — UX opportunity or improvement idea
  | 'domain-event'   // teal   — event emitted by the system
  | 'data-entity'    // blue   — data entity created or updated (related to domain-event)
  | 'note'           // cream  — general annotation (sticky-note style)
  | 'person-action'; // actor-tinted — action taken by a named actor (applicant, caseworker, supervisor)

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
