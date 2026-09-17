export const Annotations = {
  "schema": {
    "determination.applicationId": {
      "programs": [
        "snap",
        "medicaid",
        "chip",
        "tanf"
      ]
    },
    "determination.expedited": {
      "policies": [
        "snap-expedited-processing",
        "snap-expedited-screening"
      ],
      "programs": [
        "snap"
      ]
    },
    "determination.status": {
      "programs": [
        "snap",
        "medicaid",
        "chip",
        "tanf"
      ]
    },
    "programResult.program": {
      "programs": [
        "snap",
        "medicaid",
        "chip",
        "tanf"
      ]
    },
    "programResult.eligible": {
      "policies": [
        "snap-notice-of-eligibility",
        "medicaid-notice-of-eligibility",
        "snap-fair-hearing-rights",
        "medicaid-determination-documentation"
      ],
      "programs": [
        "snap",
        "medicaid",
        "chip",
        "tanf"
      ]
    },
    "programResult.benefitAmount": {
      "policies": [
        "snap-benefit-calculation",
        "medicaid-cost-sharing"
      ],
      "programs": [
        "snap",
        "medicaid"
      ]
    }
  },
  "operations": {},
  "events": {
    "eligibility.determination.complete": {
      "policies": [
        "snap-notice-of-eligibility",
        "medicaid-notice-of-eligibility"
      ],
      "programs": [
        "snap",
        "medicaid",
        "chip",
        "tanf"
      ]
    }
  },
  "facts": {
    "expeditedSnap.isExpeditedEligible": {
      "policies": [
        "snap-expedited-processing"
      ],
      "programs": [
        "snap"
      ]
    },
    "expeditedSnap.isLowIncome": {
      "policies": [
        "snap-expedited-screening"
      ],
      "programs": [
        "snap"
      ]
    },
    "interviewProbes.workRequirementProbe": {
      "policies": [
        "snap-abawd-work-requirement",
        "snap-general-work-requirement"
      ],
      "programs": [
        "snap"
      ]
    },
    "interviewProbes.immigrationStatusProbe": {
      "policies": [
        "qualified-alien-eligibility",
        "prwora-sponsor-deeming"
      ],
      "programs": [
        "snap",
        "medicaid"
      ]
    }
  }
} as const;
