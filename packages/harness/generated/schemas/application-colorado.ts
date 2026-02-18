import { z } from 'zod';

// =============================================================================
// Enums (generated from resolved OpenAPI spec)
// =============================================================================

export const programEnum = z.enum([
  'SNAP',
  'Medicaid_MAGI',
  'Medicaid_NonMAGI',
  'TANF',
  'SSI',
  'WIC',
  'CHIP',
  'Section_8_Housing',
  'LIHEAP',
  'Summer_EBT',
]);

export const signatureMethodEnum = z.enum([
  'in_person',
  'electronic',
  'telephonic',
  'mark',
]);

export const voterRegistrationResponseEnum = z.enum([
  'register',
  'already_registered',
  'decline',
]);

export const noticeDeliveryPreferenceEnum = z.enum([
  'mail',
  'email',
  'electronic_portal',
  'text',
]);

export const paymentMethodPreferenceEnum = z.enum([
  'ebt_card',
  'direct_deposit',
  'check',
]);

export const accommodationTypeEnum = z.enum([
  'large_print',
  'braille',
  'screen_reader',
  'sign_language_interpreter',
  'tty_tdd',
  'wheelchair_accessible',
  'in_home_interview',
  'other',
]);

export const livingArrangementEnum = z.enum([
  'own_home',
  'rent',
  'living_with_others',
  'institutional',
  'other',
]);

export const familyTypeEnum = z.enum([
  'family',
  'elderly',
  'disabled',
  'displaced',
  'single_person',
  'remaining_family',
]);

export const primaryHeatingFuelTypeEnum = z.enum([
  'natural_gas',
  'electricity',
  'propane',
  'fuel_oil',
  'kerosene',
  'wood',
  'pellet',
  'coal',
  'solar',
  'other',
]);

export const preferredLanguageEnum = z.enum([
  'english',
  'spanish',
  'chinese',
  'vietnamese',
  'korean',
  'tagalog',
  'arabic',
  'french',
  'haitian_creole',
  'russian',
  'portuguese',
  'somali',
  'burmese',
  'nepali',
  'amharic',
  'other',
]);

export const genderEnum = z.enum([
  'male',
  'female',
  'other',
]);

export const raceEnum = z.enum([
  'white',
  'black',
  'asian',
  'american_indian_alaska_native',
  'native_hawaiian_pacific_islander',
  'other',
  'multiracial',
]);

export const ethnicityEnum = z.enum([
  'hispanic_latino',
  'not_hispanic_latino',
]);

export const relationshipEnum = z.enum([
  'self',
  'spouse',
  'child',
  'stepchild',
  'parent',
  'sibling',
  'grandchild',
  'grandparent',
  'aunt_uncle',
  'niece_nephew',
  'cousin',
  'other_relative',
  'unrelated_adult',
  'unrelated_child',
]);

export const maritalStatusEnum = z.enum([
  'single',
  'married',
  'separated',
  'divorced',
  'widowed',
]);

export const citizenshipStatusEnum = z.enum([
  'us_citizen',
  'us_national',
  'lawful_permanent_resident',
  'refugee',
  'asylee',
  'cuban_haitian_entrant',
  'cofa_citizen',
  'conditional_entrant',
  'paroled_for_one_year',
  'battered_spouse_child',
  'victim_of_trafficking',
  'qualified_alien_other',
  'prucol',
  'undocumented',
  'other',
]);

export const immigrationDocumentTypeEnum = z.enum([
  'permanent_resident_card',
  'employment_authorization',
  'arrival_departure_record',
  'refugee_travel_document',
  'other',
]);

export const qualifiedAlienCategoryEnum = z.enum([
  'lawful_permanent_resident',
  'refugee',
  'asylee',
  'cuban_haitian_entrant',
  'paroled_for_one_year',
  'battered_spouse_child',
  'victim_of_trafficking',
  'conditional_entrant',
  'other',
]);

export const wicParticipantCategoryEnum = z.enum([
  'pregnant_woman',
  'breastfeeding_woman',
  'postpartum_woman',
  'infant',
  'child',
]);

export const nutritionalRiskLevelEnum = z.enum([
  'high',
  'medium',
  'low',
  'none',
]);

