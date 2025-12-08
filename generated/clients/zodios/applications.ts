import { makeApi, Zodios, type ZodiosOptions } from "@zodios/core";
import { z } from "zod";

const createApplication_Body = z
  .object({
    id: z.string().uuid(),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    status: z
      .enum([
        "draft",
        "submitted",
        "under_review",
        "approved",
        "denied",
        "pending_information",
        "withdrawn",
      ])
      .optional(),
    programs: z
      .object({
        snap: z.boolean(),
        cashPrograms: z
          .object({ tanfProgram: z.boolean(), adultFinancial: z.boolean() })
          .partial(),
        medicalAssistance: z.boolean(),
      })
      .partial()
      .and(z.object({}).partial().passthrough()),
    applicantInfo: z
      .object({
        applicantName: z.object({
          firstName: z.string().min(1).max(100),
          middleInitial: z.string().max(1).optional(),
          middleName: z.string().max(100).optional(),
          lastName: z.string().min(1).max(100),
          maidenName: z.string().max(100).optional(),
        }),
        socialSecurityNumber: z.string().regex(/^\d{3}-\d{2}-\d{4}$/),
        dateOfBirth: z.string(),
        signature: z
          .object({
            applicantSignature: z.object({
              signature: z.string(),
              signatureDate: z.string(),
            }),
            spouseCoApplicantSignature: z.object({
              signature: z.string(),
              signatureDate: z.string(),
            }),
            applicantAuthorizedRepresentativeSignature: z.object({
              signature: z.string(),
              signatureDate: z.string(),
            }),
            coApplicantAuthorizedRepresentativeSignature: z.object({
              signature: z.string(),
              signatureDate: z.string(),
            }),
          })
          .partial(),
        homeAddress: z.object({
          addressLine1: z.string().min(1).max(150),
          addressLine2: z.string().max(150).optional(),
          city: z.string().min(1).max(100),
          stateProvince: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          county: z.string().max(100).optional(),
        }),
        mailingAddress: z.object({
          addressLine1: z.string().min(1).max(150),
          addressLine2: z.string().max(150).optional(),
          city: z.string().min(1).max(100),
          stateProvince: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          county: z.string().max(100).optional(),
        }),
        phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
        otherPhoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
        email: z.string().max(320).email(),
        speaksEnglish: z.boolean(),
        preferredLanguage: z
          .string()
          .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/),
        isHomeless: z.boolean(),
        isStateResident: z.boolean(),
        preferredNoticeMethod: z.enum(["paper", "email", "both"]),
        personWhoHelpedCompleteApplication: z
          .object({
            name: z.string().max(200),
            address: z.object({
              addressLine1: z.string().min(1).max(150),
              addressLine2: z.string().max(150).optional(),
              city: z.string().min(1).max(100),
              stateProvince: z.string().min(1).max(100),
              postalCode: z.string().min(3).max(20),
              county: z.string().max(100).optional(),
            }),
            phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
          })
          .partial(),
      })
      .partial(),
    householdDemographics: z
      .object({
        householdMembers: z
          .array(
            z.object({
              name: z.object({
                firstName: z.string().min(1).max(100),
                middleInitial: z.string().max(1).optional(),
                middleName: z.string().max(100).optional(),
                lastName: z.string().min(1).max(100),
                maidenName: z.string().max(100).optional(),
              }),
              relationship: z.enum([
                "self",
                "spouse",
                "child",
                "parent",
                "sibling",
                "other_relative",
                "non_relative",
              ]),
              dateOfBirth: z.string(),
              socialSecurityNumber: z
                .string()
                .regex(/^\d{3}-\d{2}-\d{4}$/)
                .optional(),
              isUSCitizen: z.boolean().optional(),
              citizenshipCertificateNumber: z.string().max(50).optional(),
              gender: z.enum(["male", "female", "unknown"]).optional(),
              maritalStatus: z
                .enum([
                  "single",
                  "married",
                  "divorced",
                  "separated",
                  "widowed",
                  "civil_union",
                  "domestic_partnership",
                ])
                .optional(),
              isHispanicOrLatino: z.boolean().optional(),
              race: z
                .array(
                  z.enum([
                    "american_indian_alaskan_native",
                    "asian",
                    "black_african_american",
                    "native_hawaiian_pacific_islander",
                    "white",
                  ])
                )
                .optional(),
              programsApplyingFor: z
                .object({
                  snap: z.boolean(),
                  cashPrograms: z
                    .object({
                      tanfProgram: z.boolean(),
                      adultFinancial: z.boolean(),
                    })
                    .partial(),
                  medicalAssistance: z.boolean(),
                })
                .partial()
                .and(z.object({ notApplying: z.boolean() }).partial())
                .optional(),
            })
          )
          .min(1),
        roomersOrBoarders: z.array(
          z
            .object({
              name: z.string().max(200),
              rentAmount: z.number().gte(0),
              mealsIncluded: z.boolean(),
            })
            .partial()
        ),
        institutionalizedMembers: z.array(
          z
            .object({
              name: z.string().max(200),
              dateEntered: z.string(),
              facilityName: z.string().max(200),
              facilityType: z.enum([
                "nursing_home",
                "hospital",
                "mental_health_institution",
                "incarceration",
                "other",
              ]),
              isPendingDisposition: z.boolean(),
              mealsProvided: z.boolean(),
            })
            .partial()
        ),
      })
      .partial(),
    expeditedSNAPDetails: z
      .object({
        householdSize: z.number().int().gte(1),
        isMigrantOrSeasonalFarmWorker: z.boolean(),
        totalExpectedIncomeThisMonth: z.number().gte(0),
        totalCashOnHand: z.number().gte(0),
        monthlyMortgage: z.number().gte(0),
        monthlyRent: z.number().gte(0),
        utilityCosts: z
          .object({
            electricity: z.number().gte(0),
            water: z.number().gte(0),
            phone: z.number().gte(0),
            trash: z.number().gte(0),
            sewer: z.number().gte(0),
            other: z.number().gte(0),
          })
          .partial(),
        receivedBenefitsOtherState: z.boolean(),
      })
      .partial()
      .optional(),
    ebtCard: z
      .object({
        needsEBTCard: z.boolean(),
        ebtCardDeliveryMethod: z.enum(["postal_mail", "in_person"]),
      })
      .partial()
      .optional(),
    voterRegistration: z
      .object({ wantsToRegister: z.boolean() })
      .partial()
      .optional(),
    dependentChildren: z
      .object({
        livesWithChildUnder19: z.boolean(),
        hasParentOutsideHome: z.boolean(),
        triedToGetMedicalSupport: z.boolean(),
        absentParents: z.array(
          z
            .object({
              name: z.string().max(200),
              address: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
              phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
              forWhichChild: z.string().max(200),
            })
            .partial()
        ),
        wantsGoodCauseFromChildSupport: z.boolean(),
      })
      .partial()
      .optional(),
    fosterCare: z
      .object({
        hasFosterCareHistory: z.boolean(),
        members: z.array(
          z
            .object({
              name: z.string().max(200),
              currentAge: z.number().int().gte(0),
              datesInFosterCare: z.string().max(200),
              ageWhenLeft: z.number().int().gte(0),
            })
            .partial()
        ),
        formerFosterCareMedicalAssistance: z
          .object({
            receivedFormerFosterCareMedicalAssistance: z.boolean(),
            name: z.string().max(200),
            stateLivedInWhenAgedOut: z.string().max(2),
            nameUsedInOutOfStateFosterCare: z.string().max(200),
            dateLeftFosterCare: z.string(),
            wereAdopted: z.boolean(),
            returnedToFosterCareAfterAdoption: z.boolean(),
            residencyDate: z.string(),
            needsHelpPayingMedicalBills: z.boolean(),
            medicalBillsHelpWhen: z.string(),
            medicalBillsHelpMonths: z.array(z.string()),
          })
          .partial(),
      })
      .partial()
      .optional(),
    familyPlanning: z
      .object({
        wantsFamilyPlanningBenefits: z.boolean(),
        names: z.array(z.string().max(200)),
      })
      .partial()
      .optional(),
    pregnancy: z
      .object({
        isAnyonePregnant: z.boolean(),
        pregnancies: z.array(
          z
            .object({
              name: z.string().max(200),
              dueDate: z.string(),
              numberOfBabiesExpected: z.number().int().gte(1),
              fatherName: z.string().max(200),
              wantsGoodCauseFromChildSupport: z.boolean(),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    disability: z
      .object({
        hasDisability: z.boolean(),
        disabledMembers: z.array(
          z
            .object({
              name: z.string().max(200),
              needsHelpWithSelfCare: z.boolean(),
              hasMedicalOrDevelopmentalCondition: z.boolean(),
            })
            .partial()
        ),
        socialSecurityApplications: z.array(
          z
            .object({
              name: z.string().max(200),
              program: z.enum(["SSI", "SSDI", "other"]),
              otherProgramName: z.string().max(200),
              applicationDate: z.string(),
              status: z.enum(["pending", "approved", "denied", "appealed"]),
            })
            .partial()
        ),
        everReceivedSSIOrSSDI: z.boolean(),
        ssiOrSsdiEndDate: z.string(),
      })
      .partial()
      .optional(),
    nonCitizen: z
      .object({
        wantsEmergencyMedicaidAndReproductiveBenefits: z.boolean(),
        emergencyMedicaidApplicants: z.array(z.string().max(200)),
        hasNonCitizens: z.boolean(),
        nonCitizens: z.array(
          z
            .object({
              name: z.string().max(200),
              status: z.string().max(100),
              documentType: z.string().max(100),
              documentNumber: z.string().max(100),
              alienOrI94Number: z.string().max(100),
              documentExpirationDate: z.string(),
              countryOfIssuance: z.string().max(100),
              livedInUSSince1996: z.boolean(),
              spouseOrParentIsVeteranOrActiveDuty: z.boolean(),
              hasSponsor: z.boolean(),
              sponsor: z
                .object({
                  hasBeenAbandonedMistreatedOrAbused: z.boolean(),
                  isPregnantOr20OrYounger: z.boolean(),
                  sponsorName: z.string().max(200),
                  sponsorSpouseName: z.string().max(200),
                  sponsorSocialSecurityNumber: z
                    .string()
                    .regex(/^\d{3}-\d{2}-\d{4}$/),
                  sponsorAddress: z.object({
                    addressLine1: z.string().min(1).max(150),
                    addressLine2: z.string().max(150).optional(),
                    city: z.string().min(1).max(100),
                    stateProvince: z.string().min(1).max(100),
                    postalCode: z.string().min(3).max(20),
                    county: z.string().max(100).optional(),
                  }),
                  sponsorSpouseSocialSecurityNumber: z
                    .string()
                    .regex(/^\d{3}-\d{2}-\d{4}$/),
                  totalPeopleInSponsorHousehold: z.number().int().gte(1),
                  doesSponsoredIndividualLiveWithSponsor: z.boolean(),
                  doesSponsoredIndividualReceiveFreeRoomAndBoard: z.boolean(),
                  doesSponsoredIndividualReceiveSupportFromSponsor: z.boolean(),
                })
                .partial(),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    earnedIncome: z
      .object({
        hasEmployment: z.boolean(),
        jobs: z.array(
          z
            .object({
              personName: z.string().max(200),
              employerName: z.string().max(200),
              employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
              monthlyWagesBeforeTaxes: z.number().gte(0),
              hourlyWage: z.number().gte(0),
              averageHoursPerWeek: z.number().gte(0).lte(168),
              payFrequency: z.enum([
                "hourly",
                "weekly",
                "every_two_weeks",
                "twice_monthly",
                "monthly",
                "yearly",
                "daily",
              ]),
              isTemporaryJob: z.boolean(),
              incomeType: z.enum([
                "seasonal_employment",
                "commission_based_employment",
                "regular_employment",
              ]),
            })
            .partial()
        ),
        hasSelfEmployment: z.boolean(),
        selfEmployment: z.array(
          z
            .object({
              personName: z.string().max(200),
              businessName: z.string().max(200),
              oneMonthsGrossIncome: z.number().gte(0),
              monthOfIncome: z.string(),
              selfEmploymentType: z.enum([
                "sole_proprietor",
                "llc",
                "s_corp",
                "independent_contractor",
              ]),
              utilitiesPaidForBusiness: z.number().gte(0),
              businessTaxesPaid: z.number().gte(0),
              interestPaidForBusiness: z.number().gte(0),
              grossBusinessLaborCosts: z.number().gte(0),
              costOfMerchandise: z.number().gte(0),
              otherBusinessCosts: z.array(
                z
                  .object({
                    type: z.string().max(200),
                    amount: z.number().gte(0),
                  })
                  .partial()
              ),
              totalNetIncome: z.number(),
            })
            .partial()
        ),
        hasJobChanges: z.boolean(),
        jobChanges: z.array(
          z
            .object({
              personName: z.string().max(200),
              employerName: z.string().max(200),
              employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
              startDate: z.string(),
              endDate: z.string(),
              monthlyWagesBeforeTaxes: z.number().gte(0),
              lastPaycheckDate: z.string(),
              lastPaycheckAmount: z.number().gte(0),
              payFrequency: z.enum([
                "hourly",
                "weekly",
                "every_two_weeks",
                "twice_monthly",
                "monthly",
                "yearly",
              ]),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    unearnedIncome: z
      .object({
        hasOtherIncome: z.boolean(),
        incomeSources: z.array(
          z
            .object({
              personName: z.string().max(200),
              incomeType: z.enum([
                "unemployment_benefits",
                "SSI",
                "veterans_benefits",
                "widow_benefits",
                "workers_comp",
                "railroad_retirement",
                "child_support",
                "survivors_benefits",
                "dividends_interest",
                "rental_income",
                "money_from_boarder",
                "disability_benefits",
                "retirement_pension",
                "SSDI",
                "alimony",
                "in_kind_income",
                "social_security_benefits",
                "public_assistance",
                "plasma_donations",
                "gifts",
                "loans",
                "foster_care_payments",
                "tribal_benefits",
                "other",
              ]),
              monthlyAmount: z.number().gte(0),
            })
            .partial()
        ),
        hasLumpSumPayments: z.boolean(),
        lumpSumPayments: z.array(
          z
            .object({
              personName: z.string().max(200),
              dateReceived: z.string(),
              type: z.enum([
                "lawsuit_settlement",
                "insurance_settlement",
                "social_security_ssi_ssdi_payment",
                "veterans",
                "inheritance",
                "surrender_of_annuity",
                "life_insurance_payout",
                "lottery_gambling_winnings",
                "other",
              ]),
              amount: z.number().gte(0),
            })
            .partial()
        ),
        isAnyoneOnStrike: z.boolean(),
        strikeInformation: z.array(
          z
            .object({
              personName: z.string().max(200),
              strikeBeginDate: z.string(),
              lastPaycheckDate: z.string(),
              lastPaycheckAmount: z.number().gte(0),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    expenses: z
      .object({
        rent: z
          .object({
            hasRentExpenses: z.boolean(),
            rentExpenses: z.array(
              z
                .object({
                  expenseType: z.enum([
                    "rent",
                    "renters_insurance",
                    "pet_fee",
                    "washer_dryer_fee",
                    "condo_fee",
                    "maintenance_fee",
                    "other",
                  ]),
                  whoPays: z.string().max(200),
                  isPersonInHome: z.boolean(),
                  whoIsExpenseFor: z.string().max(200),
                  expenseMonth: z.string(),
                  amountPaid: z.number().gte(0),
                })
                .partial()
            ),
            utilitiesIncludedInRent: z.boolean(),
            receivesSection8OrPublicHousing: z.boolean(),
            housingAssistanceType: z.enum(["section8", "public_housing"]),
          })
          .partial(),
        mortgage: z
          .object({
            hasMortgageExpenses: z.boolean(),
            mortgageExpenses: z.array(
              z
                .object({
                  expenseType: z.enum([
                    "mortgage",
                    "homeowners_insurance",
                    "property_taxes",
                    "hoa_fees",
                  ]),
                  whoPays: z.string().max(200),
                  isPersonInHome: z.boolean(),
                  whoIsExpenseFor: z.string().max(200),
                  expenseMonth: z.string(),
                  amountPaid: z.number().gte(0),
                })
                .partial()
            ),
            receivesSection8OrPublicHousing: z.boolean(),
            housingAssistanceType: z.enum(["section8", "public_housing"]),
          })
          .partial(),
        utilities: z
          .object({
            heatingCoolingMethod: z.array(
              z.enum([
                "electric",
                "gas",
                "firewood",
                "propane",
                "swamp_cooler",
                "other",
              ])
            ),
            otherHeatingCoolingType: z.string().max(100),
            receivedLEAP: z.boolean(),
          })
          .partial(),
        additionalExpenses: z
          .object({
            hasAdditionalExpenses: z.boolean(),
            expenses: z.array(
              z
                .object({
                  expenseType: z.enum([
                    "child_daycare",
                    "adult_daycare",
                    "legally_obligated_child_support",
                    "child_support_arrears",
                    "medical_expenses",
                    "student_loan_interest",
                    "alimony",
                  ]),
                  whoPays: z.string().max(200),
                  isPersonInHome: z.boolean(),
                  whoIsExpenseFor: z.string().max(200),
                  monthOfExpense: z.string(),
                  amountPaid: z.number().gte(0),
                  legallyObligatedAmount: z.number().gte(0),
                })
                .partial()
            ),
          })
          .partial(),
      })
      .partial()
      .optional(),
    students: z
      .object({
        hasStudents: z.boolean(),
        studentDetails: z.array(
          z
            .object({
              name: z.string().max(200),
              schoolName: z.string().max(200),
              lastGradeCompleted: z.string().max(50),
              startDate: z.string(),
              expectedGraduationDate: z.string(),
              isFullTimeStudent: z.boolean(),
            })
            .partial()
        ),
        hasFinancialAid: z.boolean(),
        financialAid: z.array(
          z.object({ personName: z.string().max(200) }).partial()
        ),
        grantsScholarshipsWorkStudyForLivingExpenses: z.number().gte(0),
        taxableGrantsScholarshipsWorkStudy: z.number().gte(0),
      })
      .partial()
      .optional(),
    resources: z
      .object({
        hasResources: z.boolean(),
        financialResources: z.array(
          z
            .object({
              personName: z.string().max(200),
              resourceType: z.enum([
                "cash_on_hand",
                "checking_account",
                "savings_account",
                "stocks",
                "bonds",
                "mutual_funds",
                "401k",
                "ira",
                "trusts",
                "cds",
                "annuities",
                "college_funds",
                "pass_accounts",
                "idas",
                "promissory_notes",
                "education_accounts",
                "other",
              ]),
              financialInstitutionName: z.string().max(200),
              accountNumber: z.string().max(100),
              currentValue: z.number().gte(0),
            })
            .partial()
        ),
        hasVehicles: z.boolean(),
        vehicles: z.array(
          z
            .object({
              personName: z.string().max(200),
              year: z.number().int().gte(1900),
              make: z.string().max(100),
              model: z.string().max(100),
              currentValue: z.number().gte(0),
            })
            .partial()
        ),
        hasLifeOrBurialInsurance: z.boolean(),
        lifeOrBurialInsurance: z.array(
          z
            .object({
              personName: z.string().max(200),
              policyType: z.enum(["life_insurance", "burial_insurance"]),
              company: z.string().max(200),
              policyNumber: z.string().max(100),
              revocableOrIrrevocable: z.enum(["revocable", "irrevocable"]),
              policyValue: z.number().gte(0),
            })
            .partial()
        ),
        ownsProperty: z.boolean(),
        property: z.array(
          z
            .object({
              personName: z.string().max(200),
              propertyType: z.string().max(200),
              propertyAddress: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
              primaryPropertyUse: z.array(
                z.enum([
                  "primary_home",
                  "rental_income",
                  "business_self_employment",
                  "other",
                ])
              ),
              primaryPropertyUseOther: z.string().max(200),
              currentValue: z.number().gte(0),
            })
            .partial()
        ),
        hasTransferredAssets: z.boolean(),
        transferredAssets: z.array(
          z
            .object({
              personName: z.string().max(200),
              dateOfTransfer: z.string(),
              assetDescription: z.string().max(500),
              amountReceived: z.number().gte(0),
              fairMarketValue: z.number().gte(0),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    priorConvictions: z
      .object({
        convictedOfDuplicateSNAPBenefits: z.boolean(),
        duplicateSNAPBenefitsWho: z.array(z.string().max(200)),
        hidingFromLaw: z.boolean(),
        hidingFromLawWho: z.array(z.string().max(200)),
        convictedOfDrugFelony: z.boolean(),
        drugFelonyWho: z.array(z.string().max(200)),
        convictedOfSNAPTrafficking: z.boolean(),
        snapTraffickingWho: z.array(z.string().max(200)),
        convictedOfTradingSNAPForWeapons: z.boolean(),
        tradingSNAPForWeaponsWho: z.array(z.string().max(200)),
        disqualifiedForIPVOrWelfareFraud: z.boolean(),
        ipvOrWelfareFraudWho: z.array(z.string().max(200)),
        convictedOfViolentCrime: z.boolean(),
        violentCrimeWho: z.array(z.string().max(200)),
      })
      .partial()
      .optional(),
    hasMilitaryService: z.boolean().optional(),
    militaryServiceMembers: z.array(z.string().max(200)).optional(),
    burialPreference: z
      .enum(["cremation", "burial", "no_preference"])
      .optional(),
    retroactiveMedicalCoverage: z
      .object({
        wantsRetroactiveCoverage: z.boolean(),
        requests: z.array(
          z
            .object({
              who: z.string().max(200),
              months: z.array(z.string()),
              householdIncomeInThoseMonths: z.number().gte(0),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    taxFiler: z
      .object({
        taxFilers: z.array(
          z
            .object({
              name: z.string().max(200),
              willFileTaxes: z.boolean(),
              filingJointlyWithSpouse: z.boolean(),
              spouseName: z.string().max(200),
              willClaimDependents: z.boolean(),
              dependentsToClaim: z.array(z.string().max(200)),
              expectsToBeClaimedAsDependent: z.boolean(),
              isClaimedAsDependent: z.boolean(),
              nameOfPersonClaiming: z.string().max(200),
              isPersonClaimingListedOnApplication: z.boolean(),
              isPersonClaimingNonCustodialParent: z.boolean(),
              marriedFilingSeparatelyWithExceptionalCircumstances: z.boolean(),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    healthInsurance: z
      .object({
        hasHealthInsurance: z.boolean(),
        coverageDetails: z.array(
          z
            .object({
              personName: z.string().max(200),
              typeOfCoverage: z.enum([
                "medicare",
                "tricare",
                "va_health_care",
                "peace_corps",
                "cobra",
                "retiree_health_plan",
                "current_employer_sponsored",
                "railroad_retirement_insurance",
              ]),
              coverageStartDate: z.string(),
              coverageEndDate: z.string(),
              enrollmentStatus: z.enum(["eligible", "enrolled"]),
            })
            .partial()
        ),
        federalHealthBenefitPrograms: z.array(
          z
            .object({
              programTypeOrName: z.string().max(200),
              whoIsEnrolled: z.string().max(200),
              insuranceCompanyName: z.string().max(200),
              policyNumber: z.string().max(100),
            })
            .partial()
        ),
        employerSponsoredCoverage: z.array(
          z
            .object({
              employerName: z.string().max(200),
              employerIdentificationNumber: z.string().max(50),
              employerAddress: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
              employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
              contactAboutCoverage: z.string().max(200),
              coverageStartDate: z.string(),
              coverageEndDate: z.string(),
              whoElseHadAccess: z.string().max(200),
              whoElseWasEnrolled: z.string().max(200),
              premiumAmount: z.number().gte(0),
              premiumAmountUnknown: z.boolean(),
              premiumFrequency: z.enum([
                "weekly",
                "every_two_weeks",
                "twice_monthly",
                "monthly",
                "yearly",
              ]),
              hasEmployeeOnlyPlanMeetingMinimumValue: z.boolean(),
              lowestCostPlanName: z.string().max(200),
              lowestCostPlanUnknown: z.boolean(),
              noPlansMeetMinimumValue: z.boolean(),
            })
            .partial()
        ),
        medicare: z.array(
          z
            .object({
              personName: z.string().max(200),
              partA: z
                .object({
                  isEntitledOrReceiving: z.boolean(),
                  startDate: z.string(),
                  isCurrentlyEnrolled: z.boolean(),
                  whoPaysPremium: z.string().max(200),
                  isPremiumFree: z.boolean(),
                })
                .partial(),
              partB: z
                .object({
                  isEntitledOrReceiving: z.boolean(),
                  startDate: z.string(),
                  premiumAmount: z.number().gte(0),
                  whoPaysPremium: z.string().max(200),
                })
                .partial(),
              partC: z
                .object({
                  isEntitledOrReceiving: z.boolean(),
                  startDate: z.string(),
                })
                .partial(),
              partD: z
                .object({
                  isEntitledOrReceiving: z.boolean(),
                  startDate: z.string(),
                  premiumAmount: z.number().gte(0),
                  whoPaysPremium: z.string().max(200),
                })
                .partial(),
            })
            .partial()
        ),
        hasLegalClaim: z.boolean(),
        legalClaimNames: z.array(z.string().max(200)),
        wantsSeparateMail: z.boolean(),
        separateMailAddresses: z.array(
          z
            .object({
              name: z.string().max(200),
              address: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    expectedIncomeChange: z
      .object({
        doesIncomeChangeFromMonthToMonth: z.boolean(),
        changes: z.array(
          z
            .object({
              name: z.string().max(200),
              annualIncome: z.number().gte(0),
              employerName: z.string().max(200),
              willAnnualIncomeBeSameOrLowerNextYear: z.boolean(),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    reasonsForIncomeDifferences: z
      .object({
        incomeDifferences: z.array(
          z
            .object({
              name: z.string().max(200),
              whatHappened: z.enum([
                "stopped_working_job",
                "hours_changed_at_job",
                "change_in_employment",
                "married_legal_separation_or_divorce",
                "other",
              ]),
            })
            .partial()
        ),
        hasJobOrNonJobRelatedDeductions: z.boolean(),
        deductionsChangeMonthToMonth: z.boolean(),
        deductions: z.array(
          z
            .object({
              deductionType: z.string().max(200),
              frequency: z.enum([
                "one_time_only",
                "weekly",
                "every_two_weeks",
                "twice_monthly",
                "monthly",
                "yearly",
              ]),
              currentAmount: z.number().gte(0),
              actualAnnualAmount: z.number().gte(0),
            })
            .partial()
        ),
        hasPastIncomeAndDeductions: z.boolean(),
        pastIncomeAmount: z.number().gte(0),
        pastDeductionsAmount: z.number().gte(0),
      })
      .partial()
      .optional(),
    americanIndianOrAlaskaNativeInformation: z
      .object({
        isAnyoneAmericanIndianOrAlaskaNative: z.boolean(),
        members: z.array(
          z
            .object({
              name: z.string().max(200),
              tribeName: z.string().max(200),
              tribeState: z.string().max(100),
              typeOfIncomeReceived: z.string().max(200),
              frequencyAndAmount: z.string().max(200),
            })
            .partial()
        ),
        hasAnyoneReceivedServiceFromIndianHealthService: z.boolean(),
        whoReceivedService: z.array(z.string().max(200)),
        isAnyoneEligibleForIndianHealthService: z.boolean(),
        whoIsEligible: z.array(z.string().max(200)),
      })
      .partial()
      .optional(),
    permissionToValidateIncome: z
      .object({ doesNotGivePermissionToValidateIncome: z.boolean() })
      .partial()
      .optional(),
    authorizedRepresentativeForMedicalAssistance: z
      .object({
        isIndividual: z.boolean(),
        name: z.string().max(200),
        organizationId: z.string().max(50),
        address: z.object({
          addressLine1: z.string().min(1).max(150),
          addressLine2: z.string().max(150).optional(),
          city: z.string().min(1).max(100),
          stateProvince: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          county: z.string().max(100).optional(),
        }),
        inCareOf: z.string().max(200),
        phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
        email: z.string().max(320).email(),
        receiveNotices: z.boolean(),
        applicantSignature: z.object({
          signature: z.string(),
          signatureDate: z.string(),
        }),
        authorizedRepresentativeSignature: z.object({
          signature: z.string(),
          signatureDate: z.string(),
        }),
      })
      .partial()
      .optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .and(z.object({}).passthrough());
const updateApplication_Body = z
  .object({
    id: z.string().uuid(),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    status: z
      .enum([
        "draft",
        "submitted",
        "under_review",
        "approved",
        "denied",
        "pending_information",
        "withdrawn",
      ])
      .optional(),
    programs: z
      .object({
        snap: z.boolean(),
        cashPrograms: z
          .object({ tanfProgram: z.boolean(), adultFinancial: z.boolean() })
          .partial(),
        medicalAssistance: z.boolean(),
      })
      .partial()
      .and(z.object({}).partial().passthrough()),
    applicantInfo: z
      .object({
        applicantName: z.object({
          firstName: z.string().min(1).max(100),
          middleInitial: z.string().max(1).optional(),
          middleName: z.string().max(100).optional(),
          lastName: z.string().min(1).max(100),
          maidenName: z.string().max(100).optional(),
        }),
        socialSecurityNumber: z.string().regex(/^\d{3}-\d{2}-\d{4}$/),
        dateOfBirth: z.string(),
        signature: z
          .object({
            applicantSignature: z.object({
              signature: z.string(),
              signatureDate: z.string(),
            }),
            spouseCoApplicantSignature: z.object({
              signature: z.string(),
              signatureDate: z.string(),
            }),
            applicantAuthorizedRepresentativeSignature: z.object({
              signature: z.string(),
              signatureDate: z.string(),
            }),
            coApplicantAuthorizedRepresentativeSignature: z.object({
              signature: z.string(),
              signatureDate: z.string(),
            }),
          })
          .partial(),
        homeAddress: z.object({
          addressLine1: z.string().min(1).max(150),
          addressLine2: z.string().max(150).optional(),
          city: z.string().min(1).max(100),
          stateProvince: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          county: z.string().max(100).optional(),
        }),
        mailingAddress: z.object({
          addressLine1: z.string().min(1).max(150),
          addressLine2: z.string().max(150).optional(),
          city: z.string().min(1).max(100),
          stateProvince: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          county: z.string().max(100).optional(),
        }),
        phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
        otherPhoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
        email: z.string().max(320).email(),
        speaksEnglish: z.boolean(),
        preferredLanguage: z
          .string()
          .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/),
        isHomeless: z.boolean(),
        isStateResident: z.boolean(),
        preferredNoticeMethod: z.enum(["paper", "email", "both"]),
        personWhoHelpedCompleteApplication: z
          .object({
            name: z.string().max(200),
            address: z.object({
              addressLine1: z.string().min(1).max(150),
              addressLine2: z.string().max(150).optional(),
              city: z.string().min(1).max(100),
              stateProvince: z.string().min(1).max(100),
              postalCode: z.string().min(3).max(20),
              county: z.string().max(100).optional(),
            }),
            phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
          })
          .partial(),
      })
      .partial(),
    householdDemographics: z
      .object({
        householdMembers: z
          .array(
            z.object({
              name: z.object({
                firstName: z.string().min(1).max(100),
                middleInitial: z.string().max(1).optional(),
                middleName: z.string().max(100).optional(),
                lastName: z.string().min(1).max(100),
                maidenName: z.string().max(100).optional(),
              }),
              relationship: z.enum([
                "self",
                "spouse",
                "child",
                "parent",
                "sibling",
                "other_relative",
                "non_relative",
              ]),
              dateOfBirth: z.string(),
              socialSecurityNumber: z
                .string()
                .regex(/^\d{3}-\d{2}-\d{4}$/)
                .optional(),
              isUSCitizen: z.boolean().optional(),
              citizenshipCertificateNumber: z.string().max(50).optional(),
              gender: z.enum(["male", "female", "unknown"]).optional(),
              maritalStatus: z
                .enum([
                  "single",
                  "married",
                  "divorced",
                  "separated",
                  "widowed",
                  "civil_union",
                  "domestic_partnership",
                ])
                .optional(),
              isHispanicOrLatino: z.boolean().optional(),
              race: z
                .array(
                  z.enum([
                    "american_indian_alaskan_native",
                    "asian",
                    "black_african_american",
                    "native_hawaiian_pacific_islander",
                    "white",
                  ])
                )
                .optional(),
              programsApplyingFor: z
                .object({
                  snap: z.boolean(),
                  cashPrograms: z
                    .object({
                      tanfProgram: z.boolean(),
                      adultFinancial: z.boolean(),
                    })
                    .partial(),
                  medicalAssistance: z.boolean(),
                })
                .partial()
                .and(z.object({ notApplying: z.boolean() }).partial())
                .optional(),
            })
          )
          .min(1),
        roomersOrBoarders: z.array(
          z
            .object({
              name: z.string().max(200),
              rentAmount: z.number().gte(0),
              mealsIncluded: z.boolean(),
            })
            .partial()
        ),
        institutionalizedMembers: z.array(
          z
            .object({
              name: z.string().max(200),
              dateEntered: z.string(),
              facilityName: z.string().max(200),
              facilityType: z.enum([
                "nursing_home",
                "hospital",
                "mental_health_institution",
                "incarceration",
                "other",
              ]),
              isPendingDisposition: z.boolean(),
              mealsProvided: z.boolean(),
            })
            .partial()
        ),
      })
      .partial(),
    expeditedSNAPDetails: z
      .object({
        householdSize: z.number().int().gte(1),
        isMigrantOrSeasonalFarmWorker: z.boolean(),
        totalExpectedIncomeThisMonth: z.number().gte(0),
        totalCashOnHand: z.number().gte(0),
        monthlyMortgage: z.number().gte(0),
        monthlyRent: z.number().gte(0),
        utilityCosts: z
          .object({
            electricity: z.number().gte(0),
            water: z.number().gte(0),
            phone: z.number().gte(0),
            trash: z.number().gte(0),
            sewer: z.number().gte(0),
            other: z.number().gte(0),
          })
          .partial(),
        receivedBenefitsOtherState: z.boolean(),
      })
      .partial()
      .optional(),
    ebtCard: z
      .object({
        needsEBTCard: z.boolean(),
        ebtCardDeliveryMethod: z.enum(["postal_mail", "in_person"]),
      })
      .partial()
      .optional(),
    voterRegistration: z
      .object({ wantsToRegister: z.boolean() })
      .partial()
      .optional(),
    dependentChildren: z
      .object({
        livesWithChildUnder19: z.boolean(),
        hasParentOutsideHome: z.boolean(),
        triedToGetMedicalSupport: z.boolean(),
        absentParents: z.array(
          z
            .object({
              name: z.string().max(200),
              address: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
              phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
              forWhichChild: z.string().max(200),
            })
            .partial()
        ),
        wantsGoodCauseFromChildSupport: z.boolean(),
      })
      .partial()
      .optional(),
    fosterCare: z
      .object({
        hasFosterCareHistory: z.boolean(),
        members: z.array(
          z
            .object({
              name: z.string().max(200),
              currentAge: z.number().int().gte(0),
              datesInFosterCare: z.string().max(200),
              ageWhenLeft: z.number().int().gte(0),
            })
            .partial()
        ),
        formerFosterCareMedicalAssistance: z
          .object({
            receivedFormerFosterCareMedicalAssistance: z.boolean(),
            name: z.string().max(200),
            stateLivedInWhenAgedOut: z.string().max(2),
            nameUsedInOutOfStateFosterCare: z.string().max(200),
            dateLeftFosterCare: z.string(),
            wereAdopted: z.boolean(),
            returnedToFosterCareAfterAdoption: z.boolean(),
            residencyDate: z.string(),
            needsHelpPayingMedicalBills: z.boolean(),
            medicalBillsHelpWhen: z.string(),
            medicalBillsHelpMonths: z.array(z.string()),
          })
          .partial(),
      })
      .partial()
      .optional(),
    familyPlanning: z
      .object({
        wantsFamilyPlanningBenefits: z.boolean(),
        names: z.array(z.string().max(200)),
      })
      .partial()
      .optional(),
    pregnancy: z
      .object({
        isAnyonePregnant: z.boolean(),
        pregnancies: z.array(
          z
            .object({
              name: z.string().max(200),
              dueDate: z.string(),
              numberOfBabiesExpected: z.number().int().gte(1),
              fatherName: z.string().max(200),
              wantsGoodCauseFromChildSupport: z.boolean(),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    disability: z
      .object({
        hasDisability: z.boolean(),
        disabledMembers: z.array(
          z
            .object({
              name: z.string().max(200),
              needsHelpWithSelfCare: z.boolean(),
              hasMedicalOrDevelopmentalCondition: z.boolean(),
            })
            .partial()
        ),
        socialSecurityApplications: z.array(
          z
            .object({
              name: z.string().max(200),
              program: z.enum(["SSI", "SSDI", "other"]),
              otherProgramName: z.string().max(200),
              applicationDate: z.string(),
              status: z.enum(["pending", "approved", "denied", "appealed"]),
            })
            .partial()
        ),
        everReceivedSSIOrSSDI: z.boolean(),
        ssiOrSsdiEndDate: z.string(),
      })
      .partial()
      .optional(),
    nonCitizen: z
      .object({
        wantsEmergencyMedicaidAndReproductiveBenefits: z.boolean(),
        emergencyMedicaidApplicants: z.array(z.string().max(200)),
        hasNonCitizens: z.boolean(),
        nonCitizens: z.array(
          z
            .object({
              name: z.string().max(200),
              status: z.string().max(100),
              documentType: z.string().max(100),
              documentNumber: z.string().max(100),
              alienOrI94Number: z.string().max(100),
              documentExpirationDate: z.string(),
              countryOfIssuance: z.string().max(100),
              livedInUSSince1996: z.boolean(),
              spouseOrParentIsVeteranOrActiveDuty: z.boolean(),
              hasSponsor: z.boolean(),
              sponsor: z
                .object({
                  hasBeenAbandonedMistreatedOrAbused: z.boolean(),
                  isPregnantOr20OrYounger: z.boolean(),
                  sponsorName: z.string().max(200),
                  sponsorSpouseName: z.string().max(200),
                  sponsorSocialSecurityNumber: z
                    .string()
                    .regex(/^\d{3}-\d{2}-\d{4}$/),
                  sponsorAddress: z.object({
                    addressLine1: z.string().min(1).max(150),
                    addressLine2: z.string().max(150).optional(),
                    city: z.string().min(1).max(100),
                    stateProvince: z.string().min(1).max(100),
                    postalCode: z.string().min(3).max(20),
                    county: z.string().max(100).optional(),
                  }),
                  sponsorSpouseSocialSecurityNumber: z
                    .string()
                    .regex(/^\d{3}-\d{2}-\d{4}$/),
                  totalPeopleInSponsorHousehold: z.number().int().gte(1),
                  doesSponsoredIndividualLiveWithSponsor: z.boolean(),
                  doesSponsoredIndividualReceiveFreeRoomAndBoard: z.boolean(),
                  doesSponsoredIndividualReceiveSupportFromSponsor: z.boolean(),
                })
                .partial(),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    earnedIncome: z
      .object({
        hasEmployment: z.boolean(),
        jobs: z.array(
          z
            .object({
              personName: z.string().max(200),
              employerName: z.string().max(200),
              employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
              monthlyWagesBeforeTaxes: z.number().gte(0),
              hourlyWage: z.number().gte(0),
              averageHoursPerWeek: z.number().gte(0).lte(168),
              payFrequency: z.enum([
                "hourly",
                "weekly",
                "every_two_weeks",
                "twice_monthly",
                "monthly",
                "yearly",
                "daily",
              ]),
              isTemporaryJob: z.boolean(),
              incomeType: z.enum([
                "seasonal_employment",
                "commission_based_employment",
                "regular_employment",
              ]),
            })
            .partial()
        ),
        hasSelfEmployment: z.boolean(),
        selfEmployment: z.array(
          z
            .object({
              personName: z.string().max(200),
              businessName: z.string().max(200),
              oneMonthsGrossIncome: z.number().gte(0),
              monthOfIncome: z.string(),
              selfEmploymentType: z.enum([
                "sole_proprietor",
                "llc",
                "s_corp",
                "independent_contractor",
              ]),
              utilitiesPaidForBusiness: z.number().gte(0),
              businessTaxesPaid: z.number().gte(0),
              interestPaidForBusiness: z.number().gte(0),
              grossBusinessLaborCosts: z.number().gte(0),
              costOfMerchandise: z.number().gte(0),
              otherBusinessCosts: z.array(
                z
                  .object({
                    type: z.string().max(200),
                    amount: z.number().gte(0),
                  })
                  .partial()
              ),
              totalNetIncome: z.number(),
            })
            .partial()
        ),
        hasJobChanges: z.boolean(),
        jobChanges: z.array(
          z
            .object({
              personName: z.string().max(200),
              employerName: z.string().max(200),
              employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
              startDate: z.string(),
              endDate: z.string(),
              monthlyWagesBeforeTaxes: z.number().gte(0),
              lastPaycheckDate: z.string(),
              lastPaycheckAmount: z.number().gte(0),
              payFrequency: z.enum([
                "hourly",
                "weekly",
                "every_two_weeks",
                "twice_monthly",
                "monthly",
                "yearly",
              ]),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    unearnedIncome: z
      .object({
        hasOtherIncome: z.boolean(),
        incomeSources: z.array(
          z
            .object({
              personName: z.string().max(200),
              incomeType: z.enum([
                "unemployment_benefits",
                "SSI",
                "veterans_benefits",
                "widow_benefits",
                "workers_comp",
                "railroad_retirement",
                "child_support",
                "survivors_benefits",
                "dividends_interest",
                "rental_income",
                "money_from_boarder",
                "disability_benefits",
                "retirement_pension",
                "SSDI",
                "alimony",
                "in_kind_income",
                "social_security_benefits",
                "public_assistance",
                "plasma_donations",
                "gifts",
                "loans",
                "foster_care_payments",
                "tribal_benefits",
                "other",
              ]),
              monthlyAmount: z.number().gte(0),
            })
            .partial()
        ),
        hasLumpSumPayments: z.boolean(),
        lumpSumPayments: z.array(
          z
            .object({
              personName: z.string().max(200),
              dateReceived: z.string(),
              type: z.enum([
                "lawsuit_settlement",
                "insurance_settlement",
                "social_security_ssi_ssdi_payment",
                "veterans",
                "inheritance",
                "surrender_of_annuity",
                "life_insurance_payout",
                "lottery_gambling_winnings",
                "other",
              ]),
              amount: z.number().gte(0),
            })
            .partial()
        ),
        isAnyoneOnStrike: z.boolean(),
        strikeInformation: z.array(
          z
            .object({
              personName: z.string().max(200),
              strikeBeginDate: z.string(),
              lastPaycheckDate: z.string(),
              lastPaycheckAmount: z.number().gte(0),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    expenses: z
      .object({
        rent: z
          .object({
            hasRentExpenses: z.boolean(),
            rentExpenses: z.array(
              z
                .object({
                  expenseType: z.enum([
                    "rent",
                    "renters_insurance",
                    "pet_fee",
                    "washer_dryer_fee",
                    "condo_fee",
                    "maintenance_fee",
                    "other",
                  ]),
                  whoPays: z.string().max(200),
                  isPersonInHome: z.boolean(),
                  whoIsExpenseFor: z.string().max(200),
                  expenseMonth: z.string(),
                  amountPaid: z.number().gte(0),
                })
                .partial()
            ),
            utilitiesIncludedInRent: z.boolean(),
            receivesSection8OrPublicHousing: z.boolean(),
            housingAssistanceType: z.enum(["section8", "public_housing"]),
          })
          .partial(),
        mortgage: z
          .object({
            hasMortgageExpenses: z.boolean(),
            mortgageExpenses: z.array(
              z
                .object({
                  expenseType: z.enum([
                    "mortgage",
                    "homeowners_insurance",
                    "property_taxes",
                    "hoa_fees",
                  ]),
                  whoPays: z.string().max(200),
                  isPersonInHome: z.boolean(),
                  whoIsExpenseFor: z.string().max(200),
                  expenseMonth: z.string(),
                  amountPaid: z.number().gte(0),
                })
                .partial()
            ),
            receivesSection8OrPublicHousing: z.boolean(),
            housingAssistanceType: z.enum(["section8", "public_housing"]),
          })
          .partial(),
        utilities: z
          .object({
            heatingCoolingMethod: z.array(
              z.enum([
                "electric",
                "gas",
                "firewood",
                "propane",
                "swamp_cooler",
                "other",
              ])
            ),
            otherHeatingCoolingType: z.string().max(100),
            receivedLEAP: z.boolean(),
          })
          .partial(),
        additionalExpenses: z
          .object({
            hasAdditionalExpenses: z.boolean(),
            expenses: z.array(
              z
                .object({
                  expenseType: z.enum([
                    "child_daycare",
                    "adult_daycare",
                    "legally_obligated_child_support",
                    "child_support_arrears",
                    "medical_expenses",
                    "student_loan_interest",
                    "alimony",
                  ]),
                  whoPays: z.string().max(200),
                  isPersonInHome: z.boolean(),
                  whoIsExpenseFor: z.string().max(200),
                  monthOfExpense: z.string(),
                  amountPaid: z.number().gte(0),
                  legallyObligatedAmount: z.number().gte(0),
                })
                .partial()
            ),
          })
          .partial(),
      })
      .partial()
      .optional(),
    students: z
      .object({
        hasStudents: z.boolean(),
        studentDetails: z.array(
          z
            .object({
              name: z.string().max(200),
              schoolName: z.string().max(200),
              lastGradeCompleted: z.string().max(50),
              startDate: z.string(),
              expectedGraduationDate: z.string(),
              isFullTimeStudent: z.boolean(),
            })
            .partial()
        ),
        hasFinancialAid: z.boolean(),
        financialAid: z.array(
          z.object({ personName: z.string().max(200) }).partial()
        ),
        grantsScholarshipsWorkStudyForLivingExpenses: z.number().gte(0),
        taxableGrantsScholarshipsWorkStudy: z.number().gte(0),
      })
      .partial()
      .optional(),
    resources: z
      .object({
        hasResources: z.boolean(),
        financialResources: z.array(
          z
            .object({
              personName: z.string().max(200),
              resourceType: z.enum([
                "cash_on_hand",
                "checking_account",
                "savings_account",
                "stocks",
                "bonds",
                "mutual_funds",
                "401k",
                "ira",
                "trusts",
                "cds",
                "annuities",
                "college_funds",
                "pass_accounts",
                "idas",
                "promissory_notes",
                "education_accounts",
                "other",
              ]),
              financialInstitutionName: z.string().max(200),
              accountNumber: z.string().max(100),
              currentValue: z.number().gte(0),
            })
            .partial()
        ),
        hasVehicles: z.boolean(),
        vehicles: z.array(
          z
            .object({
              personName: z.string().max(200),
              year: z.number().int().gte(1900),
              make: z.string().max(100),
              model: z.string().max(100),
              currentValue: z.number().gte(0),
            })
            .partial()
        ),
        hasLifeOrBurialInsurance: z.boolean(),
        lifeOrBurialInsurance: z.array(
          z
            .object({
              personName: z.string().max(200),
              policyType: z.enum(["life_insurance", "burial_insurance"]),
              company: z.string().max(200),
              policyNumber: z.string().max(100),
              revocableOrIrrevocable: z.enum(["revocable", "irrevocable"]),
              policyValue: z.number().gte(0),
            })
            .partial()
        ),
        ownsProperty: z.boolean(),
        property: z.array(
          z
            .object({
              personName: z.string().max(200),
              propertyType: z.string().max(200),
              propertyAddress: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
              primaryPropertyUse: z.array(
                z.enum([
                  "primary_home",
                  "rental_income",
                  "business_self_employment",
                  "other",
                ])
              ),
              primaryPropertyUseOther: z.string().max(200),
              currentValue: z.number().gte(0),
            })
            .partial()
        ),
        hasTransferredAssets: z.boolean(),
        transferredAssets: z.array(
          z
            .object({
              personName: z.string().max(200),
              dateOfTransfer: z.string(),
              assetDescription: z.string().max(500),
              amountReceived: z.number().gte(0),
              fairMarketValue: z.number().gte(0),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    priorConvictions: z
      .object({
        convictedOfDuplicateSNAPBenefits: z.boolean(),
        duplicateSNAPBenefitsWho: z.array(z.string().max(200)),
        hidingFromLaw: z.boolean(),
        hidingFromLawWho: z.array(z.string().max(200)),
        convictedOfDrugFelony: z.boolean(),
        drugFelonyWho: z.array(z.string().max(200)),
        convictedOfSNAPTrafficking: z.boolean(),
        snapTraffickingWho: z.array(z.string().max(200)),
        convictedOfTradingSNAPForWeapons: z.boolean(),
        tradingSNAPForWeaponsWho: z.array(z.string().max(200)),
        disqualifiedForIPVOrWelfareFraud: z.boolean(),
        ipvOrWelfareFraudWho: z.array(z.string().max(200)),
        convictedOfViolentCrime: z.boolean(),
        violentCrimeWho: z.array(z.string().max(200)),
      })
      .partial()
      .optional(),
    hasMilitaryService: z.boolean().optional(),
    militaryServiceMembers: z.array(z.string().max(200)).optional(),
    burialPreference: z
      .enum(["cremation", "burial", "no_preference"])
      .optional(),
    retroactiveMedicalCoverage: z
      .object({
        wantsRetroactiveCoverage: z.boolean(),
        requests: z.array(
          z
            .object({
              who: z.string().max(200),
              months: z.array(z.string()),
              householdIncomeInThoseMonths: z.number().gte(0),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    taxFiler: z
      .object({
        taxFilers: z.array(
          z
            .object({
              name: z.string().max(200),
              willFileTaxes: z.boolean(),
              filingJointlyWithSpouse: z.boolean(),
              spouseName: z.string().max(200),
              willClaimDependents: z.boolean(),
              dependentsToClaim: z.array(z.string().max(200)),
              expectsToBeClaimedAsDependent: z.boolean(),
              isClaimedAsDependent: z.boolean(),
              nameOfPersonClaiming: z.string().max(200),
              isPersonClaimingListedOnApplication: z.boolean(),
              isPersonClaimingNonCustodialParent: z.boolean(),
              marriedFilingSeparatelyWithExceptionalCircumstances: z.boolean(),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    healthInsurance: z
      .object({
        hasHealthInsurance: z.boolean(),
        coverageDetails: z.array(
          z
            .object({
              personName: z.string().max(200),
              typeOfCoverage: z.enum([
                "medicare",
                "tricare",
                "va_health_care",
                "peace_corps",
                "cobra",
                "retiree_health_plan",
                "current_employer_sponsored",
                "railroad_retirement_insurance",
              ]),
              coverageStartDate: z.string(),
              coverageEndDate: z.string(),
              enrollmentStatus: z.enum(["eligible", "enrolled"]),
            })
            .partial()
        ),
        federalHealthBenefitPrograms: z.array(
          z
            .object({
              programTypeOrName: z.string().max(200),
              whoIsEnrolled: z.string().max(200),
              insuranceCompanyName: z.string().max(200),
              policyNumber: z.string().max(100),
            })
            .partial()
        ),
        employerSponsoredCoverage: z.array(
          z
            .object({
              employerName: z.string().max(200),
              employerIdentificationNumber: z.string().max(50),
              employerAddress: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
              employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
              contactAboutCoverage: z.string().max(200),
              coverageStartDate: z.string(),
              coverageEndDate: z.string(),
              whoElseHadAccess: z.string().max(200),
              whoElseWasEnrolled: z.string().max(200),
              premiumAmount: z.number().gte(0),
              premiumAmountUnknown: z.boolean(),
              premiumFrequency: z.enum([
                "weekly",
                "every_two_weeks",
                "twice_monthly",
                "monthly",
                "yearly",
              ]),
              hasEmployeeOnlyPlanMeetingMinimumValue: z.boolean(),
              lowestCostPlanName: z.string().max(200),
              lowestCostPlanUnknown: z.boolean(),
              noPlansMeetMinimumValue: z.boolean(),
            })
            .partial()
        ),
        medicare: z.array(
          z
            .object({
              personName: z.string().max(200),
              partA: z
                .object({
                  isEntitledOrReceiving: z.boolean(),
                  startDate: z.string(),
                  isCurrentlyEnrolled: z.boolean(),
                  whoPaysPremium: z.string().max(200),
                  isPremiumFree: z.boolean(),
                })
                .partial(),
              partB: z
                .object({
                  isEntitledOrReceiving: z.boolean(),
                  startDate: z.string(),
                  premiumAmount: z.number().gte(0),
                  whoPaysPremium: z.string().max(200),
                })
                .partial(),
              partC: z
                .object({
                  isEntitledOrReceiving: z.boolean(),
                  startDate: z.string(),
                })
                .partial(),
              partD: z
                .object({
                  isEntitledOrReceiving: z.boolean(),
                  startDate: z.string(),
                  premiumAmount: z.number().gte(0),
                  whoPaysPremium: z.string().max(200),
                })
                .partial(),
            })
            .partial()
        ),
        hasLegalClaim: z.boolean(),
        legalClaimNames: z.array(z.string().max(200)),
        wantsSeparateMail: z.boolean(),
        separateMailAddresses: z.array(
          z
            .object({
              name: z.string().max(200),
              address: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    expectedIncomeChange: z
      .object({
        doesIncomeChangeFromMonthToMonth: z.boolean(),
        changes: z.array(
          z
            .object({
              name: z.string().max(200),
              annualIncome: z.number().gte(0),
              employerName: z.string().max(200),
              willAnnualIncomeBeSameOrLowerNextYear: z.boolean(),
            })
            .partial()
        ),
      })
      .partial()
      .optional(),
    reasonsForIncomeDifferences: z
      .object({
        incomeDifferences: z.array(
          z
            .object({
              name: z.string().max(200),
              whatHappened: z.enum([
                "stopped_working_job",
                "hours_changed_at_job",
                "change_in_employment",
                "married_legal_separation_or_divorce",
                "other",
              ]),
            })
            .partial()
        ),
        hasJobOrNonJobRelatedDeductions: z.boolean(),
        deductionsChangeMonthToMonth: z.boolean(),
        deductions: z.array(
          z
            .object({
              deductionType: z.string().max(200),
              frequency: z.enum([
                "one_time_only",
                "weekly",
                "every_two_weeks",
                "twice_monthly",
                "monthly",
                "yearly",
              ]),
              currentAmount: z.number().gte(0),
              actualAnnualAmount: z.number().gte(0),
            })
            .partial()
        ),
        hasPastIncomeAndDeductions: z.boolean(),
        pastIncomeAmount: z.number().gte(0),
        pastDeductionsAmount: z.number().gte(0),
      })
      .partial()
      .optional(),
    americanIndianOrAlaskaNativeInformation: z
      .object({
        isAnyoneAmericanIndianOrAlaskaNative: z.boolean(),
        members: z.array(
          z
            .object({
              name: z.string().max(200),
              tribeName: z.string().max(200),
              tribeState: z.string().max(100),
              typeOfIncomeReceived: z.string().max(200),
              frequencyAndAmount: z.string().max(200),
            })
            .partial()
        ),
        hasAnyoneReceivedServiceFromIndianHealthService: z.boolean(),
        whoReceivedService: z.array(z.string().max(200)),
        isAnyoneEligibleForIndianHealthService: z.boolean(),
        whoIsEligible: z.array(z.string().max(200)),
      })
      .partial()
      .optional(),
    permissionToValidateIncome: z
      .object({ doesNotGivePermissionToValidateIncome: z.boolean() })
      .partial()
      .optional(),
    authorizedRepresentativeForMedicalAssistance: z
      .object({
        isIndividual: z.boolean(),
        name: z.string().max(200),
        organizationId: z.string().max(50),
        address: z.object({
          addressLine1: z.string().min(1).max(150),
          addressLine2: z.string().max(150).optional(),
          city: z.string().min(1).max(100),
          stateProvince: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          county: z.string().max(100).optional(),
        }),
        inCareOf: z.string().max(200),
        phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
        email: z.string().max(320).email(),
        receiveNotices: z.boolean(),
        applicantSignature: z.object({
          signature: z.string(),
          signatureDate: z.string(),
        }),
        authorizedRepresentativeSignature: z.object({
          signature: z.string(),
          signatureDate: z.string(),
        }),
      })
      .partial()
      .optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .and(z.object({}).partial().passthrough());

export const schemas = {
  createApplication_Body,
  updateApplication_Body,
};

const endpoints = makeApi([
  {
    method: "get",
    path: "/applications",
    alias: "listApplications",
    description: `Retrieve a paginated list of applications.`,
    requestFormat: "json",
    parameters: [
      {
        name: "limit",
        type: "Query",
        schema: z.number().int().gte(1).lte(100).optional().default(25),
      },
      {
        name: "offset",
        type: "Query",
        schema: z.number().int().gte(0).optional().default(0),
      },
      {
        name: "status",
        type: "Query",
        schema: z
          .enum([
            "draft",
            "submitted",
            "under_review",
            "approved",
            "denied",
            "pending_information",
            "withdrawn",
          ])
          .optional(),
      },
      {
        name: "programs",
        type: "Query",
        schema: z
          .array(z.enum(["snap", "cash_programs", "medical_assistance"]))
          .optional(),
      },
    ],
    response: z.object({
      items: z.array(
        z.object({
          id: z.string().uuid(),
          state: z
            .string()
            .regex(/^[A-Z]{2}$/)
            .optional(),
          status: z
            .enum([
              "draft",
              "submitted",
              "under_review",
              "approved",
              "denied",
              "pending_information",
              "withdrawn",
            ])
            .optional(),
          programs: z
            .object({
              snap: z.boolean(),
              cashPrograms: z
                .object({
                  tanfProgram: z.boolean(),
                  adultFinancial: z.boolean(),
                })
                .partial(),
              medicalAssistance: z.boolean(),
            })
            .partial()
            .and(z.object({}).partial().passthrough()),
          applicantInfo: z
            .object({
              applicantName: z.object({
                firstName: z.string().min(1).max(100),
                middleInitial: z.string().max(1).optional(),
                middleName: z.string().max(100).optional(),
                lastName: z.string().min(1).max(100),
                maidenName: z.string().max(100).optional(),
              }),
              socialSecurityNumber: z.string().regex(/^\d{3}-\d{2}-\d{4}$/),
              dateOfBirth: z.string(),
              signature: z
                .object({
                  applicantSignature: z.object({
                    signature: z.string(),
                    signatureDate: z.string(),
                  }),
                  spouseCoApplicantSignature: z.object({
                    signature: z.string(),
                    signatureDate: z.string(),
                  }),
                  applicantAuthorizedRepresentativeSignature: z.object({
                    signature: z.string(),
                    signatureDate: z.string(),
                  }),
                  coApplicantAuthorizedRepresentativeSignature: z.object({
                    signature: z.string(),
                    signatureDate: z.string(),
                  }),
                })
                .partial(),
              homeAddress: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
              mailingAddress: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
              phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
              otherPhoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
              email: z.string().max(320).email(),
              speaksEnglish: z.boolean(),
              preferredLanguage: z
                .string()
                .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/),
              isHomeless: z.boolean(),
              isStateResident: z.boolean(),
              preferredNoticeMethod: z.enum(["paper", "email", "both"]),
              personWhoHelpedCompleteApplication: z
                .object({
                  name: z.string().max(200),
                  address: z.object({
                    addressLine1: z.string().min(1).max(150),
                    addressLine2: z.string().max(150).optional(),
                    city: z.string().min(1).max(100),
                    stateProvince: z.string().min(1).max(100),
                    postalCode: z.string().min(3).max(20),
                    county: z.string().max(100).optional(),
                  }),
                  phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                })
                .partial(),
            })
            .partial(),
          householdDemographics: z
            .object({
              householdMembers: z
                .array(
                  z.object({
                    name: z.object({
                      firstName: z.string().min(1).max(100),
                      middleInitial: z.string().max(1).optional(),
                      middleName: z.string().max(100).optional(),
                      lastName: z.string().min(1).max(100),
                      maidenName: z.string().max(100).optional(),
                    }),
                    relationship: z.enum([
                      "self",
                      "spouse",
                      "child",
                      "parent",
                      "sibling",
                      "other_relative",
                      "non_relative",
                    ]),
                    dateOfBirth: z.string(),
                    socialSecurityNumber: z
                      .string()
                      .regex(/^\d{3}-\d{2}-\d{4}$/)
                      .optional(),
                    isUSCitizen: z.boolean().optional(),
                    citizenshipCertificateNumber: z.string().max(50).optional(),
                    gender: z.enum(["male", "female", "unknown"]).optional(),
                    maritalStatus: z
                      .enum([
                        "single",
                        "married",
                        "divorced",
                        "separated",
                        "widowed",
                        "civil_union",
                        "domestic_partnership",
                      ])
                      .optional(),
                    isHispanicOrLatino: z.boolean().optional(),
                    race: z
                      .array(
                        z.enum([
                          "american_indian_alaskan_native",
                          "asian",
                          "black_african_american",
                          "native_hawaiian_pacific_islander",
                          "white",
                        ])
                      )
                      .optional(),
                    programsApplyingFor: z
                      .object({
                        snap: z.boolean(),
                        cashPrograms: z
                          .object({
                            tanfProgram: z.boolean(),
                            adultFinancial: z.boolean(),
                          })
                          .partial(),
                        medicalAssistance: z.boolean(),
                      })
                      .partial()
                      .and(z.object({ notApplying: z.boolean() }).partial())
                      .optional(),
                  })
                )
                .min(1),
              roomersOrBoarders: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    rentAmount: z.number().gte(0),
                    mealsIncluded: z.boolean(),
                  })
                  .partial()
              ),
              institutionalizedMembers: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    dateEntered: z.string(),
                    facilityName: z.string().max(200),
                    facilityType: z.enum([
                      "nursing_home",
                      "hospital",
                      "mental_health_institution",
                      "incarceration",
                      "other",
                    ]),
                    isPendingDisposition: z.boolean(),
                    mealsProvided: z.boolean(),
                  })
                  .partial()
              ),
            })
            .partial(),
          expeditedSNAPDetails: z
            .object({
              householdSize: z.number().int().gte(1),
              isMigrantOrSeasonalFarmWorker: z.boolean(),
              totalExpectedIncomeThisMonth: z.number().gte(0),
              totalCashOnHand: z.number().gte(0),
              monthlyMortgage: z.number().gte(0),
              monthlyRent: z.number().gte(0),
              utilityCosts: z
                .object({
                  electricity: z.number().gte(0),
                  water: z.number().gte(0),
                  phone: z.number().gte(0),
                  trash: z.number().gte(0),
                  sewer: z.number().gte(0),
                  other: z.number().gte(0),
                })
                .partial(),
              receivedBenefitsOtherState: z.boolean(),
            })
            .partial()
            .optional(),
          ebtCard: z
            .object({
              needsEBTCard: z.boolean(),
              ebtCardDeliveryMethod: z.enum(["postal_mail", "in_person"]),
            })
            .partial()
            .optional(),
          voterRegistration: z
            .object({ wantsToRegister: z.boolean() })
            .partial()
            .optional(),
          dependentChildren: z
            .object({
              livesWithChildUnder19: z.boolean(),
              hasParentOutsideHome: z.boolean(),
              triedToGetMedicalSupport: z.boolean(),
              absentParents: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    address: z.object({
                      addressLine1: z.string().min(1).max(150),
                      addressLine2: z.string().max(150).optional(),
                      city: z.string().min(1).max(100),
                      stateProvince: z.string().min(1).max(100),
                      postalCode: z.string().min(3).max(20),
                      county: z.string().max(100).optional(),
                    }),
                    phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                    forWhichChild: z.string().max(200),
                  })
                  .partial()
              ),
              wantsGoodCauseFromChildSupport: z.boolean(),
            })
            .partial()
            .optional(),
          fosterCare: z
            .object({
              hasFosterCareHistory: z.boolean(),
              members: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    currentAge: z.number().int().gte(0),
                    datesInFosterCare: z.string().max(200),
                    ageWhenLeft: z.number().int().gte(0),
                  })
                  .partial()
              ),
              formerFosterCareMedicalAssistance: z
                .object({
                  receivedFormerFosterCareMedicalAssistance: z.boolean(),
                  name: z.string().max(200),
                  stateLivedInWhenAgedOut: z.string().max(2),
                  nameUsedInOutOfStateFosterCare: z.string().max(200),
                  dateLeftFosterCare: z.string(),
                  wereAdopted: z.boolean(),
                  returnedToFosterCareAfterAdoption: z.boolean(),
                  residencyDate: z.string(),
                  needsHelpPayingMedicalBills: z.boolean(),
                  medicalBillsHelpWhen: z.string(),
                  medicalBillsHelpMonths: z.array(z.string()),
                })
                .partial(),
            })
            .partial()
            .optional(),
          familyPlanning: z
            .object({
              wantsFamilyPlanningBenefits: z.boolean(),
              names: z.array(z.string().max(200)),
            })
            .partial()
            .optional(),
          pregnancy: z
            .object({
              isAnyonePregnant: z.boolean(),
              pregnancies: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    dueDate: z.string(),
                    numberOfBabiesExpected: z.number().int().gte(1),
                    fatherName: z.string().max(200),
                    wantsGoodCauseFromChildSupport: z.boolean(),
                  })
                  .partial()
              ),
            })
            .partial()
            .optional(),
          disability: z
            .object({
              hasDisability: z.boolean(),
              disabledMembers: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    needsHelpWithSelfCare: z.boolean(),
                    hasMedicalOrDevelopmentalCondition: z.boolean(),
                  })
                  .partial()
              ),
              socialSecurityApplications: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    program: z.enum(["SSI", "SSDI", "other"]),
                    otherProgramName: z.string().max(200),
                    applicationDate: z.string(),
                    status: z.enum([
                      "pending",
                      "approved",
                      "denied",
                      "appealed",
                    ]),
                  })
                  .partial()
              ),
              everReceivedSSIOrSSDI: z.boolean(),
              ssiOrSsdiEndDate: z.string(),
            })
            .partial()
            .optional(),
          nonCitizen: z
            .object({
              wantsEmergencyMedicaidAndReproductiveBenefits: z.boolean(),
              emergencyMedicaidApplicants: z.array(z.string().max(200)),
              hasNonCitizens: z.boolean(),
              nonCitizens: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    status: z.string().max(100),
                    documentType: z.string().max(100),
                    documentNumber: z.string().max(100),
                    alienOrI94Number: z.string().max(100),
                    documentExpirationDate: z.string(),
                    countryOfIssuance: z.string().max(100),
                    livedInUSSince1996: z.boolean(),
                    spouseOrParentIsVeteranOrActiveDuty: z.boolean(),
                    hasSponsor: z.boolean(),
                    sponsor: z
                      .object({
                        hasBeenAbandonedMistreatedOrAbused: z.boolean(),
                        isPregnantOr20OrYounger: z.boolean(),
                        sponsorName: z.string().max(200),
                        sponsorSpouseName: z.string().max(200),
                        sponsorSocialSecurityNumber: z
                          .string()
                          .regex(/^\d{3}-\d{2}-\d{4}$/),
                        sponsorAddress: z.object({
                          addressLine1: z.string().min(1).max(150),
                          addressLine2: z.string().max(150).optional(),
                          city: z.string().min(1).max(100),
                          stateProvince: z.string().min(1).max(100),
                          postalCode: z.string().min(3).max(20),
                          county: z.string().max(100).optional(),
                        }),
                        sponsorSpouseSocialSecurityNumber: z
                          .string()
                          .regex(/^\d{3}-\d{2}-\d{4}$/),
                        totalPeopleInSponsorHousehold: z.number().int().gte(1),
                        doesSponsoredIndividualLiveWithSponsor: z.boolean(),
                        doesSponsoredIndividualReceiveFreeRoomAndBoard:
                          z.boolean(),
                        doesSponsoredIndividualReceiveSupportFromSponsor:
                          z.boolean(),
                      })
                      .partial(),
                  })
                  .partial()
              ),
            })
            .partial()
            .optional(),
          earnedIncome: z
            .object({
              hasEmployment: z.boolean(),
              jobs: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    employerName: z.string().max(200),
                    employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                    monthlyWagesBeforeTaxes: z.number().gte(0),
                    hourlyWage: z.number().gte(0),
                    averageHoursPerWeek: z.number().gte(0).lte(168),
                    payFrequency: z.enum([
                      "hourly",
                      "weekly",
                      "every_two_weeks",
                      "twice_monthly",
                      "monthly",
                      "yearly",
                      "daily",
                    ]),
                    isTemporaryJob: z.boolean(),
                    incomeType: z.enum([
                      "seasonal_employment",
                      "commission_based_employment",
                      "regular_employment",
                    ]),
                  })
                  .partial()
              ),
              hasSelfEmployment: z.boolean(),
              selfEmployment: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    businessName: z.string().max(200),
                    oneMonthsGrossIncome: z.number().gte(0),
                    monthOfIncome: z.string(),
                    selfEmploymentType: z.enum([
                      "sole_proprietor",
                      "llc",
                      "s_corp",
                      "independent_contractor",
                    ]),
                    utilitiesPaidForBusiness: z.number().gte(0),
                    businessTaxesPaid: z.number().gte(0),
                    interestPaidForBusiness: z.number().gte(0),
                    grossBusinessLaborCosts: z.number().gte(0),
                    costOfMerchandise: z.number().gte(0),
                    otherBusinessCosts: z.array(
                      z
                        .object({
                          type: z.string().max(200),
                          amount: z.number().gte(0),
                        })
                        .partial()
                    ),
                    totalNetIncome: z.number(),
                  })
                  .partial()
              ),
              hasJobChanges: z.boolean(),
              jobChanges: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    employerName: z.string().max(200),
                    employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                    startDate: z.string(),
                    endDate: z.string(),
                    monthlyWagesBeforeTaxes: z.number().gte(0),
                    lastPaycheckDate: z.string(),
                    lastPaycheckAmount: z.number().gte(0),
                    payFrequency: z.enum([
                      "hourly",
                      "weekly",
                      "every_two_weeks",
                      "twice_monthly",
                      "monthly",
                      "yearly",
                    ]),
                  })
                  .partial()
              ),
            })
            .partial()
            .optional(),
          unearnedIncome: z
            .object({
              hasOtherIncome: z.boolean(),
              incomeSources: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    incomeType: z.enum([
                      "unemployment_benefits",
                      "SSI",
                      "veterans_benefits",
                      "widow_benefits",
                      "workers_comp",
                      "railroad_retirement",
                      "child_support",
                      "survivors_benefits",
                      "dividends_interest",
                      "rental_income",
                      "money_from_boarder",
                      "disability_benefits",
                      "retirement_pension",
                      "SSDI",
                      "alimony",
                      "in_kind_income",
                      "social_security_benefits",
                      "public_assistance",
                      "plasma_donations",
                      "gifts",
                      "loans",
                      "foster_care_payments",
                      "tribal_benefits",
                      "other",
                    ]),
                    monthlyAmount: z.number().gte(0),
                  })
                  .partial()
              ),
              hasLumpSumPayments: z.boolean(),
              lumpSumPayments: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    dateReceived: z.string(),
                    type: z.enum([
                      "lawsuit_settlement",
                      "insurance_settlement",
                      "social_security_ssi_ssdi_payment",
                      "veterans",
                      "inheritance",
                      "surrender_of_annuity",
                      "life_insurance_payout",
                      "lottery_gambling_winnings",
                      "other",
                    ]),
                    amount: z.number().gte(0),
                  })
                  .partial()
              ),
              isAnyoneOnStrike: z.boolean(),
              strikeInformation: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    strikeBeginDate: z.string(),
                    lastPaycheckDate: z.string(),
                    lastPaycheckAmount: z.number().gte(0),
                  })
                  .partial()
              ),
            })
            .partial()
            .optional(),
          expenses: z
            .object({
              rent: z
                .object({
                  hasRentExpenses: z.boolean(),
                  rentExpenses: z.array(
                    z
                      .object({
                        expenseType: z.enum([
                          "rent",
                          "renters_insurance",
                          "pet_fee",
                          "washer_dryer_fee",
                          "condo_fee",
                          "maintenance_fee",
                          "other",
                        ]),
                        whoPays: z.string().max(200),
                        isPersonInHome: z.boolean(),
                        whoIsExpenseFor: z.string().max(200),
                        expenseMonth: z.string(),
                        amountPaid: z.number().gte(0),
                      })
                      .partial()
                  ),
                  utilitiesIncludedInRent: z.boolean(),
                  receivesSection8OrPublicHousing: z.boolean(),
                  housingAssistanceType: z.enum(["section8", "public_housing"]),
                })
                .partial(),
              mortgage: z
                .object({
                  hasMortgageExpenses: z.boolean(),
                  mortgageExpenses: z.array(
                    z
                      .object({
                        expenseType: z.enum([
                          "mortgage",
                          "homeowners_insurance",
                          "property_taxes",
                          "hoa_fees",
                        ]),
                        whoPays: z.string().max(200),
                        isPersonInHome: z.boolean(),
                        whoIsExpenseFor: z.string().max(200),
                        expenseMonth: z.string(),
                        amountPaid: z.number().gte(0),
                      })
                      .partial()
                  ),
                  receivesSection8OrPublicHousing: z.boolean(),
                  housingAssistanceType: z.enum(["section8", "public_housing"]),
                })
                .partial(),
              utilities: z
                .object({
                  heatingCoolingMethod: z.array(
                    z.enum([
                      "electric",
                      "gas",
                      "firewood",
                      "propane",
                      "swamp_cooler",
                      "other",
                    ])
                  ),
                  otherHeatingCoolingType: z.string().max(100),
                  receivedLEAP: z.boolean(),
                })
                .partial(),
              additionalExpenses: z
                .object({
                  hasAdditionalExpenses: z.boolean(),
                  expenses: z.array(
                    z
                      .object({
                        expenseType: z.enum([
                          "child_daycare",
                          "adult_daycare",
                          "legally_obligated_child_support",
                          "child_support_arrears",
                          "medical_expenses",
                          "student_loan_interest",
                          "alimony",
                        ]),
                        whoPays: z.string().max(200),
                        isPersonInHome: z.boolean(),
                        whoIsExpenseFor: z.string().max(200),
                        monthOfExpense: z.string(),
                        amountPaid: z.number().gte(0),
                        legallyObligatedAmount: z.number().gte(0),
                      })
                      .partial()
                  ),
                })
                .partial(),
            })
            .partial()
            .optional(),
          students: z
            .object({
              hasStudents: z.boolean(),
              studentDetails: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    schoolName: z.string().max(200),
                    lastGradeCompleted: z.string().max(50),
                    startDate: z.string(),
                    expectedGraduationDate: z.string(),
                    isFullTimeStudent: z.boolean(),
                  })
                  .partial()
              ),
              hasFinancialAid: z.boolean(),
              financialAid: z.array(
                z.object({ personName: z.string().max(200) }).partial()
              ),
              grantsScholarshipsWorkStudyForLivingExpenses: z.number().gte(0),
              taxableGrantsScholarshipsWorkStudy: z.number().gte(0),
            })
            .partial()
            .optional(),
          resources: z
            .object({
              hasResources: z.boolean(),
              financialResources: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    resourceType: z.enum([
                      "cash_on_hand",
                      "checking_account",
                      "savings_account",
                      "stocks",
                      "bonds",
                      "mutual_funds",
                      "401k",
                      "ira",
                      "trusts",
                      "cds",
                      "annuities",
                      "college_funds",
                      "pass_accounts",
                      "idas",
                      "promissory_notes",
                      "education_accounts",
                      "other",
                    ]),
                    financialInstitutionName: z.string().max(200),
                    accountNumber: z.string().max(100),
                    currentValue: z.number().gte(0),
                  })
                  .partial()
              ),
              hasVehicles: z.boolean(),
              vehicles: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    year: z.number().int().gte(1900),
                    make: z.string().max(100),
                    model: z.string().max(100),
                    currentValue: z.number().gte(0),
                  })
                  .partial()
              ),
              hasLifeOrBurialInsurance: z.boolean(),
              lifeOrBurialInsurance: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    policyType: z.enum(["life_insurance", "burial_insurance"]),
                    company: z.string().max(200),
                    policyNumber: z.string().max(100),
                    revocableOrIrrevocable: z.enum([
                      "revocable",
                      "irrevocable",
                    ]),
                    policyValue: z.number().gte(0),
                  })
                  .partial()
              ),
              ownsProperty: z.boolean(),
              property: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    propertyType: z.string().max(200),
                    propertyAddress: z.object({
                      addressLine1: z.string().min(1).max(150),
                      addressLine2: z.string().max(150).optional(),
                      city: z.string().min(1).max(100),
                      stateProvince: z.string().min(1).max(100),
                      postalCode: z.string().min(3).max(20),
                      county: z.string().max(100).optional(),
                    }),
                    primaryPropertyUse: z.array(
                      z.enum([
                        "primary_home",
                        "rental_income",
                        "business_self_employment",
                        "other",
                      ])
                    ),
                    primaryPropertyUseOther: z.string().max(200),
                    currentValue: z.number().gte(0),
                  })
                  .partial()
              ),
              hasTransferredAssets: z.boolean(),
              transferredAssets: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    dateOfTransfer: z.string(),
                    assetDescription: z.string().max(500),
                    amountReceived: z.number().gte(0),
                    fairMarketValue: z.number().gte(0),
                  })
                  .partial()
              ),
            })
            .partial()
            .optional(),
          priorConvictions: z
            .object({
              convictedOfDuplicateSNAPBenefits: z.boolean(),
              duplicateSNAPBenefitsWho: z.array(z.string().max(200)),
              hidingFromLaw: z.boolean(),
              hidingFromLawWho: z.array(z.string().max(200)),
              convictedOfDrugFelony: z.boolean(),
              drugFelonyWho: z.array(z.string().max(200)),
              convictedOfSNAPTrafficking: z.boolean(),
              snapTraffickingWho: z.array(z.string().max(200)),
              convictedOfTradingSNAPForWeapons: z.boolean(),
              tradingSNAPForWeaponsWho: z.array(z.string().max(200)),
              disqualifiedForIPVOrWelfareFraud: z.boolean(),
              ipvOrWelfareFraudWho: z.array(z.string().max(200)),
              convictedOfViolentCrime: z.boolean(),
              violentCrimeWho: z.array(z.string().max(200)),
            })
            .partial()
            .optional(),
          hasMilitaryService: z.boolean().optional(),
          militaryServiceMembers: z.array(z.string().max(200)).optional(),
          burialPreference: z
            .enum(["cremation", "burial", "no_preference"])
            .optional(),
          retroactiveMedicalCoverage: z
            .object({
              wantsRetroactiveCoverage: z.boolean(),
              requests: z.array(
                z
                  .object({
                    who: z.string().max(200),
                    months: z.array(z.string()),
                    householdIncomeInThoseMonths: z.number().gte(0),
                  })
                  .partial()
              ),
            })
            .partial()
            .optional(),
          taxFiler: z
            .object({
              taxFilers: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    willFileTaxes: z.boolean(),
                    filingJointlyWithSpouse: z.boolean(),
                    spouseName: z.string().max(200),
                    willClaimDependents: z.boolean(),
                    dependentsToClaim: z.array(z.string().max(200)),
                    expectsToBeClaimedAsDependent: z.boolean(),
                    isClaimedAsDependent: z.boolean(),
                    nameOfPersonClaiming: z.string().max(200),
                    isPersonClaimingListedOnApplication: z.boolean(),
                    isPersonClaimingNonCustodialParent: z.boolean(),
                    marriedFilingSeparatelyWithExceptionalCircumstances:
                      z.boolean(),
                  })
                  .partial()
              ),
            })
            .partial()
            .optional(),
          healthInsurance: z
            .object({
              hasHealthInsurance: z.boolean(),
              coverageDetails: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    typeOfCoverage: z.enum([
                      "medicare",
                      "tricare",
                      "va_health_care",
                      "peace_corps",
                      "cobra",
                      "retiree_health_plan",
                      "current_employer_sponsored",
                      "railroad_retirement_insurance",
                    ]),
                    coverageStartDate: z.string(),
                    coverageEndDate: z.string(),
                    enrollmentStatus: z.enum(["eligible", "enrolled"]),
                  })
                  .partial()
              ),
              federalHealthBenefitPrograms: z.array(
                z
                  .object({
                    programTypeOrName: z.string().max(200),
                    whoIsEnrolled: z.string().max(200),
                    insuranceCompanyName: z.string().max(200),
                    policyNumber: z.string().max(100),
                  })
                  .partial()
              ),
              employerSponsoredCoverage: z.array(
                z
                  .object({
                    employerName: z.string().max(200),
                    employerIdentificationNumber: z.string().max(50),
                    employerAddress: z.object({
                      addressLine1: z.string().min(1).max(150),
                      addressLine2: z.string().max(150).optional(),
                      city: z.string().min(1).max(100),
                      stateProvince: z.string().min(1).max(100),
                      postalCode: z.string().min(3).max(20),
                      county: z.string().max(100).optional(),
                    }),
                    employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                    contactAboutCoverage: z.string().max(200),
                    coverageStartDate: z.string(),
                    coverageEndDate: z.string(),
                    whoElseHadAccess: z.string().max(200),
                    whoElseWasEnrolled: z.string().max(200),
                    premiumAmount: z.number().gte(0),
                    premiumAmountUnknown: z.boolean(),
                    premiumFrequency: z.enum([
                      "weekly",
                      "every_two_weeks",
                      "twice_monthly",
                      "monthly",
                      "yearly",
                    ]),
                    hasEmployeeOnlyPlanMeetingMinimumValue: z.boolean(),
                    lowestCostPlanName: z.string().max(200),
                    lowestCostPlanUnknown: z.boolean(),
                    noPlansMeetMinimumValue: z.boolean(),
                  })
                  .partial()
              ),
              medicare: z.array(
                z
                  .object({
                    personName: z.string().max(200),
                    partA: z
                      .object({
                        isEntitledOrReceiving: z.boolean(),
                        startDate: z.string(),
                        isCurrentlyEnrolled: z.boolean(),
                        whoPaysPremium: z.string().max(200),
                        isPremiumFree: z.boolean(),
                      })
                      .partial(),
                    partB: z
                      .object({
                        isEntitledOrReceiving: z.boolean(),
                        startDate: z.string(),
                        premiumAmount: z.number().gte(0),
                        whoPaysPremium: z.string().max(200),
                      })
                      .partial(),
                    partC: z
                      .object({
                        isEntitledOrReceiving: z.boolean(),
                        startDate: z.string(),
                      })
                      .partial(),
                    partD: z
                      .object({
                        isEntitledOrReceiving: z.boolean(),
                        startDate: z.string(),
                        premiumAmount: z.number().gte(0),
                        whoPaysPremium: z.string().max(200),
                      })
                      .partial(),
                  })
                  .partial()
              ),
              hasLegalClaim: z.boolean(),
              legalClaimNames: z.array(z.string().max(200)),
              wantsSeparateMail: z.boolean(),
              separateMailAddresses: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    address: z.object({
                      addressLine1: z.string().min(1).max(150),
                      addressLine2: z.string().max(150).optional(),
                      city: z.string().min(1).max(100),
                      stateProvince: z.string().min(1).max(100),
                      postalCode: z.string().min(3).max(20),
                      county: z.string().max(100).optional(),
                    }),
                  })
                  .partial()
              ),
            })
            .partial()
            .optional(),
          expectedIncomeChange: z
            .object({
              doesIncomeChangeFromMonthToMonth: z.boolean(),
              changes: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    annualIncome: z.number().gte(0),
                    employerName: z.string().max(200),
                    willAnnualIncomeBeSameOrLowerNextYear: z.boolean(),
                  })
                  .partial()
              ),
            })
            .partial()
            .optional(),
          reasonsForIncomeDifferences: z
            .object({
              incomeDifferences: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    whatHappened: z.enum([
                      "stopped_working_job",
                      "hours_changed_at_job",
                      "change_in_employment",
                      "married_legal_separation_or_divorce",
                      "other",
                    ]),
                  })
                  .partial()
              ),
              hasJobOrNonJobRelatedDeductions: z.boolean(),
              deductionsChangeMonthToMonth: z.boolean(),
              deductions: z.array(
                z
                  .object({
                    deductionType: z.string().max(200),
                    frequency: z.enum([
                      "one_time_only",
                      "weekly",
                      "every_two_weeks",
                      "twice_monthly",
                      "monthly",
                      "yearly",
                    ]),
                    currentAmount: z.number().gte(0),
                    actualAnnualAmount: z.number().gte(0),
                  })
                  .partial()
              ),
              hasPastIncomeAndDeductions: z.boolean(),
              pastIncomeAmount: z.number().gte(0),
              pastDeductionsAmount: z.number().gte(0),
            })
            .partial()
            .optional(),
          americanIndianOrAlaskaNativeInformation: z
            .object({
              isAnyoneAmericanIndianOrAlaskaNative: z.boolean(),
              members: z.array(
                z
                  .object({
                    name: z.string().max(200),
                    tribeName: z.string().max(200),
                    tribeState: z.string().max(100),
                    typeOfIncomeReceived: z.string().max(200),
                    frequencyAndAmount: z.string().max(200),
                  })
                  .partial()
              ),
              hasAnyoneReceivedServiceFromIndianHealthService: z.boolean(),
              whoReceivedService: z.array(z.string().max(200)),
              isAnyoneEligibleForIndianHealthService: z.boolean(),
              whoIsEligible: z.array(z.string().max(200)),
            })
            .partial()
            .optional(),
          permissionToValidateIncome: z
            .object({ doesNotGivePermissionToValidateIncome: z.boolean() })
            .partial()
            .optional(),
          authorizedRepresentativeForMedicalAssistance: z
            .object({
              isIndividual: z.boolean(),
              name: z.string().max(200),
              organizationId: z.string().max(50),
              address: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
              inCareOf: z.string().max(200),
              phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
              email: z.string().max(320).email(),
              receiveNotices: z.boolean(),
              applicantSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
              authorizedRepresentativeSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
            })
            .partial()
            .optional(),
          createdAt: z.string().datetime({ offset: true }),
          updatedAt: z.string().datetime({ offset: true }),
        })
      ),
      total: z.number().int().gte(0),
      limit: z.number().int().gte(1).lte(100),
      offset: z.number().int().gte(0),
      hasNext: z.boolean().optional(),
    }),
    errors: [
      {
        status: 400,
        description: `The request is malformed or contains invalid parameters.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
      {
        status: 500,
        description: `An unexpected error occurred on the server.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
    ],
  },
  {
    method: "post",
    path: "/applications",
    alias: "createApplication",
    description: `Create a new public assistance application.`,
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: createApplication_Body,
      },
    ],
    response: z.object({
      id: z.string().uuid(),
      state: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
      status: z
        .enum([
          "draft",
          "submitted",
          "under_review",
          "approved",
          "denied",
          "pending_information",
          "withdrawn",
        ])
        .optional(),
      programs: z
        .object({
          snap: z.boolean(),
          cashPrograms: z
            .object({ tanfProgram: z.boolean(), adultFinancial: z.boolean() })
            .partial(),
          medicalAssistance: z.boolean(),
        })
        .partial()
        .and(z.object({}).partial().passthrough()),
      applicantInfo: z
        .object({
          applicantName: z.object({
            firstName: z.string().min(1).max(100),
            middleInitial: z.string().max(1).optional(),
            middleName: z.string().max(100).optional(),
            lastName: z.string().min(1).max(100),
            maidenName: z.string().max(100).optional(),
          }),
          socialSecurityNumber: z.string().regex(/^\d{3}-\d{2}-\d{4}$/),
          dateOfBirth: z.string(),
          signature: z
            .object({
              applicantSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
              spouseCoApplicantSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
              applicantAuthorizedRepresentativeSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
              coApplicantAuthorizedRepresentativeSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
            })
            .partial(),
          homeAddress: z.object({
            addressLine1: z.string().min(1).max(150),
            addressLine2: z.string().max(150).optional(),
            city: z.string().min(1).max(100),
            stateProvince: z.string().min(1).max(100),
            postalCode: z.string().min(3).max(20),
            county: z.string().max(100).optional(),
          }),
          mailingAddress: z.object({
            addressLine1: z.string().min(1).max(150),
            addressLine2: z.string().max(150).optional(),
            city: z.string().min(1).max(100),
            stateProvince: z.string().min(1).max(100),
            postalCode: z.string().min(3).max(20),
            county: z.string().max(100).optional(),
          }),
          phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
          otherPhoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
          email: z.string().max(320).email(),
          speaksEnglish: z.boolean(),
          preferredLanguage: z
            .string()
            .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/),
          isHomeless: z.boolean(),
          isStateResident: z.boolean(),
          preferredNoticeMethod: z.enum(["paper", "email", "both"]),
          personWhoHelpedCompleteApplication: z
            .object({
              name: z.string().max(200),
              address: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
              phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
            })
            .partial(),
        })
        .partial(),
      householdDemographics: z
        .object({
          householdMembers: z
            .array(
              z.object({
                name: z.object({
                  firstName: z.string().min(1).max(100),
                  middleInitial: z.string().max(1).optional(),
                  middleName: z.string().max(100).optional(),
                  lastName: z.string().min(1).max(100),
                  maidenName: z.string().max(100).optional(),
                }),
                relationship: z.enum([
                  "self",
                  "spouse",
                  "child",
                  "parent",
                  "sibling",
                  "other_relative",
                  "non_relative",
                ]),
                dateOfBirth: z.string(),
                socialSecurityNumber: z
                  .string()
                  .regex(/^\d{3}-\d{2}-\d{4}$/)
                  .optional(),
                isUSCitizen: z.boolean().optional(),
                citizenshipCertificateNumber: z.string().max(50).optional(),
                gender: z.enum(["male", "female", "unknown"]).optional(),
                maritalStatus: z
                  .enum([
                    "single",
                    "married",
                    "divorced",
                    "separated",
                    "widowed",
                    "civil_union",
                    "domestic_partnership",
                  ])
                  .optional(),
                isHispanicOrLatino: z.boolean().optional(),
                race: z
                  .array(
                    z.enum([
                      "american_indian_alaskan_native",
                      "asian",
                      "black_african_american",
                      "native_hawaiian_pacific_islander",
                      "white",
                    ])
                  )
                  .optional(),
                programsApplyingFor: z
                  .object({
                    snap: z.boolean(),
                    cashPrograms: z
                      .object({
                        tanfProgram: z.boolean(),
                        adultFinancial: z.boolean(),
                      })
                      .partial(),
                    medicalAssistance: z.boolean(),
                  })
                  .partial()
                  .and(z.object({ notApplying: z.boolean() }).partial())
                  .optional(),
              })
            )
            .min(1),
          roomersOrBoarders: z.array(
            z
              .object({
                name: z.string().max(200),
                rentAmount: z.number().gte(0),
                mealsIncluded: z.boolean(),
              })
              .partial()
          ),
          institutionalizedMembers: z.array(
            z
              .object({
                name: z.string().max(200),
                dateEntered: z.string(),
                facilityName: z.string().max(200),
                facilityType: z.enum([
                  "nursing_home",
                  "hospital",
                  "mental_health_institution",
                  "incarceration",
                  "other",
                ]),
                isPendingDisposition: z.boolean(),
                mealsProvided: z.boolean(),
              })
              .partial()
          ),
        })
        .partial(),
      expeditedSNAPDetails: z
        .object({
          householdSize: z.number().int().gte(1),
          isMigrantOrSeasonalFarmWorker: z.boolean(),
          totalExpectedIncomeThisMonth: z.number().gte(0),
          totalCashOnHand: z.number().gte(0),
          monthlyMortgage: z.number().gte(0),
          monthlyRent: z.number().gte(0),
          utilityCosts: z
            .object({
              electricity: z.number().gte(0),
              water: z.number().gte(0),
              phone: z.number().gte(0),
              trash: z.number().gte(0),
              sewer: z.number().gte(0),
              other: z.number().gte(0),
            })
            .partial(),
          receivedBenefitsOtherState: z.boolean(),
        })
        .partial()
        .optional(),
      ebtCard: z
        .object({
          needsEBTCard: z.boolean(),
          ebtCardDeliveryMethod: z.enum(["postal_mail", "in_person"]),
        })
        .partial()
        .optional(),
      voterRegistration: z
        .object({ wantsToRegister: z.boolean() })
        .partial()
        .optional(),
      dependentChildren: z
        .object({
          livesWithChildUnder19: z.boolean(),
          hasParentOutsideHome: z.boolean(),
          triedToGetMedicalSupport: z.boolean(),
          absentParents: z.array(
            z
              .object({
                name: z.string().max(200),
                address: z.object({
                  addressLine1: z.string().min(1).max(150),
                  addressLine2: z.string().max(150).optional(),
                  city: z.string().min(1).max(100),
                  stateProvince: z.string().min(1).max(100),
                  postalCode: z.string().min(3).max(20),
                  county: z.string().max(100).optional(),
                }),
                phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                forWhichChild: z.string().max(200),
              })
              .partial()
          ),
          wantsGoodCauseFromChildSupport: z.boolean(),
        })
        .partial()
        .optional(),
      fosterCare: z
        .object({
          hasFosterCareHistory: z.boolean(),
          members: z.array(
            z
              .object({
                name: z.string().max(200),
                currentAge: z.number().int().gte(0),
                datesInFosterCare: z.string().max(200),
                ageWhenLeft: z.number().int().gte(0),
              })
              .partial()
          ),
          formerFosterCareMedicalAssistance: z
            .object({
              receivedFormerFosterCareMedicalAssistance: z.boolean(),
              name: z.string().max(200),
              stateLivedInWhenAgedOut: z.string().max(2),
              nameUsedInOutOfStateFosterCare: z.string().max(200),
              dateLeftFosterCare: z.string(),
              wereAdopted: z.boolean(),
              returnedToFosterCareAfterAdoption: z.boolean(),
              residencyDate: z.string(),
              needsHelpPayingMedicalBills: z.boolean(),
              medicalBillsHelpWhen: z.string(),
              medicalBillsHelpMonths: z.array(z.string()),
            })
            .partial(),
        })
        .partial()
        .optional(),
      familyPlanning: z
        .object({
          wantsFamilyPlanningBenefits: z.boolean(),
          names: z.array(z.string().max(200)),
        })
        .partial()
        .optional(),
      pregnancy: z
        .object({
          isAnyonePregnant: z.boolean(),
          pregnancies: z.array(
            z
              .object({
                name: z.string().max(200),
                dueDate: z.string(),
                numberOfBabiesExpected: z.number().int().gte(1),
                fatherName: z.string().max(200),
                wantsGoodCauseFromChildSupport: z.boolean(),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      disability: z
        .object({
          hasDisability: z.boolean(),
          disabledMembers: z.array(
            z
              .object({
                name: z.string().max(200),
                needsHelpWithSelfCare: z.boolean(),
                hasMedicalOrDevelopmentalCondition: z.boolean(),
              })
              .partial()
          ),
          socialSecurityApplications: z.array(
            z
              .object({
                name: z.string().max(200),
                program: z.enum(["SSI", "SSDI", "other"]),
                otherProgramName: z.string().max(200),
                applicationDate: z.string(),
                status: z.enum(["pending", "approved", "denied", "appealed"]),
              })
              .partial()
          ),
          everReceivedSSIOrSSDI: z.boolean(),
          ssiOrSsdiEndDate: z.string(),
        })
        .partial()
        .optional(),
      nonCitizen: z
        .object({
          wantsEmergencyMedicaidAndReproductiveBenefits: z.boolean(),
          emergencyMedicaidApplicants: z.array(z.string().max(200)),
          hasNonCitizens: z.boolean(),
          nonCitizens: z.array(
            z
              .object({
                name: z.string().max(200),
                status: z.string().max(100),
                documentType: z.string().max(100),
                documentNumber: z.string().max(100),
                alienOrI94Number: z.string().max(100),
                documentExpirationDate: z.string(),
                countryOfIssuance: z.string().max(100),
                livedInUSSince1996: z.boolean(),
                spouseOrParentIsVeteranOrActiveDuty: z.boolean(),
                hasSponsor: z.boolean(),
                sponsor: z
                  .object({
                    hasBeenAbandonedMistreatedOrAbused: z.boolean(),
                    isPregnantOr20OrYounger: z.boolean(),
                    sponsorName: z.string().max(200),
                    sponsorSpouseName: z.string().max(200),
                    sponsorSocialSecurityNumber: z
                      .string()
                      .regex(/^\d{3}-\d{2}-\d{4}$/),
                    sponsorAddress: z.object({
                      addressLine1: z.string().min(1).max(150),
                      addressLine2: z.string().max(150).optional(),
                      city: z.string().min(1).max(100),
                      stateProvince: z.string().min(1).max(100),
                      postalCode: z.string().min(3).max(20),
                      county: z.string().max(100).optional(),
                    }),
                    sponsorSpouseSocialSecurityNumber: z
                      .string()
                      .regex(/^\d{3}-\d{2}-\d{4}$/),
                    totalPeopleInSponsorHousehold: z.number().int().gte(1),
                    doesSponsoredIndividualLiveWithSponsor: z.boolean(),
                    doesSponsoredIndividualReceiveFreeRoomAndBoard: z.boolean(),
                    doesSponsoredIndividualReceiveSupportFromSponsor:
                      z.boolean(),
                  })
                  .partial(),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      earnedIncome: z
        .object({
          hasEmployment: z.boolean(),
          jobs: z.array(
            z
              .object({
                personName: z.string().max(200),
                employerName: z.string().max(200),
                employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                monthlyWagesBeforeTaxes: z.number().gte(0),
                hourlyWage: z.number().gte(0),
                averageHoursPerWeek: z.number().gte(0).lte(168),
                payFrequency: z.enum([
                  "hourly",
                  "weekly",
                  "every_two_weeks",
                  "twice_monthly",
                  "monthly",
                  "yearly",
                  "daily",
                ]),
                isTemporaryJob: z.boolean(),
                incomeType: z.enum([
                  "seasonal_employment",
                  "commission_based_employment",
                  "regular_employment",
                ]),
              })
              .partial()
          ),
          hasSelfEmployment: z.boolean(),
          selfEmployment: z.array(
            z
              .object({
                personName: z.string().max(200),
                businessName: z.string().max(200),
                oneMonthsGrossIncome: z.number().gte(0),
                monthOfIncome: z.string(),
                selfEmploymentType: z.enum([
                  "sole_proprietor",
                  "llc",
                  "s_corp",
                  "independent_contractor",
                ]),
                utilitiesPaidForBusiness: z.number().gte(0),
                businessTaxesPaid: z.number().gte(0),
                interestPaidForBusiness: z.number().gte(0),
                grossBusinessLaborCosts: z.number().gte(0),
                costOfMerchandise: z.number().gte(0),
                otherBusinessCosts: z.array(
                  z
                    .object({
                      type: z.string().max(200),
                      amount: z.number().gte(0),
                    })
                    .partial()
                ),
                totalNetIncome: z.number(),
              })
              .partial()
          ),
          hasJobChanges: z.boolean(),
          jobChanges: z.array(
            z
              .object({
                personName: z.string().max(200),
                employerName: z.string().max(200),
                employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                startDate: z.string(),
                endDate: z.string(),
                monthlyWagesBeforeTaxes: z.number().gte(0),
                lastPaycheckDate: z.string(),
                lastPaycheckAmount: z.number().gte(0),
                payFrequency: z.enum([
                  "hourly",
                  "weekly",
                  "every_two_weeks",
                  "twice_monthly",
                  "monthly",
                  "yearly",
                ]),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      unearnedIncome: z
        .object({
          hasOtherIncome: z.boolean(),
          incomeSources: z.array(
            z
              .object({
                personName: z.string().max(200),
                incomeType: z.enum([
                  "unemployment_benefits",
                  "SSI",
                  "veterans_benefits",
                  "widow_benefits",
                  "workers_comp",
                  "railroad_retirement",
                  "child_support",
                  "survivors_benefits",
                  "dividends_interest",
                  "rental_income",
                  "money_from_boarder",
                  "disability_benefits",
                  "retirement_pension",
                  "SSDI",
                  "alimony",
                  "in_kind_income",
                  "social_security_benefits",
                  "public_assistance",
                  "plasma_donations",
                  "gifts",
                  "loans",
                  "foster_care_payments",
                  "tribal_benefits",
                  "other",
                ]),
                monthlyAmount: z.number().gte(0),
              })
              .partial()
          ),
          hasLumpSumPayments: z.boolean(),
          lumpSumPayments: z.array(
            z
              .object({
                personName: z.string().max(200),
                dateReceived: z.string(),
                type: z.enum([
                  "lawsuit_settlement",
                  "insurance_settlement",
                  "social_security_ssi_ssdi_payment",
                  "veterans",
                  "inheritance",
                  "surrender_of_annuity",
                  "life_insurance_payout",
                  "lottery_gambling_winnings",
                  "other",
                ]),
                amount: z.number().gte(0),
              })
              .partial()
          ),
          isAnyoneOnStrike: z.boolean(),
          strikeInformation: z.array(
            z
              .object({
                personName: z.string().max(200),
                strikeBeginDate: z.string(),
                lastPaycheckDate: z.string(),
                lastPaycheckAmount: z.number().gte(0),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      expenses: z
        .object({
          rent: z
            .object({
              hasRentExpenses: z.boolean(),
              rentExpenses: z.array(
                z
                  .object({
                    expenseType: z.enum([
                      "rent",
                      "renters_insurance",
                      "pet_fee",
                      "washer_dryer_fee",
                      "condo_fee",
                      "maintenance_fee",
                      "other",
                    ]),
                    whoPays: z.string().max(200),
                    isPersonInHome: z.boolean(),
                    whoIsExpenseFor: z.string().max(200),
                    expenseMonth: z.string(),
                    amountPaid: z.number().gte(0),
                  })
                  .partial()
              ),
              utilitiesIncludedInRent: z.boolean(),
              receivesSection8OrPublicHousing: z.boolean(),
              housingAssistanceType: z.enum(["section8", "public_housing"]),
            })
            .partial(),
          mortgage: z
            .object({
              hasMortgageExpenses: z.boolean(),
              mortgageExpenses: z.array(
                z
                  .object({
                    expenseType: z.enum([
                      "mortgage",
                      "homeowners_insurance",
                      "property_taxes",
                      "hoa_fees",
                    ]),
                    whoPays: z.string().max(200),
                    isPersonInHome: z.boolean(),
                    whoIsExpenseFor: z.string().max(200),
                    expenseMonth: z.string(),
                    amountPaid: z.number().gte(0),
                  })
                  .partial()
              ),
              receivesSection8OrPublicHousing: z.boolean(),
              housingAssistanceType: z.enum(["section8", "public_housing"]),
            })
            .partial(),
          utilities: z
            .object({
              heatingCoolingMethod: z.array(
                z.enum([
                  "electric",
                  "gas",
                  "firewood",
                  "propane",
                  "swamp_cooler",
                  "other",
                ])
              ),
              otherHeatingCoolingType: z.string().max(100),
              receivedLEAP: z.boolean(),
            })
            .partial(),
          additionalExpenses: z
            .object({
              hasAdditionalExpenses: z.boolean(),
              expenses: z.array(
                z
                  .object({
                    expenseType: z.enum([
                      "child_daycare",
                      "adult_daycare",
                      "legally_obligated_child_support",
                      "child_support_arrears",
                      "medical_expenses",
                      "student_loan_interest",
                      "alimony",
                    ]),
                    whoPays: z.string().max(200),
                    isPersonInHome: z.boolean(),
                    whoIsExpenseFor: z.string().max(200),
                    monthOfExpense: z.string(),
                    amountPaid: z.number().gte(0),
                    legallyObligatedAmount: z.number().gte(0),
                  })
                  .partial()
              ),
            })
            .partial(),
        })
        .partial()
        .optional(),
      students: z
        .object({
          hasStudents: z.boolean(),
          studentDetails: z.array(
            z
              .object({
                name: z.string().max(200),
                schoolName: z.string().max(200),
                lastGradeCompleted: z.string().max(50),
                startDate: z.string(),
                expectedGraduationDate: z.string(),
                isFullTimeStudent: z.boolean(),
              })
              .partial()
          ),
          hasFinancialAid: z.boolean(),
          financialAid: z.array(
            z.object({ personName: z.string().max(200) }).partial()
          ),
          grantsScholarshipsWorkStudyForLivingExpenses: z.number().gte(0),
          taxableGrantsScholarshipsWorkStudy: z.number().gte(0),
        })
        .partial()
        .optional(),
      resources: z
        .object({
          hasResources: z.boolean(),
          financialResources: z.array(
            z
              .object({
                personName: z.string().max(200),
                resourceType: z.enum([
                  "cash_on_hand",
                  "checking_account",
                  "savings_account",
                  "stocks",
                  "bonds",
                  "mutual_funds",
                  "401k",
                  "ira",
                  "trusts",
                  "cds",
                  "annuities",
                  "college_funds",
                  "pass_accounts",
                  "idas",
                  "promissory_notes",
                  "education_accounts",
                  "other",
                ]),
                financialInstitutionName: z.string().max(200),
                accountNumber: z.string().max(100),
                currentValue: z.number().gte(0),
              })
              .partial()
          ),
          hasVehicles: z.boolean(),
          vehicles: z.array(
            z
              .object({
                personName: z.string().max(200),
                year: z.number().int().gte(1900),
                make: z.string().max(100),
                model: z.string().max(100),
                currentValue: z.number().gte(0),
              })
              .partial()
          ),
          hasLifeOrBurialInsurance: z.boolean(),
          lifeOrBurialInsurance: z.array(
            z
              .object({
                personName: z.string().max(200),
                policyType: z.enum(["life_insurance", "burial_insurance"]),
                company: z.string().max(200),
                policyNumber: z.string().max(100),
                revocableOrIrrevocable: z.enum(["revocable", "irrevocable"]),
                policyValue: z.number().gte(0),
              })
              .partial()
          ),
          ownsProperty: z.boolean(),
          property: z.array(
            z
              .object({
                personName: z.string().max(200),
                propertyType: z.string().max(200),
                propertyAddress: z.object({
                  addressLine1: z.string().min(1).max(150),
                  addressLine2: z.string().max(150).optional(),
                  city: z.string().min(1).max(100),
                  stateProvince: z.string().min(1).max(100),
                  postalCode: z.string().min(3).max(20),
                  county: z.string().max(100).optional(),
                }),
                primaryPropertyUse: z.array(
                  z.enum([
                    "primary_home",
                    "rental_income",
                    "business_self_employment",
                    "other",
                  ])
                ),
                primaryPropertyUseOther: z.string().max(200),
                currentValue: z.number().gte(0),
              })
              .partial()
          ),
          hasTransferredAssets: z.boolean(),
          transferredAssets: z.array(
            z
              .object({
                personName: z.string().max(200),
                dateOfTransfer: z.string(),
                assetDescription: z.string().max(500),
                amountReceived: z.number().gte(0),
                fairMarketValue: z.number().gte(0),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      priorConvictions: z
        .object({
          convictedOfDuplicateSNAPBenefits: z.boolean(),
          duplicateSNAPBenefitsWho: z.array(z.string().max(200)),
          hidingFromLaw: z.boolean(),
          hidingFromLawWho: z.array(z.string().max(200)),
          convictedOfDrugFelony: z.boolean(),
          drugFelonyWho: z.array(z.string().max(200)),
          convictedOfSNAPTrafficking: z.boolean(),
          snapTraffickingWho: z.array(z.string().max(200)),
          convictedOfTradingSNAPForWeapons: z.boolean(),
          tradingSNAPForWeaponsWho: z.array(z.string().max(200)),
          disqualifiedForIPVOrWelfareFraud: z.boolean(),
          ipvOrWelfareFraudWho: z.array(z.string().max(200)),
          convictedOfViolentCrime: z.boolean(),
          violentCrimeWho: z.array(z.string().max(200)),
        })
        .partial()
        .optional(),
      hasMilitaryService: z.boolean().optional(),
      militaryServiceMembers: z.array(z.string().max(200)).optional(),
      burialPreference: z
        .enum(["cremation", "burial", "no_preference"])
        .optional(),
      retroactiveMedicalCoverage: z
        .object({
          wantsRetroactiveCoverage: z.boolean(),
          requests: z.array(
            z
              .object({
                who: z.string().max(200),
                months: z.array(z.string()),
                householdIncomeInThoseMonths: z.number().gte(0),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      taxFiler: z
        .object({
          taxFilers: z.array(
            z
              .object({
                name: z.string().max(200),
                willFileTaxes: z.boolean(),
                filingJointlyWithSpouse: z.boolean(),
                spouseName: z.string().max(200),
                willClaimDependents: z.boolean(),
                dependentsToClaim: z.array(z.string().max(200)),
                expectsToBeClaimedAsDependent: z.boolean(),
                isClaimedAsDependent: z.boolean(),
                nameOfPersonClaiming: z.string().max(200),
                isPersonClaimingListedOnApplication: z.boolean(),
                isPersonClaimingNonCustodialParent: z.boolean(),
                marriedFilingSeparatelyWithExceptionalCircumstances:
                  z.boolean(),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      healthInsurance: z
        .object({
          hasHealthInsurance: z.boolean(),
          coverageDetails: z.array(
            z
              .object({
                personName: z.string().max(200),
                typeOfCoverage: z.enum([
                  "medicare",
                  "tricare",
                  "va_health_care",
                  "peace_corps",
                  "cobra",
                  "retiree_health_plan",
                  "current_employer_sponsored",
                  "railroad_retirement_insurance",
                ]),
                coverageStartDate: z.string(),
                coverageEndDate: z.string(),
                enrollmentStatus: z.enum(["eligible", "enrolled"]),
              })
              .partial()
          ),
          federalHealthBenefitPrograms: z.array(
            z
              .object({
                programTypeOrName: z.string().max(200),
                whoIsEnrolled: z.string().max(200),
                insuranceCompanyName: z.string().max(200),
                policyNumber: z.string().max(100),
              })
              .partial()
          ),
          employerSponsoredCoverage: z.array(
            z
              .object({
                employerName: z.string().max(200),
                employerIdentificationNumber: z.string().max(50),
                employerAddress: z.object({
                  addressLine1: z.string().min(1).max(150),
                  addressLine2: z.string().max(150).optional(),
                  city: z.string().min(1).max(100),
                  stateProvince: z.string().min(1).max(100),
                  postalCode: z.string().min(3).max(20),
                  county: z.string().max(100).optional(),
                }),
                employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                contactAboutCoverage: z.string().max(200),
                coverageStartDate: z.string(),
                coverageEndDate: z.string(),
                whoElseHadAccess: z.string().max(200),
                whoElseWasEnrolled: z.string().max(200),
                premiumAmount: z.number().gte(0),
                premiumAmountUnknown: z.boolean(),
                premiumFrequency: z.enum([
                  "weekly",
                  "every_two_weeks",
                  "twice_monthly",
                  "monthly",
                  "yearly",
                ]),
                hasEmployeeOnlyPlanMeetingMinimumValue: z.boolean(),
                lowestCostPlanName: z.string().max(200),
                lowestCostPlanUnknown: z.boolean(),
                noPlansMeetMinimumValue: z.boolean(),
              })
              .partial()
          ),
          medicare: z.array(
            z
              .object({
                personName: z.string().max(200),
                partA: z
                  .object({
                    isEntitledOrReceiving: z.boolean(),
                    startDate: z.string(),
                    isCurrentlyEnrolled: z.boolean(),
                    whoPaysPremium: z.string().max(200),
                    isPremiumFree: z.boolean(),
                  })
                  .partial(),
                partB: z
                  .object({
                    isEntitledOrReceiving: z.boolean(),
                    startDate: z.string(),
                    premiumAmount: z.number().gte(0),
                    whoPaysPremium: z.string().max(200),
                  })
                  .partial(),
                partC: z
                  .object({
                    isEntitledOrReceiving: z.boolean(),
                    startDate: z.string(),
                  })
                  .partial(),
                partD: z
                  .object({
                    isEntitledOrReceiving: z.boolean(),
                    startDate: z.string(),
                    premiumAmount: z.number().gte(0),
                    whoPaysPremium: z.string().max(200),
                  })
                  .partial(),
              })
              .partial()
          ),
          hasLegalClaim: z.boolean(),
          legalClaimNames: z.array(z.string().max(200)),
          wantsSeparateMail: z.boolean(),
          separateMailAddresses: z.array(
            z
              .object({
                name: z.string().max(200),
                address: z.object({
                  addressLine1: z.string().min(1).max(150),
                  addressLine2: z.string().max(150).optional(),
                  city: z.string().min(1).max(100),
                  stateProvince: z.string().min(1).max(100),
                  postalCode: z.string().min(3).max(20),
                  county: z.string().max(100).optional(),
                }),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      expectedIncomeChange: z
        .object({
          doesIncomeChangeFromMonthToMonth: z.boolean(),
          changes: z.array(
            z
              .object({
                name: z.string().max(200),
                annualIncome: z.number().gte(0),
                employerName: z.string().max(200),
                willAnnualIncomeBeSameOrLowerNextYear: z.boolean(),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      reasonsForIncomeDifferences: z
        .object({
          incomeDifferences: z.array(
            z
              .object({
                name: z.string().max(200),
                whatHappened: z.enum([
                  "stopped_working_job",
                  "hours_changed_at_job",
                  "change_in_employment",
                  "married_legal_separation_or_divorce",
                  "other",
                ]),
              })
              .partial()
          ),
          hasJobOrNonJobRelatedDeductions: z.boolean(),
          deductionsChangeMonthToMonth: z.boolean(),
          deductions: z.array(
            z
              .object({
                deductionType: z.string().max(200),
                frequency: z.enum([
                  "one_time_only",
                  "weekly",
                  "every_two_weeks",
                  "twice_monthly",
                  "monthly",
                  "yearly",
                ]),
                currentAmount: z.number().gte(0),
                actualAnnualAmount: z.number().gte(0),
              })
              .partial()
          ),
          hasPastIncomeAndDeductions: z.boolean(),
          pastIncomeAmount: z.number().gte(0),
          pastDeductionsAmount: z.number().gte(0),
        })
        .partial()
        .optional(),
      americanIndianOrAlaskaNativeInformation: z
        .object({
          isAnyoneAmericanIndianOrAlaskaNative: z.boolean(),
          members: z.array(
            z
              .object({
                name: z.string().max(200),
                tribeName: z.string().max(200),
                tribeState: z.string().max(100),
                typeOfIncomeReceived: z.string().max(200),
                frequencyAndAmount: z.string().max(200),
              })
              .partial()
          ),
          hasAnyoneReceivedServiceFromIndianHealthService: z.boolean(),
          whoReceivedService: z.array(z.string().max(200)),
          isAnyoneEligibleForIndianHealthService: z.boolean(),
          whoIsEligible: z.array(z.string().max(200)),
        })
        .partial()
        .optional(),
      permissionToValidateIncome: z
        .object({ doesNotGivePermissionToValidateIncome: z.boolean() })
        .partial()
        .optional(),
      authorizedRepresentativeForMedicalAssistance: z
        .object({
          isIndividual: z.boolean(),
          name: z.string().max(200),
          organizationId: z.string().max(50),
          address: z.object({
            addressLine1: z.string().min(1).max(150),
            addressLine2: z.string().max(150).optional(),
            city: z.string().min(1).max(100),
            stateProvince: z.string().min(1).max(100),
            postalCode: z.string().min(3).max(20),
            county: z.string().max(100).optional(),
          }),
          inCareOf: z.string().max(200),
          phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
          email: z.string().max(320).email(),
          receiveNotices: z.boolean(),
          applicantSignature: z.object({
            signature: z.string(),
            signatureDate: z.string(),
          }),
          authorizedRepresentativeSignature: z.object({
            signature: z.string(),
            signatureDate: z.string(),
          }),
        })
        .partial()
        .optional(),
      createdAt: z.string().datetime({ offset: true }),
      updatedAt: z.string().datetime({ offset: true }),
    }),
    errors: [
      {
        status: 400,
        description: `The request is malformed or contains invalid parameters.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
      {
        status: 422,
        description: `The request was well-formed but contained semantic errors.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
      {
        status: 500,
        description: `An unexpected error occurred on the server.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
    ],
  },
  {
    method: "get",
    path: "/applications/:applicationId",
    alias: "getApplication",
    description: `Retrieve a single application by identifier.`,
    requestFormat: "json",
    parameters: [
      {
        name: "applicationId",
        type: "Path",
        schema: z.string().uuid(),
      },
    ],
    response: z.object({
      id: z.string().uuid(),
      state: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
      status: z
        .enum([
          "draft",
          "submitted",
          "under_review",
          "approved",
          "denied",
          "pending_information",
          "withdrawn",
        ])
        .optional(),
      programs: z
        .object({
          snap: z.boolean(),
          cashPrograms: z
            .object({ tanfProgram: z.boolean(), adultFinancial: z.boolean() })
            .partial(),
          medicalAssistance: z.boolean(),
        })
        .partial()
        .and(z.object({}).partial().passthrough()),
      applicantInfo: z
        .object({
          applicantName: z.object({
            firstName: z.string().min(1).max(100),
            middleInitial: z.string().max(1).optional(),
            middleName: z.string().max(100).optional(),
            lastName: z.string().min(1).max(100),
            maidenName: z.string().max(100).optional(),
          }),
          socialSecurityNumber: z.string().regex(/^\d{3}-\d{2}-\d{4}$/),
          dateOfBirth: z.string(),
          signature: z
            .object({
              applicantSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
              spouseCoApplicantSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
              applicantAuthorizedRepresentativeSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
              coApplicantAuthorizedRepresentativeSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
            })
            .partial(),
          homeAddress: z.object({
            addressLine1: z.string().min(1).max(150),
            addressLine2: z.string().max(150).optional(),
            city: z.string().min(1).max(100),
            stateProvince: z.string().min(1).max(100),
            postalCode: z.string().min(3).max(20),
            county: z.string().max(100).optional(),
          }),
          mailingAddress: z.object({
            addressLine1: z.string().min(1).max(150),
            addressLine2: z.string().max(150).optional(),
            city: z.string().min(1).max(100),
            stateProvince: z.string().min(1).max(100),
            postalCode: z.string().min(3).max(20),
            county: z.string().max(100).optional(),
          }),
          phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
          otherPhoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
          email: z.string().max(320).email(),
          speaksEnglish: z.boolean(),
          preferredLanguage: z
            .string()
            .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/),
          isHomeless: z.boolean(),
          isStateResident: z.boolean(),
          preferredNoticeMethod: z.enum(["paper", "email", "both"]),
          personWhoHelpedCompleteApplication: z
            .object({
              name: z.string().max(200),
              address: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
              phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
            })
            .partial(),
        })
        .partial(),
      householdDemographics: z
        .object({
          householdMembers: z
            .array(
              z.object({
                name: z.object({
                  firstName: z.string().min(1).max(100),
                  middleInitial: z.string().max(1).optional(),
                  middleName: z.string().max(100).optional(),
                  lastName: z.string().min(1).max(100),
                  maidenName: z.string().max(100).optional(),
                }),
                relationship: z.enum([
                  "self",
                  "spouse",
                  "child",
                  "parent",
                  "sibling",
                  "other_relative",
                  "non_relative",
                ]),
                dateOfBirth: z.string(),
                socialSecurityNumber: z
                  .string()
                  .regex(/^\d{3}-\d{2}-\d{4}$/)
                  .optional(),
                isUSCitizen: z.boolean().optional(),
                citizenshipCertificateNumber: z.string().max(50).optional(),
                gender: z.enum(["male", "female", "unknown"]).optional(),
                maritalStatus: z
                  .enum([
                    "single",
                    "married",
                    "divorced",
                    "separated",
                    "widowed",
                    "civil_union",
                    "domestic_partnership",
                  ])
                  .optional(),
                isHispanicOrLatino: z.boolean().optional(),
                race: z
                  .array(
                    z.enum([
                      "american_indian_alaskan_native",
                      "asian",
                      "black_african_american",
                      "native_hawaiian_pacific_islander",
                      "white",
                    ])
                  )
                  .optional(),
                programsApplyingFor: z
                  .object({
                    snap: z.boolean(),
                    cashPrograms: z
                      .object({
                        tanfProgram: z.boolean(),
                        adultFinancial: z.boolean(),
                      })
                      .partial(),
                    medicalAssistance: z.boolean(),
                  })
                  .partial()
                  .and(z.object({ notApplying: z.boolean() }).partial())
                  .optional(),
              })
            )
            .min(1),
          roomersOrBoarders: z.array(
            z
              .object({
                name: z.string().max(200),
                rentAmount: z.number().gte(0),
                mealsIncluded: z.boolean(),
              })
              .partial()
          ),
          institutionalizedMembers: z.array(
            z
              .object({
                name: z.string().max(200),
                dateEntered: z.string(),
                facilityName: z.string().max(200),
                facilityType: z.enum([
                  "nursing_home",
                  "hospital",
                  "mental_health_institution",
                  "incarceration",
                  "other",
                ]),
                isPendingDisposition: z.boolean(),
                mealsProvided: z.boolean(),
              })
              .partial()
          ),
        })
        .partial(),
      expeditedSNAPDetails: z
        .object({
          householdSize: z.number().int().gte(1),
          isMigrantOrSeasonalFarmWorker: z.boolean(),
          totalExpectedIncomeThisMonth: z.number().gte(0),
          totalCashOnHand: z.number().gte(0),
          monthlyMortgage: z.number().gte(0),
          monthlyRent: z.number().gte(0),
          utilityCosts: z
            .object({
              electricity: z.number().gte(0),
              water: z.number().gte(0),
              phone: z.number().gte(0),
              trash: z.number().gte(0),
              sewer: z.number().gte(0),
              other: z.number().gte(0),
            })
            .partial(),
          receivedBenefitsOtherState: z.boolean(),
        })
        .partial()
        .optional(),
      ebtCard: z
        .object({
          needsEBTCard: z.boolean(),
          ebtCardDeliveryMethod: z.enum(["postal_mail", "in_person"]),
        })
        .partial()
        .optional(),
      voterRegistration: z
        .object({ wantsToRegister: z.boolean() })
        .partial()
        .optional(),
      dependentChildren: z
        .object({
          livesWithChildUnder19: z.boolean(),
          hasParentOutsideHome: z.boolean(),
          triedToGetMedicalSupport: z.boolean(),
          absentParents: z.array(
            z
              .object({
                name: z.string().max(200),
                address: z.object({
                  addressLine1: z.string().min(1).max(150),
                  addressLine2: z.string().max(150).optional(),
                  city: z.string().min(1).max(100),
                  stateProvince: z.string().min(1).max(100),
                  postalCode: z.string().min(3).max(20),
                  county: z.string().max(100).optional(),
                }),
                phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                forWhichChild: z.string().max(200),
              })
              .partial()
          ),
          wantsGoodCauseFromChildSupport: z.boolean(),
        })
        .partial()
        .optional(),
      fosterCare: z
        .object({
          hasFosterCareHistory: z.boolean(),
          members: z.array(
            z
              .object({
                name: z.string().max(200),
                currentAge: z.number().int().gte(0),
                datesInFosterCare: z.string().max(200),
                ageWhenLeft: z.number().int().gte(0),
              })
              .partial()
          ),
          formerFosterCareMedicalAssistance: z
            .object({
              receivedFormerFosterCareMedicalAssistance: z.boolean(),
              name: z.string().max(200),
              stateLivedInWhenAgedOut: z.string().max(2),
              nameUsedInOutOfStateFosterCare: z.string().max(200),
              dateLeftFosterCare: z.string(),
              wereAdopted: z.boolean(),
              returnedToFosterCareAfterAdoption: z.boolean(),
              residencyDate: z.string(),
              needsHelpPayingMedicalBills: z.boolean(),
              medicalBillsHelpWhen: z.string(),
              medicalBillsHelpMonths: z.array(z.string()),
            })
            .partial(),
        })
        .partial()
        .optional(),
      familyPlanning: z
        .object({
          wantsFamilyPlanningBenefits: z.boolean(),
          names: z.array(z.string().max(200)),
        })
        .partial()
        .optional(),
      pregnancy: z
        .object({
          isAnyonePregnant: z.boolean(),
          pregnancies: z.array(
            z
              .object({
                name: z.string().max(200),
                dueDate: z.string(),
                numberOfBabiesExpected: z.number().int().gte(1),
                fatherName: z.string().max(200),
                wantsGoodCauseFromChildSupport: z.boolean(),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      disability: z
        .object({
          hasDisability: z.boolean(),
          disabledMembers: z.array(
            z
              .object({
                name: z.string().max(200),
                needsHelpWithSelfCare: z.boolean(),
                hasMedicalOrDevelopmentalCondition: z.boolean(),
              })
              .partial()
          ),
          socialSecurityApplications: z.array(
            z
              .object({
                name: z.string().max(200),
                program: z.enum(["SSI", "SSDI", "other"]),
                otherProgramName: z.string().max(200),
                applicationDate: z.string(),
                status: z.enum(["pending", "approved", "denied", "appealed"]),
              })
              .partial()
          ),
          everReceivedSSIOrSSDI: z.boolean(),
          ssiOrSsdiEndDate: z.string(),
        })
        .partial()
        .optional(),
      nonCitizen: z
        .object({
          wantsEmergencyMedicaidAndReproductiveBenefits: z.boolean(),
          emergencyMedicaidApplicants: z.array(z.string().max(200)),
          hasNonCitizens: z.boolean(),
          nonCitizens: z.array(
            z
              .object({
                name: z.string().max(200),
                status: z.string().max(100),
                documentType: z.string().max(100),
                documentNumber: z.string().max(100),
                alienOrI94Number: z.string().max(100),
                documentExpirationDate: z.string(),
                countryOfIssuance: z.string().max(100),
                livedInUSSince1996: z.boolean(),
                spouseOrParentIsVeteranOrActiveDuty: z.boolean(),
                hasSponsor: z.boolean(),
                sponsor: z
                  .object({
                    hasBeenAbandonedMistreatedOrAbused: z.boolean(),
                    isPregnantOr20OrYounger: z.boolean(),
                    sponsorName: z.string().max(200),
                    sponsorSpouseName: z.string().max(200),
                    sponsorSocialSecurityNumber: z
                      .string()
                      .regex(/^\d{3}-\d{2}-\d{4}$/),
                    sponsorAddress: z.object({
                      addressLine1: z.string().min(1).max(150),
                      addressLine2: z.string().max(150).optional(),
                      city: z.string().min(1).max(100),
                      stateProvince: z.string().min(1).max(100),
                      postalCode: z.string().min(3).max(20),
                      county: z.string().max(100).optional(),
                    }),
                    sponsorSpouseSocialSecurityNumber: z
                      .string()
                      .regex(/^\d{3}-\d{2}-\d{4}$/),
                    totalPeopleInSponsorHousehold: z.number().int().gte(1),
                    doesSponsoredIndividualLiveWithSponsor: z.boolean(),
                    doesSponsoredIndividualReceiveFreeRoomAndBoard: z.boolean(),
                    doesSponsoredIndividualReceiveSupportFromSponsor:
                      z.boolean(),
                  })
                  .partial(),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      earnedIncome: z
        .object({
          hasEmployment: z.boolean(),
          jobs: z.array(
            z
              .object({
                personName: z.string().max(200),
                employerName: z.string().max(200),
                employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                monthlyWagesBeforeTaxes: z.number().gte(0),
                hourlyWage: z.number().gte(0),
                averageHoursPerWeek: z.number().gte(0).lte(168),
                payFrequency: z.enum([
                  "hourly",
                  "weekly",
                  "every_two_weeks",
                  "twice_monthly",
                  "monthly",
                  "yearly",
                  "daily",
                ]),
                isTemporaryJob: z.boolean(),
                incomeType: z.enum([
                  "seasonal_employment",
                  "commission_based_employment",
                  "regular_employment",
                ]),
              })
              .partial()
          ),
          hasSelfEmployment: z.boolean(),
          selfEmployment: z.array(
            z
              .object({
                personName: z.string().max(200),
                businessName: z.string().max(200),
                oneMonthsGrossIncome: z.number().gte(0),
                monthOfIncome: z.string(),
                selfEmploymentType: z.enum([
                  "sole_proprietor",
                  "llc",
                  "s_corp",
                  "independent_contractor",
                ]),
                utilitiesPaidForBusiness: z.number().gte(0),
                businessTaxesPaid: z.number().gte(0),
                interestPaidForBusiness: z.number().gte(0),
                grossBusinessLaborCosts: z.number().gte(0),
                costOfMerchandise: z.number().gte(0),
                otherBusinessCosts: z.array(
                  z
                    .object({
                      type: z.string().max(200),
                      amount: z.number().gte(0),
                    })
                    .partial()
                ),
                totalNetIncome: z.number(),
              })
              .partial()
          ),
          hasJobChanges: z.boolean(),
          jobChanges: z.array(
            z
              .object({
                personName: z.string().max(200),
                employerName: z.string().max(200),
                employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                startDate: z.string(),
                endDate: z.string(),
                monthlyWagesBeforeTaxes: z.number().gte(0),
                lastPaycheckDate: z.string(),
                lastPaycheckAmount: z.number().gte(0),
                payFrequency: z.enum([
                  "hourly",
                  "weekly",
                  "every_two_weeks",
                  "twice_monthly",
                  "monthly",
                  "yearly",
                ]),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      unearnedIncome: z
        .object({
          hasOtherIncome: z.boolean(),
          incomeSources: z.array(
            z
              .object({
                personName: z.string().max(200),
                incomeType: z.enum([
                  "unemployment_benefits",
                  "SSI",
                  "veterans_benefits",
                  "widow_benefits",
                  "workers_comp",
                  "railroad_retirement",
                  "child_support",
                  "survivors_benefits",
                  "dividends_interest",
                  "rental_income",
                  "money_from_boarder",
                  "disability_benefits",
                  "retirement_pension",
                  "SSDI",
                  "alimony",
                  "in_kind_income",
                  "social_security_benefits",
                  "public_assistance",
                  "plasma_donations",
                  "gifts",
                  "loans",
                  "foster_care_payments",
                  "tribal_benefits",
                  "other",
                ]),
                monthlyAmount: z.number().gte(0),
              })
              .partial()
          ),
          hasLumpSumPayments: z.boolean(),
          lumpSumPayments: z.array(
            z
              .object({
                personName: z.string().max(200),
                dateReceived: z.string(),
                type: z.enum([
                  "lawsuit_settlement",
                  "insurance_settlement",
                  "social_security_ssi_ssdi_payment",
                  "veterans",
                  "inheritance",
                  "surrender_of_annuity",
                  "life_insurance_payout",
                  "lottery_gambling_winnings",
                  "other",
                ]),
                amount: z.number().gte(0),
              })
              .partial()
          ),
          isAnyoneOnStrike: z.boolean(),
          strikeInformation: z.array(
            z
              .object({
                personName: z.string().max(200),
                strikeBeginDate: z.string(),
                lastPaycheckDate: z.string(),
                lastPaycheckAmount: z.number().gte(0),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      expenses: z
        .object({
          rent: z
            .object({
              hasRentExpenses: z.boolean(),
              rentExpenses: z.array(
                z
                  .object({
                    expenseType: z.enum([
                      "rent",
                      "renters_insurance",
                      "pet_fee",
                      "washer_dryer_fee",
                      "condo_fee",
                      "maintenance_fee",
                      "other",
                    ]),
                    whoPays: z.string().max(200),
                    isPersonInHome: z.boolean(),
                    whoIsExpenseFor: z.string().max(200),
                    expenseMonth: z.string(),
                    amountPaid: z.number().gte(0),
                  })
                  .partial()
              ),
              utilitiesIncludedInRent: z.boolean(),
              receivesSection8OrPublicHousing: z.boolean(),
              housingAssistanceType: z.enum(["section8", "public_housing"]),
            })
            .partial(),
          mortgage: z
            .object({
              hasMortgageExpenses: z.boolean(),
              mortgageExpenses: z.array(
                z
                  .object({
                    expenseType: z.enum([
                      "mortgage",
                      "homeowners_insurance",
                      "property_taxes",
                      "hoa_fees",
                    ]),
                    whoPays: z.string().max(200),
                    isPersonInHome: z.boolean(),
                    whoIsExpenseFor: z.string().max(200),
                    expenseMonth: z.string(),
                    amountPaid: z.number().gte(0),
                  })
                  .partial()
              ),
              receivesSection8OrPublicHousing: z.boolean(),
              housingAssistanceType: z.enum(["section8", "public_housing"]),
            })
            .partial(),
          utilities: z
            .object({
              heatingCoolingMethod: z.array(
                z.enum([
                  "electric",
                  "gas",
                  "firewood",
                  "propane",
                  "swamp_cooler",
                  "other",
                ])
              ),
              otherHeatingCoolingType: z.string().max(100),
              receivedLEAP: z.boolean(),
            })
            .partial(),
          additionalExpenses: z
            .object({
              hasAdditionalExpenses: z.boolean(),
              expenses: z.array(
                z
                  .object({
                    expenseType: z.enum([
                      "child_daycare",
                      "adult_daycare",
                      "legally_obligated_child_support",
                      "child_support_arrears",
                      "medical_expenses",
                      "student_loan_interest",
                      "alimony",
                    ]),
                    whoPays: z.string().max(200),
                    isPersonInHome: z.boolean(),
                    whoIsExpenseFor: z.string().max(200),
                    monthOfExpense: z.string(),
                    amountPaid: z.number().gte(0),
                    legallyObligatedAmount: z.number().gte(0),
                  })
                  .partial()
              ),
            })
            .partial(),
        })
        .partial()
        .optional(),
      students: z
        .object({
          hasStudents: z.boolean(),
          studentDetails: z.array(
            z
              .object({
                name: z.string().max(200),
                schoolName: z.string().max(200),
                lastGradeCompleted: z.string().max(50),
                startDate: z.string(),
                expectedGraduationDate: z.string(),
                isFullTimeStudent: z.boolean(),
              })
              .partial()
          ),
          hasFinancialAid: z.boolean(),
          financialAid: z.array(
            z.object({ personName: z.string().max(200) }).partial()
          ),
          grantsScholarshipsWorkStudyForLivingExpenses: z.number().gte(0),
          taxableGrantsScholarshipsWorkStudy: z.number().gte(0),
        })
        .partial()
        .optional(),
      resources: z
        .object({
          hasResources: z.boolean(),
          financialResources: z.array(
            z
              .object({
                personName: z.string().max(200),
                resourceType: z.enum([
                  "cash_on_hand",
                  "checking_account",
                  "savings_account",
                  "stocks",
                  "bonds",
                  "mutual_funds",
                  "401k",
                  "ira",
                  "trusts",
                  "cds",
                  "annuities",
                  "college_funds",
                  "pass_accounts",
                  "idas",
                  "promissory_notes",
                  "education_accounts",
                  "other",
                ]),
                financialInstitutionName: z.string().max(200),
                accountNumber: z.string().max(100),
                currentValue: z.number().gte(0),
              })
              .partial()
          ),
          hasVehicles: z.boolean(),
          vehicles: z.array(
            z
              .object({
                personName: z.string().max(200),
                year: z.number().int().gte(1900),
                make: z.string().max(100),
                model: z.string().max(100),
                currentValue: z.number().gte(0),
              })
              .partial()
          ),
          hasLifeOrBurialInsurance: z.boolean(),
          lifeOrBurialInsurance: z.array(
            z
              .object({
                personName: z.string().max(200),
                policyType: z.enum(["life_insurance", "burial_insurance"]),
                company: z.string().max(200),
                policyNumber: z.string().max(100),
                revocableOrIrrevocable: z.enum(["revocable", "irrevocable"]),
                policyValue: z.number().gte(0),
              })
              .partial()
          ),
          ownsProperty: z.boolean(),
          property: z.array(
            z
              .object({
                personName: z.string().max(200),
                propertyType: z.string().max(200),
                propertyAddress: z.object({
                  addressLine1: z.string().min(1).max(150),
                  addressLine2: z.string().max(150).optional(),
                  city: z.string().min(1).max(100),
                  stateProvince: z.string().min(1).max(100),
                  postalCode: z.string().min(3).max(20),
                  county: z.string().max(100).optional(),
                }),
                primaryPropertyUse: z.array(
                  z.enum([
                    "primary_home",
                    "rental_income",
                    "business_self_employment",
                    "other",
                  ])
                ),
                primaryPropertyUseOther: z.string().max(200),
                currentValue: z.number().gte(0),
              })
              .partial()
          ),
          hasTransferredAssets: z.boolean(),
          transferredAssets: z.array(
            z
              .object({
                personName: z.string().max(200),
                dateOfTransfer: z.string(),
                assetDescription: z.string().max(500),
                amountReceived: z.number().gte(0),
                fairMarketValue: z.number().gte(0),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      priorConvictions: z
        .object({
          convictedOfDuplicateSNAPBenefits: z.boolean(),
          duplicateSNAPBenefitsWho: z.array(z.string().max(200)),
          hidingFromLaw: z.boolean(),
          hidingFromLawWho: z.array(z.string().max(200)),
          convictedOfDrugFelony: z.boolean(),
          drugFelonyWho: z.array(z.string().max(200)),
          convictedOfSNAPTrafficking: z.boolean(),
          snapTraffickingWho: z.array(z.string().max(200)),
          convictedOfTradingSNAPForWeapons: z.boolean(),
          tradingSNAPForWeaponsWho: z.array(z.string().max(200)),
          disqualifiedForIPVOrWelfareFraud: z.boolean(),
          ipvOrWelfareFraudWho: z.array(z.string().max(200)),
          convictedOfViolentCrime: z.boolean(),
          violentCrimeWho: z.array(z.string().max(200)),
        })
        .partial()
        .optional(),
      hasMilitaryService: z.boolean().optional(),
      militaryServiceMembers: z.array(z.string().max(200)).optional(),
      burialPreference: z
        .enum(["cremation", "burial", "no_preference"])
        .optional(),
      retroactiveMedicalCoverage: z
        .object({
          wantsRetroactiveCoverage: z.boolean(),
          requests: z.array(
            z
              .object({
                who: z.string().max(200),
                months: z.array(z.string()),
                householdIncomeInThoseMonths: z.number().gte(0),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      taxFiler: z
        .object({
          taxFilers: z.array(
            z
              .object({
                name: z.string().max(200),
                willFileTaxes: z.boolean(),
                filingJointlyWithSpouse: z.boolean(),
                spouseName: z.string().max(200),
                willClaimDependents: z.boolean(),
                dependentsToClaim: z.array(z.string().max(200)),
                expectsToBeClaimedAsDependent: z.boolean(),
                isClaimedAsDependent: z.boolean(),
                nameOfPersonClaiming: z.string().max(200),
                isPersonClaimingListedOnApplication: z.boolean(),
                isPersonClaimingNonCustodialParent: z.boolean(),
                marriedFilingSeparatelyWithExceptionalCircumstances:
                  z.boolean(),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      healthInsurance: z
        .object({
          hasHealthInsurance: z.boolean(),
          coverageDetails: z.array(
            z
              .object({
                personName: z.string().max(200),
                typeOfCoverage: z.enum([
                  "medicare",
                  "tricare",
                  "va_health_care",
                  "peace_corps",
                  "cobra",
                  "retiree_health_plan",
                  "current_employer_sponsored",
                  "railroad_retirement_insurance",
                ]),
                coverageStartDate: z.string(),
                coverageEndDate: z.string(),
                enrollmentStatus: z.enum(["eligible", "enrolled"]),
              })
              .partial()
          ),
          federalHealthBenefitPrograms: z.array(
            z
              .object({
                programTypeOrName: z.string().max(200),
                whoIsEnrolled: z.string().max(200),
                insuranceCompanyName: z.string().max(200),
                policyNumber: z.string().max(100),
              })
              .partial()
          ),
          employerSponsoredCoverage: z.array(
            z
              .object({
                employerName: z.string().max(200),
                employerIdentificationNumber: z.string().max(50),
                employerAddress: z.object({
                  addressLine1: z.string().min(1).max(150),
                  addressLine2: z.string().max(150).optional(),
                  city: z.string().min(1).max(100),
                  stateProvince: z.string().min(1).max(100),
                  postalCode: z.string().min(3).max(20),
                  county: z.string().max(100).optional(),
                }),
                employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                contactAboutCoverage: z.string().max(200),
                coverageStartDate: z.string(),
                coverageEndDate: z.string(),
                whoElseHadAccess: z.string().max(200),
                whoElseWasEnrolled: z.string().max(200),
                premiumAmount: z.number().gte(0),
                premiumAmountUnknown: z.boolean(),
                premiumFrequency: z.enum([
                  "weekly",
                  "every_two_weeks",
                  "twice_monthly",
                  "monthly",
                  "yearly",
                ]),
                hasEmployeeOnlyPlanMeetingMinimumValue: z.boolean(),
                lowestCostPlanName: z.string().max(200),
                lowestCostPlanUnknown: z.boolean(),
                noPlansMeetMinimumValue: z.boolean(),
              })
              .partial()
          ),
          medicare: z.array(
            z
              .object({
                personName: z.string().max(200),
                partA: z
                  .object({
                    isEntitledOrReceiving: z.boolean(),
                    startDate: z.string(),
                    isCurrentlyEnrolled: z.boolean(),
                    whoPaysPremium: z.string().max(200),
                    isPremiumFree: z.boolean(),
                  })
                  .partial(),
                partB: z
                  .object({
                    isEntitledOrReceiving: z.boolean(),
                    startDate: z.string(),
                    premiumAmount: z.number().gte(0),
                    whoPaysPremium: z.string().max(200),
                  })
                  .partial(),
                partC: z
                  .object({
                    isEntitledOrReceiving: z.boolean(),
                    startDate: z.string(),
                  })
                  .partial(),
                partD: z
                  .object({
                    isEntitledOrReceiving: z.boolean(),
                    startDate: z.string(),
                    premiumAmount: z.number().gte(0),
                    whoPaysPremium: z.string().max(200),
                  })
                  .partial(),
              })
              .partial()
          ),
          hasLegalClaim: z.boolean(),
          legalClaimNames: z.array(z.string().max(200)),
          wantsSeparateMail: z.boolean(),
          separateMailAddresses: z.array(
            z
              .object({
                name: z.string().max(200),
                address: z.object({
                  addressLine1: z.string().min(1).max(150),
                  addressLine2: z.string().max(150).optional(),
                  city: z.string().min(1).max(100),
                  stateProvince: z.string().min(1).max(100),
                  postalCode: z.string().min(3).max(20),
                  county: z.string().max(100).optional(),
                }),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      expectedIncomeChange: z
        .object({
          doesIncomeChangeFromMonthToMonth: z.boolean(),
          changes: z.array(
            z
              .object({
                name: z.string().max(200),
                annualIncome: z.number().gte(0),
                employerName: z.string().max(200),
                willAnnualIncomeBeSameOrLowerNextYear: z.boolean(),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      reasonsForIncomeDifferences: z
        .object({
          incomeDifferences: z.array(
            z
              .object({
                name: z.string().max(200),
                whatHappened: z.enum([
                  "stopped_working_job",
                  "hours_changed_at_job",
                  "change_in_employment",
                  "married_legal_separation_or_divorce",
                  "other",
                ]),
              })
              .partial()
          ),
          hasJobOrNonJobRelatedDeductions: z.boolean(),
          deductionsChangeMonthToMonth: z.boolean(),
          deductions: z.array(
            z
              .object({
                deductionType: z.string().max(200),
                frequency: z.enum([
                  "one_time_only",
                  "weekly",
                  "every_two_weeks",
                  "twice_monthly",
                  "monthly",
                  "yearly",
                ]),
                currentAmount: z.number().gte(0),
                actualAnnualAmount: z.number().gte(0),
              })
              .partial()
          ),
          hasPastIncomeAndDeductions: z.boolean(),
          pastIncomeAmount: z.number().gte(0),
          pastDeductionsAmount: z.number().gte(0),
        })
        .partial()
        .optional(),
      americanIndianOrAlaskaNativeInformation: z
        .object({
          isAnyoneAmericanIndianOrAlaskaNative: z.boolean(),
          members: z.array(
            z
              .object({
                name: z.string().max(200),
                tribeName: z.string().max(200),
                tribeState: z.string().max(100),
                typeOfIncomeReceived: z.string().max(200),
                frequencyAndAmount: z.string().max(200),
              })
              .partial()
          ),
          hasAnyoneReceivedServiceFromIndianHealthService: z.boolean(),
          whoReceivedService: z.array(z.string().max(200)),
          isAnyoneEligibleForIndianHealthService: z.boolean(),
          whoIsEligible: z.array(z.string().max(200)),
        })
        .partial()
        .optional(),
      permissionToValidateIncome: z
        .object({ doesNotGivePermissionToValidateIncome: z.boolean() })
        .partial()
        .optional(),
      authorizedRepresentativeForMedicalAssistance: z
        .object({
          isIndividual: z.boolean(),
          name: z.string().max(200),
          organizationId: z.string().max(50),
          address: z.object({
            addressLine1: z.string().min(1).max(150),
            addressLine2: z.string().max(150).optional(),
            city: z.string().min(1).max(100),
            stateProvince: z.string().min(1).max(100),
            postalCode: z.string().min(3).max(20),
            county: z.string().max(100).optional(),
          }),
          inCareOf: z.string().max(200),
          phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
          email: z.string().max(320).email(),
          receiveNotices: z.boolean(),
          applicantSignature: z.object({
            signature: z.string(),
            signatureDate: z.string(),
          }),
          authorizedRepresentativeSignature: z.object({
            signature: z.string(),
            signatureDate: z.string(),
          }),
        })
        .partial()
        .optional(),
      createdAt: z.string().datetime({ offset: true }),
      updatedAt: z.string().datetime({ offset: true }),
    }),
    errors: [
      {
        status: 404,
        description: `The requested resource was not found.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
      {
        status: 500,
        description: `An unexpected error occurred on the server.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
    ],
  },
  {
    method: "patch",
    path: "/applications/:applicationId",
    alias: "updateApplication",
    description: `Apply partial updates to an existing application.`,
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: updateApplication_Body,
      },
      {
        name: "applicationId",
        type: "Path",
        schema: z.string().uuid(),
      },
    ],
    response: z.object({
      id: z.string().uuid(),
      state: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
      status: z
        .enum([
          "draft",
          "submitted",
          "under_review",
          "approved",
          "denied",
          "pending_information",
          "withdrawn",
        ])
        .optional(),
      programs: z
        .object({
          snap: z.boolean(),
          cashPrograms: z
            .object({ tanfProgram: z.boolean(), adultFinancial: z.boolean() })
            .partial(),
          medicalAssistance: z.boolean(),
        })
        .partial()
        .and(z.object({}).partial().passthrough()),
      applicantInfo: z
        .object({
          applicantName: z.object({
            firstName: z.string().min(1).max(100),
            middleInitial: z.string().max(1).optional(),
            middleName: z.string().max(100).optional(),
            lastName: z.string().min(1).max(100),
            maidenName: z.string().max(100).optional(),
          }),
          socialSecurityNumber: z.string().regex(/^\d{3}-\d{2}-\d{4}$/),
          dateOfBirth: z.string(),
          signature: z
            .object({
              applicantSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
              spouseCoApplicantSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
              applicantAuthorizedRepresentativeSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
              coApplicantAuthorizedRepresentativeSignature: z.object({
                signature: z.string(),
                signatureDate: z.string(),
              }),
            })
            .partial(),
          homeAddress: z.object({
            addressLine1: z.string().min(1).max(150),
            addressLine2: z.string().max(150).optional(),
            city: z.string().min(1).max(100),
            stateProvince: z.string().min(1).max(100),
            postalCode: z.string().min(3).max(20),
            county: z.string().max(100).optional(),
          }),
          mailingAddress: z.object({
            addressLine1: z.string().min(1).max(150),
            addressLine2: z.string().max(150).optional(),
            city: z.string().min(1).max(100),
            stateProvince: z.string().min(1).max(100),
            postalCode: z.string().min(3).max(20),
            county: z.string().max(100).optional(),
          }),
          phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
          otherPhoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
          email: z.string().max(320).email(),
          speaksEnglish: z.boolean(),
          preferredLanguage: z
            .string()
            .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/),
          isHomeless: z.boolean(),
          isStateResident: z.boolean(),
          preferredNoticeMethod: z.enum(["paper", "email", "both"]),
          personWhoHelpedCompleteApplication: z
            .object({
              name: z.string().max(200),
              address: z.object({
                addressLine1: z.string().min(1).max(150),
                addressLine2: z.string().max(150).optional(),
                city: z.string().min(1).max(100),
                stateProvince: z.string().min(1).max(100),
                postalCode: z.string().min(3).max(20),
                county: z.string().max(100).optional(),
              }),
              phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
            })
            .partial(),
        })
        .partial(),
      householdDemographics: z
        .object({
          householdMembers: z
            .array(
              z.object({
                name: z.object({
                  firstName: z.string().min(1).max(100),
                  middleInitial: z.string().max(1).optional(),
                  middleName: z.string().max(100).optional(),
                  lastName: z.string().min(1).max(100),
                  maidenName: z.string().max(100).optional(),
                }),
                relationship: z.enum([
                  "self",
                  "spouse",
                  "child",
                  "parent",
                  "sibling",
                  "other_relative",
                  "non_relative",
                ]),
                dateOfBirth: z.string(),
                socialSecurityNumber: z
                  .string()
                  .regex(/^\d{3}-\d{2}-\d{4}$/)
                  .optional(),
                isUSCitizen: z.boolean().optional(),
                citizenshipCertificateNumber: z.string().max(50).optional(),
                gender: z.enum(["male", "female", "unknown"]).optional(),
                maritalStatus: z
                  .enum([
                    "single",
                    "married",
                    "divorced",
                    "separated",
                    "widowed",
                    "civil_union",
                    "domestic_partnership",
                  ])
                  .optional(),
                isHispanicOrLatino: z.boolean().optional(),
                race: z
                  .array(
                    z.enum([
                      "american_indian_alaskan_native",
                      "asian",
                      "black_african_american",
                      "native_hawaiian_pacific_islander",
                      "white",
                    ])
                  )
                  .optional(),
                programsApplyingFor: z
                  .object({
                    snap: z.boolean(),
                    cashPrograms: z
                      .object({
                        tanfProgram: z.boolean(),
                        adultFinancial: z.boolean(),
                      })
                      .partial(),
                    medicalAssistance: z.boolean(),
                  })
                  .partial()
                  .and(z.object({ notApplying: z.boolean() }).partial())
                  .optional(),
              })
            )
            .min(1),
          roomersOrBoarders: z.array(
            z
              .object({
                name: z.string().max(200),
                rentAmount: z.number().gte(0),
                mealsIncluded: z.boolean(),
              })
              .partial()
          ),
          institutionalizedMembers: z.array(
            z
              .object({
                name: z.string().max(200),
                dateEntered: z.string(),
                facilityName: z.string().max(200),
                facilityType: z.enum([
                  "nursing_home",
                  "hospital",
                  "mental_health_institution",
                  "incarceration",
                  "other",
                ]),
                isPendingDisposition: z.boolean(),
                mealsProvided: z.boolean(),
              })
              .partial()
          ),
        })
        .partial(),
      expeditedSNAPDetails: z
        .object({
          householdSize: z.number().int().gte(1),
          isMigrantOrSeasonalFarmWorker: z.boolean(),
          totalExpectedIncomeThisMonth: z.number().gte(0),
          totalCashOnHand: z.number().gte(0),
          monthlyMortgage: z.number().gte(0),
          monthlyRent: z.number().gte(0),
          utilityCosts: z
            .object({
              electricity: z.number().gte(0),
              water: z.number().gte(0),
              phone: z.number().gte(0),
              trash: z.number().gte(0),
              sewer: z.number().gte(0),
              other: z.number().gte(0),
            })
            .partial(),
          receivedBenefitsOtherState: z.boolean(),
        })
        .partial()
        .optional(),
      ebtCard: z
        .object({
          needsEBTCard: z.boolean(),
          ebtCardDeliveryMethod: z.enum(["postal_mail", "in_person"]),
        })
        .partial()
        .optional(),
      voterRegistration: z
        .object({ wantsToRegister: z.boolean() })
        .partial()
        .optional(),
      dependentChildren: z
        .object({
          livesWithChildUnder19: z.boolean(),
          hasParentOutsideHome: z.boolean(),
          triedToGetMedicalSupport: z.boolean(),
          absentParents: z.array(
            z
              .object({
                name: z.string().max(200),
                address: z.object({
                  addressLine1: z.string().min(1).max(150),
                  addressLine2: z.string().max(150).optional(),
                  city: z.string().min(1).max(100),
                  stateProvince: z.string().min(1).max(100),
                  postalCode: z.string().min(3).max(20),
                  county: z.string().max(100).optional(),
                }),
                phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                forWhichChild: z.string().max(200),
              })
              .partial()
          ),
          wantsGoodCauseFromChildSupport: z.boolean(),
        })
        .partial()
        .optional(),
      fosterCare: z
        .object({
          hasFosterCareHistory: z.boolean(),
          members: z.array(
            z
              .object({
                name: z.string().max(200),
                currentAge: z.number().int().gte(0),
                datesInFosterCare: z.string().max(200),
                ageWhenLeft: z.number().int().gte(0),
              })
              .partial()
          ),
          formerFosterCareMedicalAssistance: z
            .object({
              receivedFormerFosterCareMedicalAssistance: z.boolean(),
              name: z.string().max(200),
              stateLivedInWhenAgedOut: z.string().max(2),
              nameUsedInOutOfStateFosterCare: z.string().max(200),
              dateLeftFosterCare: z.string(),
              wereAdopted: z.boolean(),
              returnedToFosterCareAfterAdoption: z.boolean(),
              residencyDate: z.string(),
              needsHelpPayingMedicalBills: z.boolean(),
              medicalBillsHelpWhen: z.string(),
              medicalBillsHelpMonths: z.array(z.string()),
            })
            .partial(),
        })
        .partial()
        .optional(),
      familyPlanning: z
        .object({
          wantsFamilyPlanningBenefits: z.boolean(),
          names: z.array(z.string().max(200)),
        })
        .partial()
        .optional(),
      pregnancy: z
        .object({
          isAnyonePregnant: z.boolean(),
          pregnancies: z.array(
            z
              .object({
                name: z.string().max(200),
                dueDate: z.string(),
                numberOfBabiesExpected: z.number().int().gte(1),
                fatherName: z.string().max(200),
                wantsGoodCauseFromChildSupport: z.boolean(),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      disability: z
        .object({
          hasDisability: z.boolean(),
          disabledMembers: z.array(
            z
              .object({
                name: z.string().max(200),
                needsHelpWithSelfCare: z.boolean(),
                hasMedicalOrDevelopmentalCondition: z.boolean(),
              })
              .partial()
          ),
          socialSecurityApplications: z.array(
            z
              .object({
                name: z.string().max(200),
                program: z.enum(["SSI", "SSDI", "other"]),
                otherProgramName: z.string().max(200),
                applicationDate: z.string(),
                status: z.enum(["pending", "approved", "denied", "appealed"]),
              })
              .partial()
          ),
          everReceivedSSIOrSSDI: z.boolean(),
          ssiOrSsdiEndDate: z.string(),
        })
        .partial()
        .optional(),
      nonCitizen: z
        .object({
          wantsEmergencyMedicaidAndReproductiveBenefits: z.boolean(),
          emergencyMedicaidApplicants: z.array(z.string().max(200)),
          hasNonCitizens: z.boolean(),
          nonCitizens: z.array(
            z
              .object({
                name: z.string().max(200),
                status: z.string().max(100),
                documentType: z.string().max(100),
                documentNumber: z.string().max(100),
                alienOrI94Number: z.string().max(100),
                documentExpirationDate: z.string(),
                countryOfIssuance: z.string().max(100),
                livedInUSSince1996: z.boolean(),
                spouseOrParentIsVeteranOrActiveDuty: z.boolean(),
                hasSponsor: z.boolean(),
                sponsor: z
                  .object({
                    hasBeenAbandonedMistreatedOrAbused: z.boolean(),
                    isPregnantOr20OrYounger: z.boolean(),
                    sponsorName: z.string().max(200),
                    sponsorSpouseName: z.string().max(200),
                    sponsorSocialSecurityNumber: z
                      .string()
                      .regex(/^\d{3}-\d{2}-\d{4}$/),
                    sponsorAddress: z.object({
                      addressLine1: z.string().min(1).max(150),
                      addressLine2: z.string().max(150).optional(),
                      city: z.string().min(1).max(100),
                      stateProvince: z.string().min(1).max(100),
                      postalCode: z.string().min(3).max(20),
                      county: z.string().max(100).optional(),
                    }),
                    sponsorSpouseSocialSecurityNumber: z
                      .string()
                      .regex(/^\d{3}-\d{2}-\d{4}$/),
                    totalPeopleInSponsorHousehold: z.number().int().gte(1),
                    doesSponsoredIndividualLiveWithSponsor: z.boolean(),
                    doesSponsoredIndividualReceiveFreeRoomAndBoard: z.boolean(),
                    doesSponsoredIndividualReceiveSupportFromSponsor:
                      z.boolean(),
                  })
                  .partial(),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      earnedIncome: z
        .object({
          hasEmployment: z.boolean(),
          jobs: z.array(
            z
              .object({
                personName: z.string().max(200),
                employerName: z.string().max(200),
                employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                monthlyWagesBeforeTaxes: z.number().gte(0),
                hourlyWage: z.number().gte(0),
                averageHoursPerWeek: z.number().gte(0).lte(168),
                payFrequency: z.enum([
                  "hourly",
                  "weekly",
                  "every_two_weeks",
                  "twice_monthly",
                  "monthly",
                  "yearly",
                  "daily",
                ]),
                isTemporaryJob: z.boolean(),
                incomeType: z.enum([
                  "seasonal_employment",
                  "commission_based_employment",
                  "regular_employment",
                ]),
              })
              .partial()
          ),
          hasSelfEmployment: z.boolean(),
          selfEmployment: z.array(
            z
              .object({
                personName: z.string().max(200),
                businessName: z.string().max(200),
                oneMonthsGrossIncome: z.number().gte(0),
                monthOfIncome: z.string(),
                selfEmploymentType: z.enum([
                  "sole_proprietor",
                  "llc",
                  "s_corp",
                  "independent_contractor",
                ]),
                utilitiesPaidForBusiness: z.number().gte(0),
                businessTaxesPaid: z.number().gte(0),
                interestPaidForBusiness: z.number().gte(0),
                grossBusinessLaborCosts: z.number().gte(0),
                costOfMerchandise: z.number().gte(0),
                otherBusinessCosts: z.array(
                  z
                    .object({
                      type: z.string().max(200),
                      amount: z.number().gte(0),
                    })
                    .partial()
                ),
                totalNetIncome: z.number(),
              })
              .partial()
          ),
          hasJobChanges: z.boolean(),
          jobChanges: z.array(
            z
              .object({
                personName: z.string().max(200),
                employerName: z.string().max(200),
                employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                startDate: z.string(),
                endDate: z.string(),
                monthlyWagesBeforeTaxes: z.number().gte(0),
                lastPaycheckDate: z.string(),
                lastPaycheckAmount: z.number().gte(0),
                payFrequency: z.enum([
                  "hourly",
                  "weekly",
                  "every_two_weeks",
                  "twice_monthly",
                  "monthly",
                  "yearly",
                ]),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      unearnedIncome: z
        .object({
          hasOtherIncome: z.boolean(),
          incomeSources: z.array(
            z
              .object({
                personName: z.string().max(200),
                incomeType: z.enum([
                  "unemployment_benefits",
                  "SSI",
                  "veterans_benefits",
                  "widow_benefits",
                  "workers_comp",
                  "railroad_retirement",
                  "child_support",
                  "survivors_benefits",
                  "dividends_interest",
                  "rental_income",
                  "money_from_boarder",
                  "disability_benefits",
                  "retirement_pension",
                  "SSDI",
                  "alimony",
                  "in_kind_income",
                  "social_security_benefits",
                  "public_assistance",
                  "plasma_donations",
                  "gifts",
                  "loans",
                  "foster_care_payments",
                  "tribal_benefits",
                  "other",
                ]),
                monthlyAmount: z.number().gte(0),
              })
              .partial()
          ),
          hasLumpSumPayments: z.boolean(),
          lumpSumPayments: z.array(
            z
              .object({
                personName: z.string().max(200),
                dateReceived: z.string(),
                type: z.enum([
                  "lawsuit_settlement",
                  "insurance_settlement",
                  "social_security_ssi_ssdi_payment",
                  "veterans",
                  "inheritance",
                  "surrender_of_annuity",
                  "life_insurance_payout",
                  "lottery_gambling_winnings",
                  "other",
                ]),
                amount: z.number().gte(0),
              })
              .partial()
          ),
          isAnyoneOnStrike: z.boolean(),
          strikeInformation: z.array(
            z
              .object({
                personName: z.string().max(200),
                strikeBeginDate: z.string(),
                lastPaycheckDate: z.string(),
                lastPaycheckAmount: z.number().gte(0),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      expenses: z
        .object({
          rent: z
            .object({
              hasRentExpenses: z.boolean(),
              rentExpenses: z.array(
                z
                  .object({
                    expenseType: z.enum([
                      "rent",
                      "renters_insurance",
                      "pet_fee",
                      "washer_dryer_fee",
                      "condo_fee",
                      "maintenance_fee",
                      "other",
                    ]),
                    whoPays: z.string().max(200),
                    isPersonInHome: z.boolean(),
                    whoIsExpenseFor: z.string().max(200),
                    expenseMonth: z.string(),
                    amountPaid: z.number().gte(0),
                  })
                  .partial()
              ),
              utilitiesIncludedInRent: z.boolean(),
              receivesSection8OrPublicHousing: z.boolean(),
              housingAssistanceType: z.enum(["section8", "public_housing"]),
            })
            .partial(),
          mortgage: z
            .object({
              hasMortgageExpenses: z.boolean(),
              mortgageExpenses: z.array(
                z
                  .object({
                    expenseType: z.enum([
                      "mortgage",
                      "homeowners_insurance",
                      "property_taxes",
                      "hoa_fees",
                    ]),
                    whoPays: z.string().max(200),
                    isPersonInHome: z.boolean(),
                    whoIsExpenseFor: z.string().max(200),
                    expenseMonth: z.string(),
                    amountPaid: z.number().gte(0),
                  })
                  .partial()
              ),
              receivesSection8OrPublicHousing: z.boolean(),
              housingAssistanceType: z.enum(["section8", "public_housing"]),
            })
            .partial(),
          utilities: z
            .object({
              heatingCoolingMethod: z.array(
                z.enum([
                  "electric",
                  "gas",
                  "firewood",
                  "propane",
                  "swamp_cooler",
                  "other",
                ])
              ),
              otherHeatingCoolingType: z.string().max(100),
              receivedLEAP: z.boolean(),
            })
            .partial(),
          additionalExpenses: z
            .object({
              hasAdditionalExpenses: z.boolean(),
              expenses: z.array(
                z
                  .object({
                    expenseType: z.enum([
                      "child_daycare",
                      "adult_daycare",
                      "legally_obligated_child_support",
                      "child_support_arrears",
                      "medical_expenses",
                      "student_loan_interest",
                      "alimony",
                    ]),
                    whoPays: z.string().max(200),
                    isPersonInHome: z.boolean(),
                    whoIsExpenseFor: z.string().max(200),
                    monthOfExpense: z.string(),
                    amountPaid: z.number().gte(0),
                    legallyObligatedAmount: z.number().gte(0),
                  })
                  .partial()
              ),
            })
            .partial(),
        })
        .partial()
        .optional(),
      students: z
        .object({
          hasStudents: z.boolean(),
          studentDetails: z.array(
            z
              .object({
                name: z.string().max(200),
                schoolName: z.string().max(200),
                lastGradeCompleted: z.string().max(50),
                startDate: z.string(),
                expectedGraduationDate: z.string(),
                isFullTimeStudent: z.boolean(),
              })
              .partial()
          ),
          hasFinancialAid: z.boolean(),
          financialAid: z.array(
            z.object({ personName: z.string().max(200) }).partial()
          ),
          grantsScholarshipsWorkStudyForLivingExpenses: z.number().gte(0),
          taxableGrantsScholarshipsWorkStudy: z.number().gte(0),
        })
        .partial()
        .optional(),
      resources: z
        .object({
          hasResources: z.boolean(),
          financialResources: z.array(
            z
              .object({
                personName: z.string().max(200),
                resourceType: z.enum([
                  "cash_on_hand",
                  "checking_account",
                  "savings_account",
                  "stocks",
                  "bonds",
                  "mutual_funds",
                  "401k",
                  "ira",
                  "trusts",
                  "cds",
                  "annuities",
                  "college_funds",
                  "pass_accounts",
                  "idas",
                  "promissory_notes",
                  "education_accounts",
                  "other",
                ]),
                financialInstitutionName: z.string().max(200),
                accountNumber: z.string().max(100),
                currentValue: z.number().gte(0),
              })
              .partial()
          ),
          hasVehicles: z.boolean(),
          vehicles: z.array(
            z
              .object({
                personName: z.string().max(200),
                year: z.number().int().gte(1900),
                make: z.string().max(100),
                model: z.string().max(100),
                currentValue: z.number().gte(0),
              })
              .partial()
          ),
          hasLifeOrBurialInsurance: z.boolean(),
          lifeOrBurialInsurance: z.array(
            z
              .object({
                personName: z.string().max(200),
                policyType: z.enum(["life_insurance", "burial_insurance"]),
                company: z.string().max(200),
                policyNumber: z.string().max(100),
                revocableOrIrrevocable: z.enum(["revocable", "irrevocable"]),
                policyValue: z.number().gte(0),
              })
              .partial()
          ),
          ownsProperty: z.boolean(),
          property: z.array(
            z
              .object({
                personName: z.string().max(200),
                propertyType: z.string().max(200),
                propertyAddress: z.object({
                  addressLine1: z.string().min(1).max(150),
                  addressLine2: z.string().max(150).optional(),
                  city: z.string().min(1).max(100),
                  stateProvince: z.string().min(1).max(100),
                  postalCode: z.string().min(3).max(20),
                  county: z.string().max(100).optional(),
                }),
                primaryPropertyUse: z.array(
                  z.enum([
                    "primary_home",
                    "rental_income",
                    "business_self_employment",
                    "other",
                  ])
                ),
                primaryPropertyUseOther: z.string().max(200),
                currentValue: z.number().gte(0),
              })
              .partial()
          ),
          hasTransferredAssets: z.boolean(),
          transferredAssets: z.array(
            z
              .object({
                personName: z.string().max(200),
                dateOfTransfer: z.string(),
                assetDescription: z.string().max(500),
                amountReceived: z.number().gte(0),
                fairMarketValue: z.number().gte(0),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      priorConvictions: z
        .object({
          convictedOfDuplicateSNAPBenefits: z.boolean(),
          duplicateSNAPBenefitsWho: z.array(z.string().max(200)),
          hidingFromLaw: z.boolean(),
          hidingFromLawWho: z.array(z.string().max(200)),
          convictedOfDrugFelony: z.boolean(),
          drugFelonyWho: z.array(z.string().max(200)),
          convictedOfSNAPTrafficking: z.boolean(),
          snapTraffickingWho: z.array(z.string().max(200)),
          convictedOfTradingSNAPForWeapons: z.boolean(),
          tradingSNAPForWeaponsWho: z.array(z.string().max(200)),
          disqualifiedForIPVOrWelfareFraud: z.boolean(),
          ipvOrWelfareFraudWho: z.array(z.string().max(200)),
          convictedOfViolentCrime: z.boolean(),
          violentCrimeWho: z.array(z.string().max(200)),
        })
        .partial()
        .optional(),
      hasMilitaryService: z.boolean().optional(),
      militaryServiceMembers: z.array(z.string().max(200)).optional(),
      burialPreference: z
        .enum(["cremation", "burial", "no_preference"])
        .optional(),
      retroactiveMedicalCoverage: z
        .object({
          wantsRetroactiveCoverage: z.boolean(),
          requests: z.array(
            z
              .object({
                who: z.string().max(200),
                months: z.array(z.string()),
                householdIncomeInThoseMonths: z.number().gte(0),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      taxFiler: z
        .object({
          taxFilers: z.array(
            z
              .object({
                name: z.string().max(200),
                willFileTaxes: z.boolean(),
                filingJointlyWithSpouse: z.boolean(),
                spouseName: z.string().max(200),
                willClaimDependents: z.boolean(),
                dependentsToClaim: z.array(z.string().max(200)),
                expectsToBeClaimedAsDependent: z.boolean(),
                isClaimedAsDependent: z.boolean(),
                nameOfPersonClaiming: z.string().max(200),
                isPersonClaimingListedOnApplication: z.boolean(),
                isPersonClaimingNonCustodialParent: z.boolean(),
                marriedFilingSeparatelyWithExceptionalCircumstances:
                  z.boolean(),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      healthInsurance: z
        .object({
          hasHealthInsurance: z.boolean(),
          coverageDetails: z.array(
            z
              .object({
                personName: z.string().max(200),
                typeOfCoverage: z.enum([
                  "medicare",
                  "tricare",
                  "va_health_care",
                  "peace_corps",
                  "cobra",
                  "retiree_health_plan",
                  "current_employer_sponsored",
                  "railroad_retirement_insurance",
                ]),
                coverageStartDate: z.string(),
                coverageEndDate: z.string(),
                enrollmentStatus: z.enum(["eligible", "enrolled"]),
              })
              .partial()
          ),
          federalHealthBenefitPrograms: z.array(
            z
              .object({
                programTypeOrName: z.string().max(200),
                whoIsEnrolled: z.string().max(200),
                insuranceCompanyName: z.string().max(200),
                policyNumber: z.string().max(100),
              })
              .partial()
          ),
          employerSponsoredCoverage: z.array(
            z
              .object({
                employerName: z.string().max(200),
                employerIdentificationNumber: z.string().max(50),
                employerAddress: z.object({
                  addressLine1: z.string().min(1).max(150),
                  addressLine2: z.string().max(150).optional(),
                  city: z.string().min(1).max(100),
                  stateProvince: z.string().min(1).max(100),
                  postalCode: z.string().min(3).max(20),
                  county: z.string().max(100).optional(),
                }),
                employerPhone: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
                contactAboutCoverage: z.string().max(200),
                coverageStartDate: z.string(),
                coverageEndDate: z.string(),
                whoElseHadAccess: z.string().max(200),
                whoElseWasEnrolled: z.string().max(200),
                premiumAmount: z.number().gte(0),
                premiumAmountUnknown: z.boolean(),
                premiumFrequency: z.enum([
                  "weekly",
                  "every_two_weeks",
                  "twice_monthly",
                  "monthly",
                  "yearly",
                ]),
                hasEmployeeOnlyPlanMeetingMinimumValue: z.boolean(),
                lowestCostPlanName: z.string().max(200),
                lowestCostPlanUnknown: z.boolean(),
                noPlansMeetMinimumValue: z.boolean(),
              })
              .partial()
          ),
          medicare: z.array(
            z
              .object({
                personName: z.string().max(200),
                partA: z
                  .object({
                    isEntitledOrReceiving: z.boolean(),
                    startDate: z.string(),
                    isCurrentlyEnrolled: z.boolean(),
                    whoPaysPremium: z.string().max(200),
                    isPremiumFree: z.boolean(),
                  })
                  .partial(),
                partB: z
                  .object({
                    isEntitledOrReceiving: z.boolean(),
                    startDate: z.string(),
                    premiumAmount: z.number().gte(0),
                    whoPaysPremium: z.string().max(200),
                  })
                  .partial(),
                partC: z
                  .object({
                    isEntitledOrReceiving: z.boolean(),
                    startDate: z.string(),
                  })
                  .partial(),
                partD: z
                  .object({
                    isEntitledOrReceiving: z.boolean(),
                    startDate: z.string(),
                    premiumAmount: z.number().gte(0),
                    whoPaysPremium: z.string().max(200),
                  })
                  .partial(),
              })
              .partial()
          ),
          hasLegalClaim: z.boolean(),
          legalClaimNames: z.array(z.string().max(200)),
          wantsSeparateMail: z.boolean(),
          separateMailAddresses: z.array(
            z
              .object({
                name: z.string().max(200),
                address: z.object({
                  addressLine1: z.string().min(1).max(150),
                  addressLine2: z.string().max(150).optional(),
                  city: z.string().min(1).max(100),
                  stateProvince: z.string().min(1).max(100),
                  postalCode: z.string().min(3).max(20),
                  county: z.string().max(100).optional(),
                }),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      expectedIncomeChange: z
        .object({
          doesIncomeChangeFromMonthToMonth: z.boolean(),
          changes: z.array(
            z
              .object({
                name: z.string().max(200),
                annualIncome: z.number().gte(0),
                employerName: z.string().max(200),
                willAnnualIncomeBeSameOrLowerNextYear: z.boolean(),
              })
              .partial()
          ),
        })
        .partial()
        .optional(),
      reasonsForIncomeDifferences: z
        .object({
          incomeDifferences: z.array(
            z
              .object({
                name: z.string().max(200),
                whatHappened: z.enum([
                  "stopped_working_job",
                  "hours_changed_at_job",
                  "change_in_employment",
                  "married_legal_separation_or_divorce",
                  "other",
                ]),
              })
              .partial()
          ),
          hasJobOrNonJobRelatedDeductions: z.boolean(),
          deductionsChangeMonthToMonth: z.boolean(),
          deductions: z.array(
            z
              .object({
                deductionType: z.string().max(200),
                frequency: z.enum([
                  "one_time_only",
                  "weekly",
                  "every_two_weeks",
                  "twice_monthly",
                  "monthly",
                  "yearly",
                ]),
                currentAmount: z.number().gte(0),
                actualAnnualAmount: z.number().gte(0),
              })
              .partial()
          ),
          hasPastIncomeAndDeductions: z.boolean(),
          pastIncomeAmount: z.number().gte(0),
          pastDeductionsAmount: z.number().gte(0),
        })
        .partial()
        .optional(),
      americanIndianOrAlaskaNativeInformation: z
        .object({
          isAnyoneAmericanIndianOrAlaskaNative: z.boolean(),
          members: z.array(
            z
              .object({
                name: z.string().max(200),
                tribeName: z.string().max(200),
                tribeState: z.string().max(100),
                typeOfIncomeReceived: z.string().max(200),
                frequencyAndAmount: z.string().max(200),
              })
              .partial()
          ),
          hasAnyoneReceivedServiceFromIndianHealthService: z.boolean(),
          whoReceivedService: z.array(z.string().max(200)),
          isAnyoneEligibleForIndianHealthService: z.boolean(),
          whoIsEligible: z.array(z.string().max(200)),
        })
        .partial()
        .optional(),
      permissionToValidateIncome: z
        .object({ doesNotGivePermissionToValidateIncome: z.boolean() })
        .partial()
        .optional(),
      authorizedRepresentativeForMedicalAssistance: z
        .object({
          isIndividual: z.boolean(),
          name: z.string().max(200),
          organizationId: z.string().max(50),
          address: z.object({
            addressLine1: z.string().min(1).max(150),
            addressLine2: z.string().max(150).optional(),
            city: z.string().min(1).max(100),
            stateProvince: z.string().min(1).max(100),
            postalCode: z.string().min(3).max(20),
            county: z.string().max(100).optional(),
          }),
          inCareOf: z.string().max(200),
          phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
          email: z.string().max(320).email(),
          receiveNotices: z.boolean(),
          applicantSignature: z.object({
            signature: z.string(),
            signatureDate: z.string(),
          }),
          authorizedRepresentativeSignature: z.object({
            signature: z.string(),
            signatureDate: z.string(),
          }),
        })
        .partial()
        .optional(),
      createdAt: z.string().datetime({ offset: true }),
      updatedAt: z.string().datetime({ offset: true }),
    }),
    errors: [
      {
        status: 400,
        description: `The request is malformed or contains invalid parameters.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
      {
        status: 404,
        description: `The requested resource was not found.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
      {
        status: 422,
        description: `The request was well-formed but contained semantic errors.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
      {
        status: 500,
        description: `An unexpected error occurred on the server.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
    ],
  },
  {
    method: "delete",
    path: "/applications/:applicationId",
    alias: "deleteApplication",
    description: `Permanently remove an application record.`,
    requestFormat: "json",
    parameters: [
      {
        name: "applicationId",
        type: "Path",
        schema: z.string().uuid(),
      },
    ],
    response: z.void(),
    errors: [
      {
        status: 404,
        description: `The requested resource was not found.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
      {
        status: 500,
        description: `An unexpected error occurred on the server.`,
        schema: z.object({
          code: z.string(),
          message: z.string(),
          details: z.array(z.object({}).partial().passthrough()).optional(),
        }),
      },
    ],
  },
]);

export const api = new Zodios(endpoints);

export function createApiClient(baseUrl: string, options?: ZodiosOptions) {
  return new Zodios(baseUrl, endpoints, options);
}
