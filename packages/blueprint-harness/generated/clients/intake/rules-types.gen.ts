import type { FactNode } from '@codeforamerica/blueprint-rules-engine';

export type InterviewFlagsInputs = {
  current?: {
    size?: number;
    utilitiesIncludedInRent?: boolean;
    monthlyIncome?: number;
    monthlyExpenses?: number;
    members?: Array<{
      id?: string;
      dateOfBirth?: string;
      isDisabled?: boolean;
    }>;
    jobs?: Array<{
      id?: string;
      memberId?: string;
      employer?: string;
    }>;
    incomes?: Array<{
      id?: string;
      memberId?: string;
      jobId?: string;
      source?: string;
      amount?: number;
      frequency?: string;
      paidInCash?: boolean;
      amountVaries?: boolean;
    }>;
    expenses?: Array<{
      type?: string;
      amount?: number;
      frequency?: string;
    }>;
  };
  previous?: {
    size?: number;
    utilitiesIncludedInRent?: boolean;
    monthlyIncome?: number;
    monthlyExpenses?: number;
    members?: Array<{
      id?: string;
      dateOfBirth?: string;
      isDisabled?: boolean;
    }>;
    jobs?: Array<{
      id?: string;
      memberId?: string;
      employer?: string;
    }>;
    incomes?: Array<{
      id?: string;
      memberId?: string;
      jobId?: string;
      source?: string;
      amount?: number;
      frequency?: string;
      paidInCash?: boolean;
      amountVaries?: boolean;
    }>;
    expenses?: Array<{
      type?: string;
      amount?: number;
      frequency?: string;
    }>;
  };
  verified?: Array<{
    kind?: string;
    memberId?: string;
    incomeId?: string;
    period?: string;
    amount?: number;
    frequency?: string;
  }>;
  asOf?: string;
  programsAppliedFor?: Array<unknown>;
};

export type InterviewFlagsResult = {
  'risks.earnedIncomeVaries': FactNode<boolean>;
  'risks.cashOrSelfEmploymentIncome': FactNode<boolean>;
  'risks.incomeChangedSincePrevious': FactNode<boolean>;
  'risks.householdChangedSincePrevious': FactNode<boolean>;
  'risks.shelterCostsCarriedOver': FactNode<boolean>;
  'risks.elderlyOrDisabledWithoutMedicalCosts': FactNode<boolean>;
  'risks.childrenAndEarnersWithoutDependentCare': FactNode<boolean>;
  'risks.multipleProgramsApplied': FactNode<boolean>;
  'inconsistencies.incomeBelowExpenses': FactNode<boolean>;
  'inconsistencies.wagesDifferFromWageRecords': FactNode<boolean>;
  'inconsistencies.incomeDiffersFromPayStub': FactNode<boolean>;
  'inconsistencies.householdSizeDiffersFromMembers': FactNode<boolean>;
  'inconsistencies.jobWithoutEarnedIncome': FactNode<boolean>;
  'inconsistencies.earnedIncomeWithoutJob': FactNode<boolean>;
  'inconsistencies.utilitiesIncludedButBilled': FactNode<boolean>;
  nodes: Record<string, FactNode<unknown>>;
};