export const nutritionalRiskConditionsEnum = z.enum([
  'anthropometric',
  'biochemical',
  'dietary_inadequacy',
  'medical_condition',
  'predisposing_condition',
  'other',
]);

export const gradeLevelEnum = z.enum([
  'pre_k',
  'k',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
]);

export const studentExemptionReasonEnum = z.enum([
  'age_under_18_or_over_49',
  'physically_mentally_unfit',
  'receiving_tanf',
  'single_parent_child_under_12',
  'responsible_child_under_6',
  'responsible_child_6_to_11_no_childcare',
  'enrolled_in_employment_training',
  'on_the_job_training',
  'work_study',
  'employed_20_plus_hours',
  'other',
]);

export const employmentStatusEnum = z.enum([
  'employed',
  'self_employed',
  'unemployed',
  'retired',
  'disabled_not_working',
  'student',
  'homemaker',
  'other',
]);

export const abawdExemptionReasonEnum = z.enum([
  'pregnant',
  'physically_mentally_unfit',
  'caring_for_child_under_14',
  'indian_tribal_member',
  'exempt_from_work_registration',
  'other',
  'none',
]);

export const medicaidWorkExemptionReasonEnum = z.enum([
  'pregnant',
  'postpartum',
  'caregiver_child_13_or_under',
  'caregiver_disabled',
  'medically_frail',
  'blind_or_disabled',
  'substance_use_disorder_treatment',
  'disabling_mental_disorder',
  'serious_medical_condition',
  'recently_incarcerated',
  'foster_youth_under_26',
  'indian_or_alaska_native',
  'disabled_veteran',
  'meeting_tanf_snap_work_req',
  'under_age_19',
  'medicare_enrollee',
  'institutionalized_prior_3_months',
  'hardship',
  'none',
]);

export const medicaidEnrollmentGroupEnum = z.enum([
  'expansion',
  'traditional',
]);

export const tanfSanctionStatusEnum = z.enum([
  'none',
  'partial',
  'full',
]);

export const minorParentLivingArrangementEnum = z.enum([
  'with_parent_guardian',
  'adult_supervised_setting',
  'independent_with_exemption',
]);

export const goodCauseExemptionReasonEnum = z.enum([
  'domestic_violence',
  'disability',
  'lack_of_childcare',
  'lack_of_transportation',
  'caring_for_ill_family_member',
  'distance_to_work_site',
  'discrimination',
  'other',
]);

export const institutionalStatusEnum = z.enum([
  'none',
  'nursing_facility',
  'icf_iid',
  'incarcerated',
  'psychiatric_facility',
  'other',
]);

export const levelOfCareAssessmentEnum = z.enum([
  'nursing_facility_level',
  'intermediate_care_level',
  'home_and_community_based',
  'not_assessed',
]);

export const taxFilingStatusEnum = z.enum([
  'will_file',
  'will_not_file',
  'not_required',
]);

export const incomeTypeEnum = z.enum([
  'employment',
  'self_employment',
  'social_security_oasdi',
  'ssi',
  'unemployment',
  'workers_compensation',
  'child_support_received',
  'alimony',
  'pension_retirement',
  'veterans_benefits',
  'interest_dividends',
  'rental',
  'royalties',
  'tribal_per_capita',
  'lottery_gambling',
  'in_kind_support',
  'other',
]);

export const frequencyEnum = z.enum([
  'hourly',
  'daily',
  'weekly',
  'every_two_weeks',
  'twice_monthly',
  'monthly',
  'quarterly',
  'annually',
  'one_time',
]);

export const verificationSourceEnum = z.enum([
  'pay_stub',
  'employer_letter',
  'tax_return',
  'benefit_letter',
  'bank_statement',
  'self_attestation',
  'other',
]);

export const assetTypeEnum = z.enum([
  'cash',
  'checking',
  'savings',
  'money_market',
  'cd',
  'stocks_bonds',
  'mutual_funds',
  'retirement_ira',
  'retirement_401k',
  'retirement_other',
  'vehicle',
  'real_property',
  'life_insurance',
  'burial_fund',
  'burial_arrangement',
  'trust',
  'able_account',
  'other',
]);

