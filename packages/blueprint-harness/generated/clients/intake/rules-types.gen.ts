import type { FactNode } from '@codeforamerica/blueprint-rules-engine';

export type InterviewFlagsInputs = {
  application?: {
    programsAppliedFor?: Array<unknown>;
    householdSize?: number;
    members?: Array<unknown>;
    jobs?: Array<unknown>;
    incomes?: Array<unknown>;
    expenses?: Array<unknown>;
    reportedMonthlyIncome?: number;
    reportedMonthlyExpenses?: number;
    utilitiesIncludedInRent?: boolean;
    claimsUtilityAllowance?: boolean;
    hasChangedCircumstances?: boolean;
  };
  lastCertification?: {
    memberIds?: Array<unknown>;
    incomes?: Array<unknown>;
    expenses?: Array<unknown>;
  };
  dataMatches?: {
    wageRecords?: Array<{
      memberId?: string;
      monthlyWages?: number;
    }>;
    payStubs?: Array<{
      incomeId?: string;
      monthlyAmount?: number;
    }>;
  };
};

export type InterviewFlagsResult = {
  risks.earnedIncomeVaries: FactNode<boolean>;
  risks.cashOrSelfEmploymentIncome: FactNode<boolean>;
  risks.incomeChangedSinceLastCertification: FactNode<boolean>;
  risks.householdChangedSinceLastCertification: FactNode<boolean>;
  risks.shelterCostsCarriedOver: FactNode<boolean>;
  risks.elderlyOrDisabledWithoutMedicalCosts: FactNode<boolean>;
  risks.childrenAndEarnersWithoutDependentCare: FactNode<boolean>;
  risks.circumstancesChangedSinceApplying: FactNode<boolean>;
  risks.multipleProgramsApplied: FactNode<boolean>;
  inconsistencies.incomeBelowExpenses: FactNode<boolean>;
  inconsistencies.wagesDifferFromWageRecords: FactNode<boolean>;
  inconsistencies.incomeDiffersFromPayStub: FactNode<boolean>;
  inconsistencies.householdSizeDiffersFromMembers: FactNode<boolean>;
  inconsistencies.jobWithoutEarnedIncome: FactNode<boolean>;
  inconsistencies.earnedIncomeWithoutJob: FactNode<boolean>;
  inconsistencies.utilitiesIncludedButClaimed: FactNode<boolean>;
  nodes: Record<string, FactNode<unknown>>;
};
