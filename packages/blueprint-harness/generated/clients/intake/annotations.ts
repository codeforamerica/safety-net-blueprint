export const Annotations = {
  "schema": {
    "application": {
      "patterns": [
        "polymorphic-base",
        "paginated-list"
      ]
    },
    "application.id": {
      "patterns": [
        "read-only-field",
        "string-format"
      ]
    },
    "application.confirmationNumber": {
      "patterns": [
        "deprecated-field",
        "read-only-field"
      ]
    },
    "application.status": {
      "patterns": [
        "x-enum-source",
        "read-only-field"
      ]
    },
    "application.programsAppliedFor[]": {
      "patterns": [
        "array-of-enum"
      ]
    },
    "application.submittedAt": {
      "policies": [
        "snap-processing-clock",
        "medicaid-processing-clock"
      ],
      "patterns": [
        "nullable-state-gated-field",
        "read-only-field",
        "string-format"
      ]
    },
    "application.openedAt": {
      "patterns": [
        "nullable-state-gated-field",
        "read-only-field",
        "string-format"
      ]
    },
    "application.createdAt": {
      "patterns": [
        "read-only-field",
        "string-format"
      ]
    },
    "application.updatedAt": {
      "patterns": [
        "read-only-field",
        "string-format"
      ]
    },
    "application.address": {
      "patterns": [
        "external-ref-shared-defs"
      ]
    },
    "application.contactInfo": {
      "patterns": [
        "external-ref-shared-defs"
      ]
    },
    "application.labels": {
      "patterns": [
        "additional-properties-map"
      ]
    },
    "applicationSummary": {
      "patterns": [
        "singleton-sub-resource",
        "composition"
      ]
    },
    "applicationWritable.countyCode": {
      "patterns": [
        "overlay"
      ]
    },
    "application.members[]": {
      "patterns": [
        "sub-resource",
        "polymorphic-base",
        "paginated-list"
      ]
    },
    "applicationMember.id": {
      "patterns": [
        "read-only-field",
        "string-format"
      ]
    },
    "applicationMember.dateOfBirth": {
      "policies": [
        "chip-age-eligibility",
        "snap-elderly-disabled-deductions"
      ],
      "patterns": [
        "string-format"
      ]
    },
    "applicationMember.relationship": {
      "policies": [
        "snap-household-composition",
        "medicaid-caretaker-relative"
      ]
    },
    "applicationMember.incomeSource": {
      "policies": [
        "snap-income-verification"
      ],
      "patterns": [
        "external-ref-defs-oneof"
      ]
    },
    "applicationMember.application": {
      "patterns": [
        "intra-domain-fk"
      ]
    },
    "applicationMember.notificationPreference": {
      "patterns": [
        "oneof-discriminator"
      ]
    },
    "applicationMember.verificationEvidence": {
      "patterns": [
        "anyof"
      ]
    }
  },
  "operations": {
    "application.submit": {
      "policies": [
        "snap-application-acceptance",
        "snap-processing-clock",
        "medicaid-processing-clock",
        "snap-right-to-apply"
      ],
      "patterns": [
        "rpc-state-machine-action"
      ]
    },
    "application.withdraw": {
      "policies": [
        "snap-notice-of-action"
      ]
    },
    "application.close": {
      "policies": [
        "snap-notice-of-eligibility",
        "medicaid-notice-of-eligibility",
        "snap-fair-hearing-rights"
      ]
    }
  },
  "events": {
    "intake.application.submitted": {
      "policies": [
        "snap-processing-clock",
        "medicaid-processing-clock",
        "snap-household-composition"
      ],
      "patterns": [
        "state-machine-event"
      ]
    },
    "intake.application.withdrawn": {
      "policies": [
        "snap-notice-of-action"
      ]
    },
    "intake.application.closed": {
      "policies": [
        "snap-notice-of-eligibility",
        "medicaid-notice-of-eligibility",
        "snap-fair-hearing-rights"
      ]
    },
    "intake.application.review-reminder": {
      "patterns": [
        "state-machine-timer"
      ]
    }
  },
  "facts": {
    "interviewFlags.risks.earnedIncomeVaries": {
      "reason": "Earned income is the largest source of payment errors, and wages that change month to month are the hardest to get right: a single pay stub doesn't show what a month of irregular hours or tips comes to.\n",
      "policies": [
        "snap-earned-income",
        "snap-income-verification"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "How many hours have you worked each week over the last month?",
        "Do you get tips? About how much in a typical week?"
      ],
      "sources": [
        {
          "title": "GAO-05-245: Food Stamp Program — States Have Made Progress Reducing Payment Errors",
          "url": "https://www.gao.gov/assets/a246247.html"
        },
        {
          "title": "NGA: SNAP Payment Accuracy — Strategies for Reducing Payment Error Rates",
          "url": "https://www.nga.org/updates/snap-payment-accuracy-strategies-for-reducing-payment-error-rate/"
        }
      ]
    },
    "interviewFlags.risks.cashOrSelfEmploymentIncome": {
      "reason": "Cash, gig and self-employment income often isn't on the application at all, and isn't asked about unless someone asks specifically.\n",
      "policies": [
        "snap-earned-income"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "Does anyone in the household do any work for cash, side jobs, or gig work?",
        "About how much did that bring in over the last 30 days?"
      ],
      "sources": [
        {
          "title": "GAO-05-245: Food Stamp Program — States Have Made Progress Reducing Payment Errors",
          "url": "https://www.gao.gov/assets/a246247.html"
        },
        {
          "title": "FRAC: A Backgrounder on SNAP Quality Control, Payment Error Rates, and Cost-Sharing",
          "url": "https://frac.org/blog/a-backgrounder-on-snap-quality-control-payment-error-rates-and-cost-sharing"
        }
      ]
    },
    "interviewFlags.risks.incomeChangedSincePrevious": {
      "reason": "Income that's changed since the household on record — a job gained or lost, a raise, hours cut — is a leading cause of both overpayments and underpayments when it isn't reported. On a new application, that's since the application was filed.\n",
      "policies": [
        "snap-reporting-changes",
        "snap-recertification"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "Has anyone started or stopped a job since your last renewal?",
        "Has anyone's pay or hours changed?"
      ],
      "sources": [
        {
          "title": "FRAC: A Backgrounder on SNAP Quality Control, Payment Error Rates, and Cost-Sharing",
          "url": "https://frac.org/blog/a-backgrounder-on-snap-quality-control-payment-error-rates-and-cost-sharing"
        },
        {
          "title": "FNS SNAP Recertification Toolkit (June 2018)",
          "url": "https://www.fna.usda.gov/snap/recertification-toolkit"
        }
      ]
    },
    "interviewFlags.risks.householdChangedSincePrevious": {
      "reason": "Who lives in the household and buys food together decides whose income counts. Changes are often unreported, and often not asked about at recertification.\n",
      "policies": [
        "snap-household-composition",
        "snap-reporting-changes"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "Has anyone moved in or out since your last renewal?",
        "Does everyone who lives with you buy and prepare food together?"
      ],
      "sources": [
        {
          "title": "GAO-05-245: Food Stamp Program — States Have Made Progress Reducing Payment Errors",
          "url": "https://www.gao.gov/assets/a246247.html"
        },
        {
          "title": "FNS SNAP Recertification Toolkit (June 2018)",
          "url": "https://www.fna.usda.gov/snap/recertification-toolkit"
        }
      ]
    },
    "interviewFlags.risks.shelterCostsCarriedOver": {
      "reason": "Shelter costs carried forward from the last certification without being asked about can be out of date in either direction: a move or a rent increase that's missed.\n",
      "policies": [
        "snap-shelter-utility-deductions",
        "snap-recertification"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "Is your rent or mortgage still the same amount?",
        "Have you moved since your last renewal?"
      ],
      "sources": [
        {
          "title": "FNS SNAP Recertification Toolkit (June 2018)",
          "url": "https://www.fna.usda.gov/snap/recertification-toolkit"
        },
        {
          "title": "NGA: SNAP Payment Accuracy — Strategies for Reducing Payment Error Rates",
          "url": "https://www.nga.org/updates/snap-payment-accuracy-strategies-for-reducing-payment-error-rate/"
        }
      ]
    },
    "interviewFlags.risks.elderlyOrDisabledWithoutMedicalCosts": {
      "reason": "A member 60 or older, or disabled, may deduct medical costs. Missed deductions are among the most common fixable errors, and lead to underpayments.\n",
      "policies": [
        "snap-elderly-disabled-deductions"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "Does [member] pay for any doctor visits, prescriptions, or medical supplies?",
        "About how much a month?"
      ],
      "sources": [
        {
          "title": "NGA: SNAP Payment Accuracy — Strategies for Reducing Payment Error Rates",
          "url": "https://www.nga.org/updates/snap-payment-accuracy-strategies-for-reducing-payment-error-rate/"
        },
        {
          "title": "FRAC: A Backgrounder on SNAP Quality Control, Payment Error Rates, and Cost-Sharing",
          "url": "https://frac.org/blog/a-backgrounder-on-snap-quality-control-payment-error-rates-and-cost-sharing"
        }
      ]
    },
    "interviewFlags.risks.childrenAndEarnersWithoutDependentCare": {
      "reason": "Care for a child so a household member can work is deductible. When it's new it often isn't asked about, which leads to an underpayment.\n",
      "policies": [
        "snap-dependent-care-deduction"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "Does anyone look after the children while you work or go to school?",
        "Do you pay for that care?"
      ],
      "sources": [
        {
          "title": "NGA: SNAP Payment Accuracy — Strategies for Reducing Payment Error Rates",
          "url": "https://www.nga.org/updates/snap-payment-accuracy-strategies-for-reducing-payment-error-rate/"
        }
      ]
    },
    "interviewFlags.risks.multipleProgramsApplied": {
      "reason": "Households on several programs face reporting rules that differ between them, which makes it harder to keep each program's information right.\n",
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "Have you reported this change to [other program] as well?"
      ],
      "sources": [
        {
          "title": "GAO-05-245: Food Stamp Program — States Have Made Progress Reducing Payment Errors",
          "url": "https://www.gao.gov/assets/a246247.html"
        }
      ]
    },
    "interviewFlags.inconsistencies.incomeBelowExpenses": {
      "reason": "When reported income doesn't cover reported expenses, something the application doesn't show is paying the difference: unreported income, or help from outside the household. FNS-1104 makes it a probe.\n",
      "policies": [
        "snap-interview-toolkit"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "Your expenses are more than your income. How does the household make up the difference?",
        "Does anyone help with bills — family, friends, or community organizations?"
      ],
      "sources": [
        {
          "title": "FNS State SNAP Interview Toolkit (FNS-1104, revised June 2025)",
          "url": "https://www.fna.usda.gov/snap/state/interview-toolkit"
        }
      ]
    },
    "interviewFlags.inconsistencies.wagesDifferFromWageRecords": {
      "reason": "Income an agency's data systems show but nobody confirms is an error the agency could have caught. A difference from the wage records needs explaining before it's resolved either way.\n",
      "policies": [
        "snap-income-verification"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "The state's records show [amount] in wages for [member]. Does that sound right?",
        "Did [member] have another job, or more hours, during that time?"
      ],
      "sources": [
        {
          "title": "GAO-05-245: Food Stamp Program — States Have Made Progress Reducing Payment Errors",
          "url": "https://www.gao.gov/assets/a246247.html"
        },
        {
          "title": "NGA: SNAP Payment Accuracy — Strategies for Reducing Payment Error Rates",
          "url": "https://www.nga.org/updates/snap-payment-accuracy-strategies-for-reducing-payment-error-rate/"
        }
      ]
    },
    "interviewFlags.inconsistencies.incomeDiffersFromPayStub": {
      "reason": "A recorded amount that doesn't match its pay stubs usually means a pay frequency was converted wrongly — weekly, every two weeks, and twice a month are easy to confuse.\n",
      "policies": [
        "snap-income-verification",
        "snap-earned-income"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "How often is [member] paid — every week, every two weeks, or twice a month?"
      ],
      "sources": [
        {
          "title": "NGA: SNAP Payment Accuracy — Strategies for Reducing Payment Error Rates",
          "url": "https://www.nga.org/updates/snap-payment-accuracy-strategies-for-reducing-payment-error-rate/"
        }
      ]
    },
    "interviewFlags.inconsistencies.householdSizeDiffersFromMembers": {
      "reason": "The household's size decides its benefit. A size that doesn't match the members listed means someone is missing or counted who shouldn't be.\n",
      "policies": [
        "snap-household-composition"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "Who lives with you and buys and prepares food with you?"
      ],
      "sources": [
        {
          "title": "GAO-05-245: Food Stamp Program — States Have Made Progress Reducing Payment Errors",
          "url": "https://www.gao.gov/assets/a246247.html"
        }
      ]
    },
    "interviewFlags.inconsistencies.jobWithoutEarnedIncome": {
      "reason": "A job with no income recorded is information that arrived but wasn't applied — the most common kind of agency error.\n",
      "policies": [
        "snap-earned-income"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "Is [member] still working at [job]? How much are they paid?"
      ],
      "sources": [
        {
          "title": "APHSA: Payment Error Rates — Understanding What They Are and How to Support SNAP Agencies in Reducing Them",
          "url": "https://aphsa.org/resources/payment-error-rates-understanding-what-they-are-and-how-to-support-snap-agencies-in-reducing-them/"
        }
      ]
    },
    "interviewFlags.inconsistencies.earnedIncomeWithoutJob": {
      "reason": "Earned income with no job behind it can't be verified or updated when the job changes, and is often a job that ended but wasn't closed out.\n",
      "policies": [
        "snap-earned-income"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "Where does [member] work? Are they still working there?"
      ],
      "sources": [
        {
          "title": "APHSA: Payment Error Rates — Understanding What They Are and How to Support SNAP Agencies in Reducing Them",
          "url": "https://aphsa.org/resources/payment-error-rates-understanding-what-they-are-and-how-to-support-snap-agencies-in-reducing-them/"
        }
      ]
    },
    "interviewFlags.inconsistencies.utilitiesIncludedButBilled": {
      "reason": "A household that pays a utility bill isn't one whose utilities are all included in the rent, and which it is decides whether a utility allowance applies. What counts as a utility deduction is a common misapplication of policy.\n",
      "policies": [
        "snap-shelter-utility-deductions"
      ],
      "patterns": [
        "ruleset-output-fact"
      ],
      "probeQuestions": [
        "Do you pay any utility bills yourself, like electric or gas, or are they all included in the rent?"
      ],
      "sources": [
        {
          "title": "NGA: SNAP Payment Accuracy — Strategies for Reducing Payment Error Rates",
          "url": "https://www.nga.org/updates/snap-payment-accuracy-strategies-for-reducing-payment-error-rate/"
        }
      ]
    }
  }
} as const;