export const vehicleUseTypeEnum = z.enum([
  'primary_transportation',
  'income_producing',
  'modified_for_disability',
  'other',
]);

export const trustTypeEnum = z.enum([
  'revocable',
  'irrevocable',
  'special_needs',
  'pooled',
  'other',
]);

export const expenseTypeEnum = z.enum([
  'dependent_care',
  'child_support_paid',
  'medical_insurance_premium',
  'medical_recurring',
  'medical_one_time',
  'court_ordered',
  'disability_assistance',
  'other',
]);

// =============================================================================
// Sub-schemas
// =============================================================================

export const expenseSchema = z.object({
  type: expenseTypeEnum.optional(),
  amount: z.number().optional(),
  frequency: z.string().optional(),
  recipientOrProvider: z.string().optional(),
  description: z.string().optional(),
  forPersonId: z.string().optional(),
  courtOrderNumber: z.string().optional(),
  verificationSource: z.string().optional(),
});

export const assetSchema = z.object({
  type: assetTypeEnum.optional(),
  value: z.number().optional(),
  institutionName: z.string().optional(),
  accountNumber: z.string().optional(),
  isJointlyOwned: z.boolean().optional(),
  jointOwnerName: z.string().optional(),
  vehicleMake: z.string().optional(),
  vehicleModel: z.string().optional(),
  vehicleYear: z.number().int().optional(),
  vehicleFairMarketValue: z.number().optional(),
  vehicleUseType: vehicleUseTypeEnum.optional(),
  propertyDescription: z.string().optional(),
  propertyFairMarketValue: z.number().optional(),
  propertyEquity: z.number().optional(),
  homeEquityValue: z.number().optional(),
  isHomestead: z.boolean().optional(),
  lifeInsuranceFaceValue: z.number().optional(),
  lifeInsuranceCashValue: z.number().optional(),
  burialFundAmount: z.number().optional(),
  burialArrangementValue: z.number().optional(),
  trustType: trustTypeEnum.optional(),
  trustValue: z.number().optional(),
  recentAssetTransfer: z.boolean().optional(),
  transferDate: z.string().optional(),
  transferAmount: z.number().optional(),
  verificationSource: z.string().optional(),
});

export const incomeSchema = z.object({
  type: incomeTypeEnum.optional(),
  grossAmount: z.number().optional(),
  netAmount: z.number().optional(),
  frequency: frequencyEnum.optional(),
  isSeasonalOrIrregular: z.boolean().optional(),
  hoursPerWeek: z.number().int().optional(),
  employerName: z.string().optional(),
  employerStreet: z.string().optional(),
  employerCity: z.string().optional(),
  employerState: z.string().optional(),
  employerZip: z.string().optional(),
  tipsAndCommissions: z.number().optional(),
  businessExpenses: z.number().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  verificationSource: verificationSourceEnum.optional(),
});

