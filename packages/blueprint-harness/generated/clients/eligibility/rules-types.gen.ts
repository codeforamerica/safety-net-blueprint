import type { FactNode } from '@codeforamerica/blueprint-rules-engine';

export type ExpeditedSnapInputs = {
  household?: {
    monthlyGrossIncome?: number;
    liquidResources?: number;
    monthlyShelterCost?: number;
    isMigrantFarmworker?: boolean;
  };
  parameters?: {
    incomeThreshold?: number;
    resourceThreshold?: number;
  };
};

export type ExpeditedSnapResult = {
  isExpeditedEligible: FactNode<boolean>;
  nodes: Record<string, FactNode<unknown>>;
};
