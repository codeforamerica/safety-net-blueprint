import { evaluate } from '@codeforamerica/blueprint-rules-engine';
import type { FactNode } from '@codeforamerica/blueprint-rules-engine';
import type { UrgencyInputs, UrgencyResult } from './rules-types.gen.js';

export const Rules = {
  urgency: { evaluate: (inputs: UrgencyInputs): UrgencyResult => {
    const nodes = evaluate({"$schema":"https://blueprint.codeforamerica.org/schemas/graph-schema.yaml","domain":"alerts","ruleset":"urgency","outputs":["isUrgent","urgencyLevel"],"inputs":{"$.notice.status":{"type":"string"},"$.notice.daysSinceCreated":{"type":"integer"},"$.policy.urgencyThresholdDays":{"type":"integer","default":3}},"facts":{"isUrgent":{"expression":"notice.status == 'sent' && notice.daysSinceCreated >= policy.urgencyThresholdDays","type":"boolean","description":"Whether the notice requires urgent attention"},"urgencyLevel":{"expression":"isUrgent ? 'high' : 'normal'","type":"string","description":"Urgency classification of the notice"}},"dependencies":{"isUrgent":["$.notice.status","$.notice.daysSinceCreated","$.policy.urgencyThresholdDays"],"urgencyLevel":["isUrgent"]}}, inputs);
    return {
      isUrgent: nodes['isUrgent'] as FactNode<boolean>,
      urgencyLevel: nodes['urgencyLevel'] as FactNode<string>,
      nodes,
    };
  } }
};