export const personSchema = z.object({
  firstName: z.string().optional(),
  middleName: z.string().optional(),
  lastName: z.string().optional(),
  suffix: z.string().optional(),
  dateOfBirth: z.string().optional(),
  ssn: z.string().optional(),
  gender: genderEnum.optional(),
  race: z.array(raceEnum).optional(),
  ethnicity: ethnicityEnum.optional(),
  relationshipToApplicant: relationshipEnum.optional(),
  maritalStatus: maritalStatusEnum.optional(),
  isApplicant: z.boolean().optional(),
  citizenshipStatus: citizenshipStatusEnum.optional(),
  immigrationDocumentType: immigrationDocumentTypeEnum.optional(),
  immigrationDocumentNumber: z.string().optional(),
  alienRegistrationNumber: z.string().optional(),
  dateOfEntryToUS: z.string().optional(),
  qualifiedAlienCategory: qualifiedAlienCategoryEnum.optional(),
  isPregnant: z.boolean().optional(),
  expectedDueDate: z.string().optional(),
  numberOfExpectedChildren: z.number().int().optional(),
  isBreastfeeding: z.boolean().optional(),
  deliveryDate: z.string().optional(),
  isPostpartum: z.boolean().optional(),
  wicParticipantCategory: wicParticipantCategoryEnum.optional(),
  nutritionalRiskLevel: nutritionalRiskLevelEnum.optional(),
  nutritionalRiskConditions: z.array(nutritionalRiskConditionsEnum).optional(),
  isInFosterCare: z.boolean().optional(),
  isFormerFosterYouth: z.boolean().optional(),
  isEnrolledInSchool: z.boolean().optional(),
  schoolName: z.string().optional(),
  schoolDistrict: z.string().optional(),
  gradeLevel: gradeLevelEnum.optional(),
  isMigrantYouth: z.boolean().optional(),
  isRunawayYouth: z.boolean().optional(),
  isHeadStartParticipant: z.boolean().optional(),
  age: z.number().int().optional(),
  isSchoolAge: z.boolean().optional(),
  isElderlyOrDisabled: z.boolean().optional(),
  isAbawdEligible: z.boolean().optional(),
  disabilityStatus: z.boolean().optional(),
  disabilityType: z.string().optional(),
  meetsGainfulActivityTest: z.boolean().optional(),
  disabilityDuration: z.boolean().optional(),
  isBlind: z.boolean().optional(),
  employerInsuranceAvailable: z.boolean().optional(),
  employerInsuranceAffordable: z.boolean().optional(),
  veteranStatus: z.boolean().optional(),
  isIndianTribalMember: z.boolean().optional(),
  isStudent: z.boolean().optional(),
  studentWorkStudy: z.boolean().optional(),
  studentEmployedMinHours: z.boolean().optional(),
  studentExemptionReason: studentExemptionReasonEnum.optional(),
  employmentStatus: employmentStatusEnum.optional(),
  snapWorkRegistered: z.boolean().optional(),
  snapWorkRegistrationExempt: z.boolean().optional(),
  abawdWorkHoursPerWeek: z.number().int().optional(),
  abawdCountableMonths: z.number().int().optional(),
  abawdExemptionReason: abawdExemptionReasonEnum.optional(),
  medicaidWorkExemptionReason: medicaidWorkExemptionReasonEnum.optional(),
  medicaidWorkHoursPerMonth: z.number().int().optional(),
  medicaidEnrollmentGroup: medicaidEnrollmentGroupEnum.optional(),
  tanfMonthsUsed: z.number().int().optional(),
  tanfSanctionStatus: tanfSanctionStatusEnum.optional(),
  tanfTotalWorkHoursPerWeek: z.number().int().optional(),
  twoParentFamily: z.boolean().optional(),
  tanfCooperatesWithChildSupport: z.boolean().optional(),
  tanfChildSupportGoodCause: z.boolean().optional(),
  isMinorParent: z.boolean().optional(),
  minorParentLivingArrangement: minorParentLivingArrangementEnum.optional(),
  goodCauseExemptionFromWork: z.boolean().optional(),
  goodCauseExemptionReason: goodCauseExemptionReasonEnum.optional(),
  fleeingFelonStatus: z.boolean().optional(),
  drugFelonyConviction: z.boolean().optional(),
  drugFelonyConvictionDate: z.string().optional(),
  ipvHistory: z.boolean().optional(),
  ipvDisqualificationEndDate: z.string().optional(),
  strikerStatus: z.boolean().optional(),
  institutionalStatus: institutionalStatusEnum.optional(),
  expectedReleaseDate: z.string().optional(),
  needsLongTermCare: z.boolean().optional(),
  levelOfCareAssessment: levelOfCareAssessmentEnum.optional(),
  spouseIsInstitutionalized: z.boolean().optional(),
  institutionalizationDate: z.string().optional(),
  sexOffenderRegistryStatus: z.boolean().optional(),
  drugRelatedCriminalActivity: z.boolean().optional(),
  methamphetamineProductionConviction: z.boolean().optional(),
  violentCriminalActivity: z.boolean().optional(),
  alcoholAbusePattern: z.boolean().optional(),
  priorEvictionFromPublicHousing: z.boolean().optional(),
  priorEvictionDate: z.string().optional(),
  receivesOtherBenefits: z.boolean().optional(),
  deemedIncomeFromSpouse: z.number().optional(),
  deemedIncomeFromParent: z.number().optional(),
  deemedIncomeFromSponsor: z.number().optional(),
  deemedResourcesFromParent: z.number().optional(),
  deemedResourcesFromSpouse: z.number().optional(),
  taxFilingStatus: taxFilingStatusEnum.optional(),
  taxFilingJointly: z.boolean().optional(),
  taxClaimedAsDependent: z.boolean().optional(),
  taxClaimedByPersonId: z.string().optional(),
  taxClaimsDependents: z.boolean().optional(),
  incomes: z.array(incomeSchema).optional(),
  assets: z.array(assetSchema).optional(),
  expenses: z.array(expenseSchema).optional(),
  medicaidBuyInEligible: z.boolean().optional(),
  medicaidBuyInEmploymentVerified: z.boolean().optional(),
  coStateSupplementAmount: z.number().optional(),
  childCareNeeded: z.boolean().optional(),
  cbmsClientId: z.string().optional(),
});

