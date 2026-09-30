import type { FactNode } from '@codeforamerica/blueprint-rules-engine';

export type InterviewPromptsInputs = {
  household?: {
    monthlyIncome?: number;
    monthlyExpenses?: number;
    members?: unknown[];
  };
  application?: {
    hasChangedCircumstances?: boolean;
  };
};

export type InterviewPromptsResult = {
  incomeInconsistencyPrompt: FactNode<boolean>;
  workEligibleMembers: FactNode<unknown>;
  workRequirementPrompt: FactNode<boolean>;
  studentEligibilityPrompt: FactNode<boolean>;
  immigrationStatusPrompt: FactNode<boolean>;
  changeVerificationPrompt: FactNode<boolean>;
  allMembersEmployed: FactNode<boolean>;
  nodes: Record<string, FactNode<unknown>>;
};
