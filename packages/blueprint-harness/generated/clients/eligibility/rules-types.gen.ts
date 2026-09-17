import type { FactNode } from '@codeforamerica/blueprint-rules-engine';

export type ExpeditedSnapInputs = {
  household?: {
    monthlyGrossIncome?: number;
    liquidResources?: number;
    monthlyShelterCost?: number;
    isMigrantFarmworker?: boolean;
  };
  policy?: {
    incomeThreshold?: number;
    resourceThreshold?: number;
  };
};

export type ExpeditedSnapResult = {
  isExpeditedEligible: FactNode<boolean>;
  isLowIncome: FactNode<boolean>;
  hasLowResources: FactNode<boolean>;
  nodes: Record<string, FactNode<unknown>>;
};


export type InterviewProbesInputs = {
  household?: {
    monthlyIncome?: number;
    monthlyExpenses?: number;
    members?: unknown[];
  };
  application?: {
    hasChangedCircumstances?: boolean;
  };
};

export type InterviewProbesResult = {
  incomeInconsistencyProbe: FactNode<boolean>;
  workRequirementProbe: FactNode<boolean>;
  studentEligibilityProbe: FactNode<boolean>;
  immigrationStatusProbe: FactNode<boolean>;
  changeVerificationProbe: FactNode<boolean>;
  allMembersEmployed: FactNode<boolean>;
  nodes: Record<string, FactNode<unknown>>;
};
