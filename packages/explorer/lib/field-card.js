/**
 * Shared CSS for field card / data dictionary layouts.
 * Used by both the explorer data dictionary builder and the Corticon visualizer.
 */
import { COLORS } from './theme.js';

export const FIELD_CSS = `
:root {
  --blue-dark:   ${COLORS.darkBlue};
  --blue-mid:    ${COLORS.midBlue};
  --blue-light:  ${COLORS.lightBlue};
  --sand:        ${COLORS.sandDark};
  --sand-light:  #F5F0ED;
  --lb-light:    ${COLORS.paleBlue};
  --green-dark:  ${COLORS.deepGreen};
  --green-light: ${COLORS.lightGreen};
  --yellow-light:${COLORS.lightYellow};
  --red-dark:    ${COLORS.richRed};
  --red-light:   ${COLORS.lightRed};
}
.csv-btn {
  font-size: 0.78rem; padding: 0.25rem 0.65rem;
  border: 1px solid rgba(255,255,255,0.3); border-radius: 4px;
  background: rgba(255,255,255,0.1); color: white; cursor: pointer; white-space: nowrap;
}
.csv-btn:hover { background: rgba(255,255,255,0.2); }
.no-results { padding: 2rem; text-align: center; color: #888; font-style: italic; }
.hidden { display: none !important; }
.dict-section { margin-bottom: 2.5rem; scroll-margin-top: 1rem; }
.section-title {
  font-size: 1rem; font-weight: 700; color: var(--blue-dark);
  border-bottom: 2px solid var(--blue-light);
  padding-bottom: 0.35rem; margin-bottom: 0.75rem;
}
.cards-grid { display: flex; flex-direction: column; gap: 0.5rem; }
.card {
  background: #fff; border: 1px solid var(--sand);
  border-left: 3px solid var(--blue-mid); border-radius: 6px; overflow: hidden;
}
.card.hidden { display: none; }
.card-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem; background: var(--lb-light); }
.field-path { font-size: 0.82rem; font-weight: 600; color: var(--blue-dark); flex: 1; min-width: 0; overflow-wrap: anywhere; }
.type-badge {
  flex-shrink: 0; font-size: 0.65rem; font-weight: 600;
  background: var(--blue-light); color: var(--blue-dark);
  border-radius: 4px; padding: 0.1rem 0.4rem; text-transform: uppercase; letter-spacing: 0.03em;
}
.rel-badge {
  flex-shrink: 0; font-size: 0.65rem; font-weight: 600;
  background: var(--green-light); color: var(--green-dark);
  border-radius: 4px; padding: 0.1rem 0.4rem; letter-spacing: 0.02em;
}
.applies-expr { font-size: 0.72rem; background: var(--yellow-light); border-radius: 3px; padding: 0.05rem 0.4rem; color: #5a4000; }
.card-body { padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.4rem; }
.ann-reason { font-size: 0.78rem; color: #333; line-height: 1.5; margin: 0; }
.ann-modeling { font-size: 0.75rem; color: #555; line-height: 1.5; margin: 0; display: flex; gap: 0.5rem; align-items: baseline; }
.ann-modeling .ann-label { flex-shrink: 0; }
.card-ann { display: flex; flex-direction: column; gap: 0.3rem; }
.ann-row { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; font-size: 0.75rem; }
.ann-row--col { align-items: flex-start; }
.ann-label {
  display: inline-block; font-size: 0.6rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.05em;
  border-radius: 3px; padding: 0.1rem 0.35rem; margin-right: 0.1rem;
  vertical-align: middle; white-space: nowrap; flex-shrink: 0;
  background: var(--sand-light); color: #6b4c3b; border: 1px solid var(--sand);
}
.badge { font-size: 0.65rem; font-weight: 600; border-radius: 3px; padding: 0.1rem 0.35rem; letter-spacing: 0.03em; background: #e8e8e8; color: #444; }
.val-list code { font-size: 0.72rem; background: #f0f0f0; border-radius: 3px; padding: 0.05rem 0.3rem; color: #444; }
.policy-list { display: flex; flex-direction: column; gap: 0.4rem; }
.policy-item { font-size: 0.75rem; }
.policy-item-head { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.15rem; }
.policy-id { font-size: 0.72rem; background: #f0f0f0; border-radius: 3px; padding: 0.05rem 0.3rem; color: #444; }
.policy-citation { font-size: 0.7rem; color: var(--blue-mid); text-decoration: none; }
.policy-citation:hover { text-decoration: underline; }
.policy-desc { font-size: 0.75rem; color: #555; line-height: 1.45; margin: 0; }
`;