export const householdSchema = z.object({
  size: z.number().int().optional(),
  purchasePrepareFoodTogether: z.boolean().optional(),
  livingArrangement: livingArrangementEnum.optional(),
  sharedQuartersWithNonMembers: z.boolean().optional(),
  isHomeless: z.boolean().optional(),
  stateResidencySinceDate: z.string().optional(),
  previousHousingAssistance: z.boolean().optional(),
  familyType: familyTypeEnum.optional(),
  energySupplierName: z.string().optional(),
  energySupplierAccountNumber: z.string().optional(),
  primaryHeatingFuelType: primaryHeatingFuelTypeEnum.optional(),
  primaryContactPhone: z.string().optional(),
  primaryContactEmail: z.string().optional(),
  preferredLanguage: preferredLanguageEnum.optional(),
  physicalAddress: z.object({
    street1: z.string().optional(),
    street2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    county: z.string().optional(),
    zip: z.string().optional(),
  }).optional(),
  mailingAddress: z.object({
    street1: z.string().optional(),
    street2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  }).optional(),
  shelterCosts: z.object({
    rent: z.number().optional(),
    mortgage: z.number().optional(),
    propertyTax: z.number().optional(),
    insurance: z.number().optional(),
  }).optional(),
  utilityCosts: z.object({
    heating: z.number().optional(),
    electric: z.number().optional(),
    gas: z.number().optional(),
    water: z.number().optional(),
    telephone: z.number().optional(),
  }).optional(),
  members: z.array(personSchema).optional(),
  leapHeatingSeasonActive: z.boolean().optional(),
  countyOfficeCode: z.string().optional(),
  coloradoResidencyVerified: z.boolean().optional(),
});

// =============================================================================
// Application schemas
// =============================================================================

export const applicationCreateSchema = z.object({
  applicationDate: z.string().optional(),
  programsAppliedFor: z.array(programEnum).optional(),
  isExpedited: z.boolean().optional(),
  signatureOfApplicant: z.boolean().optional(),
  signatureDate: z.string().optional(),
  signatureMethod: signatureMethodEnum.optional(),
  rightsAndResponsibilitiesAcknowledged: z.boolean().optional(),
  penaltyOfPerjuryAcknowledged: z.boolean().optional(),
  consentToVerifyInformation: z.boolean().optional(),
  consentToShareData: z.boolean().optional(),
  voterRegistrationOffered: z.boolean().optional(),
  voterRegistrationResponse: voterRegistrationResponseEnum.optional(),
  noticeDeliveryPreference: noticeDeliveryPreferenceEnum.optional(),
  paymentMethodPreference: paymentMethodPreferenceEnum.optional(),
  accommodationNeeded: z.boolean().optional(),
  accommodationType: accommodationTypeEnum.optional(),
  household: householdSchema,
  peakConfirmationNumber: z.string().optional(),
}).describe('colorado-benefits-schema/ApplicationCreate');

export type ApplicationCreate = z.infer<typeof applicationCreateSchema>;

export const applicationUpdateSchema = applicationCreateSchema.partial().describe('colorado-benefits-schema/ApplicationUpdate');

export type ApplicationUpdate = z.infer<typeof applicationUpdateSchema>;
