import type { FactNode } from '@codeforamerica/blueprint-rules-engine';

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
  workEligibleMembers: FactNode<unknown>;
  workRequirementProbe: FactNode<boolean>;
  studentEligibilityProbe: FactNode<boolean>;
  immigrationStatusProbe: FactNode<boolean>;
  changeVerificationProbe: FactNode<boolean>;
  allMembersEmployed: FactNode<boolean>;
  nodes: Record<string, FactNode<unknown>>;
};
