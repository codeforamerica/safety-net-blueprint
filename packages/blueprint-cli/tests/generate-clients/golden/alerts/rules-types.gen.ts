import type { FactNode } from '@codeforamerica/blueprint-rules-engine';

export type UrgencyInputs = {
  notice?: {
    status?: string;
    daysSinceCreated?: number;
  };
  policy?: {
    urgencyThresholdDays?: number;
  };
};

export type UrgencyResult = {
  isUrgent: FactNode<boolean>;
  urgencyLevel: FactNode<string>;
  nodes: Record<string, FactNode<unknown>>;
};
