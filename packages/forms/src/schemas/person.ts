import { z } from 'zod';

/**
 * Hand-written Zod schema for the Person fields used in the steel thread.
 * Matches the PersonCreate OpenAPI schema shape for the fields covered
 * by the person-intake form contract (3 pages).
 *
 * This will be replaced by the generated schema once the full pipeline is wired.
 */
export const personCreateSchema = z.object({
  name: z.object({
    firstName: z.string().min(1, 'First name is required').max(100),
    lastName: z.string().min(1, 'Last name is required').max(100),
  }),
  dateOfBirth: z.string().optional(),
  socialSecurityNumber: z
    .string()
    .regex(/^\d{3}-\d{2}-\d{4}$/, 'Must be in XXX-XX-XXXX format')
    .optional(),
  phoneNumber: z
    .string()
    .regex(/^\+?[0-9 .\-()]{7,20}$/, 'Invalid phone number')
    .optional(),
  email: z.string().email('Invalid email address').max(320).optional(),
  demographicInfo: z
    .object({
      sex: z.enum(['male', 'female', 'unknown']).optional(),
      maritalStatus: z
        .enum([
          'single',
          'married',
          'divorced',
          'separated',
          'widowed',
          'civil_union',
          'domestic_partnership',
        ])
        .optional(),
      isHispanicOrLatino: z.boolean().optional(),
      race: z
        .array(
          z.enum([
            'american_indian_alaskan_native',
            'asian',
            'black_african_american',
            'native_hawaiian_pacific_islander',
            'white',
          ]),
        )
        .optional(),
    })
    .optional(),
  citizenshipInfo: z
    .object({
      status: z
        .enum([
          'citizen',
          'permanent_resident',
          'qualified_non_citizen',
          'undocumented',
          'other',
        ])
        .optional(),
      immigrationInfo: z
        .object({
          documentType: z.string().max(100).optional(),
          documentNumber: z.string().max(100).optional(),
          alienOrI94Number: z.string().max(100).optional(),
          documentExpirationDate: z.string().optional(),
          hasSponsor: z.boolean().optional(),
          sponsor: z
            .object({
              name: z.object({
                firstName: z.string().max(100).optional(),
                lastName: z.string().max(100).optional(),
              }).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

export type PersonCreate = z.infer<typeof personCreateSchema>;
