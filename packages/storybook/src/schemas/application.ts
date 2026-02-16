import { z } from 'zod';

// =============================================================================
// Enums (derived from federal benefits data model CSV)
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

export const genderEnum = z.enum(['male', 'female', 'unknown']);

export const raceEnum = z.enum([
  'american_indian_alaskan_native',
  'asian',
  'black_african_american',
  'native_hawaiian_pacific_islander',
  'white',
]);

export const ethnicityEnum = z.enum(['hispanic_or_latino', 'not_hispanic_or_latino']);

export const citizenshipStatusEnum = z.enum([
  'citizen',
  'permanent_resident',
  'qualified_non_citizen',
  'undocumented',
  'other',
]);

export const maritalStatusEnum = z.enum([
  'single',
  'married',
  'divorced',
  'separated',
  'widowed',
  'civil_union',
  'domestic_partnership',
]);

export const relationshipEnum = z.enum([
  'self',
  'spouse',
  'child',
  'parent',
  'sibling',
  'other',
]);

export const livingArrangementEnum = z.enum([
  'own',
  'rent',
  'homeless',
  'living_with_others',
  'other',
]);

export const incomeTypeEnum = z.enum([
  'wages',
  'self_employment',
  'social_security',
  'ssi',
  'unemployment',
  'child_support',
  'alimony',
  'pension',
  'veterans_benefits',
  'workers_comp',
  'rental_income',
  'interest_dividends',
  'other',
]);

export const assetTypeEnum = z.enum([
  'checking_account',
  'savings_account',
  'cash',
  'stocks_bonds',
  'vehicle',
  'real_estate',
  'retirement_account',
  'life_insurance',
  'burial_fund',
  'other',
]);

export const frequencyEnum = z.enum([
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'annually',
]);

export const noticeDeliveryPreferenceEnum = z.enum(['mail', 'email', 'both']);

// =============================================================================
// Sub-schemas
// =============================================================================

export const addressSchema = z.object({
  street1: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(2).optional(),
  county: z.string().max(100).optional(),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Must be 5 or 9 digit ZIP').optional(),
});

export const mailingAddressSchema = z.object({
  street1: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(2).optional(),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Must be 5 or 9 digit ZIP').optional(),
});

export const incomeSchema = z.object({
  type: incomeTypeEnum.optional(),
  grossAmount: z.number().min(0).optional(),
  frequency: frequencyEnum.optional(),
  employerName: z.string().max(200).optional(),
});

export const assetSchema = z.object({
  type: assetTypeEnum.optional(),
  value: z.number().min(0).optional(),
  institutionName: z.string().max(200).optional(),
});

export const memberSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  middleName: z.string().max(100).optional(),
  lastName: z.string().min(1, 'Last name is required').max(100),
  suffix: z.string().max(10).optional(),
  dateOfBirth: z.string().optional(),
  ssn: z
    .string()
    .regex(/^\d{3}-\d{2}-\d{4}$/, 'Must be in XXX-XX-XXXX format')
    .optional(),
  gender: genderEnum.optional(),
  race: z.array(raceEnum).optional(),
  ethnicity: ethnicityEnum.optional(),
  relationshipToApplicant: relationshipEnum.optional(),
  maritalStatus: maritalStatusEnum.optional(),
  isApplicant: z.boolean().optional(),
  citizenshipStatus: citizenshipStatusEnum.optional(),
  immigrationDocumentType: z.string().max(100).optional(),
  immigrationDocumentNumber: z.string().max(100).optional(),
  alienOrI94Number: z.string().max(100).optional(),
  immigrationDocumentExpiration: z.string().optional(),
  isPregnant: z.boolean().optional(),
  expectedDueDate: z.string().optional(),
  disabilityStatus: z.boolean().optional(),
  employmentStatus: z.string().max(100).optional(),
  incomes: z.array(incomeSchema).optional(),
  assets: z.array(assetSchema).optional(),
});

export const shelterCostsSchema = z.object({
  rent: z.number().min(0).optional(),
  mortgage: z.number().min(0).optional(),
  propertyTax: z.number().min(0).optional(),
  insurance: z.number().min(0).optional(),
});

export const utilityCostsSchema = z.object({
  heating: z.number().min(0).optional(),
  electric: z.number().min(0).optional(),
  water: z.number().min(0).optional(),
  telephone: z.number().min(0).optional(),
});

export const householdSchema = z.object({
  size: z.number().int().min(1).optional(),
  purchasePrepareFoodTogether: z.boolean().optional(),
  livingArrangement: livingArrangementEnum.optional(),
  isHomeless: z.boolean().optional(),
  physicalAddress: addressSchema.optional(),
  mailingAddress: mailingAddressSchema.optional(),
  shelterCosts: shelterCostsSchema.optional(),
  utilityCosts: utilityCostsSchema.optional(),
  primaryContactPhone: z
    .string()
    .regex(/^\+?[0-9 .\-()]{7,20}$/, 'Invalid phone number')
    .optional(),
  primaryContactEmail: z.string().email('Invalid email address').max(320).optional(),
  preferredLanguage: z.string().max(50).optional(),
  members: z.array(memberSchema).min(1, 'At least one household member is required'),
});

// =============================================================================
// Application schemas
// =============================================================================

export const applicationCreateSchema = z.object({
  applicationDate: z.string().optional(),
  programsAppliedFor: z.array(programEnum).min(1, 'Select at least one program'),
  isExpedited: z.boolean().optional(),
  household: householdSchema,
  consentToVerifyInformation: z.boolean().optional(),
  consentToShareData: z.boolean().optional(),
  signatureOfApplicant: z.string().max(200).optional(),
  signatureDate: z.string().optional(),
  noticeDeliveryPreference: noticeDeliveryPreferenceEnum.optional(),
  accommodationNeeded: z.string().max(500).optional(),
});

export type ApplicationCreate = z.infer<typeof applicationCreateSchema>;

export const applicationUpdateSchema = applicationCreateSchema.partial();

export type ApplicationUpdate = z.infer<typeof applicationUpdateSchema>;
