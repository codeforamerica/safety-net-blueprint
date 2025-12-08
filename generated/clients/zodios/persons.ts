import { makeApi, Zodios, type ZodiosOptions } from "@zodios/core";
import { z } from "zod";

const createPerson_Body = z
  .object({
    id: z.string().uuid(),
    name: z.object({
      firstName: z.string().min(1).max(100),
      middleInitial: z.string().max(1).optional(),
      middleName: z.string().max(100).optional(),
      lastName: z.string().min(1).max(100),
      maidenName: z.string().max(100).optional(),
    }),
    email: z.string().max(320).email(),
    socialSecurityNumber: z
      .string()
      .regex(/^\d{3}-\d{2}-\d{4}$/)
      .optional(),
    dateOfBirth: z.string(),
    gender: z.enum(["male", "female", "unknown"]).optional(),
    phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
    address: z
      .object({
        addressLine1: z.string().min(1).max(150),
        addressLine2: z.string().max(150).optional(),
        city: z.string().min(1).max(100),
        stateProvince: z.string().min(1).max(100),
        postalCode: z.string().min(3).max(20),
        county: z.string().max(100).optional(),
      })
      .optional(),
    citizenshipStatus: z.enum([
      "citizen",
      "permanent_resident",
      "qualified_non_citizen",
      "undocumented",
      "other",
    ]),
    maritalStatus: z
      .enum(["single", "married", "divorced", "widowed", "separated"])
      .optional(),
    householdSize: z.number().int().gte(1),
    householdId: z.string().uuid().optional(),
    employmentStatus: z
      .enum([
        "employed_full_time",
        "employed_part_time",
        "self_employed",
        "unemployed",
        "retired",
        "student",
      ])
      .optional(),
    employerName: z.string().max(150).optional(),
    monthlyIncome: z.number().gte(0),
    incomeSources: z
      .array(
        z.enum([
          "employment",
          "self_employment",
          "unemployment_benefits",
          "social_security",
          "disability_benefits",
          "child_support",
          "alimony",
          "pension",
          "other",
        ])
      )
      .optional(),
    housingStatus: z
      .enum([
        "renting",
        "own_home",
        "staying_with_family_or_friends",
        "shelter",
        "unhoused",
        "other",
      ])
      .optional(),
    languagePreference: z
      .string()
      .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/)
      .optional(),
    disabilityStatus: z.boolean().optional(),
    veteranStatus: z.boolean().optional(),
    preferredContactMethod: z
      .enum(["phone", "email", "mail", "sms"])
      .optional(),
    consentToShareInformation: z.boolean().optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .and(z.object({}).partial().passthrough());

export const schemas = {
  createPerson_Body,
};

const endpoints = makeApi([
  {
    method: "get",
    path: "/persons",
    alias: "listPersons",
    description: `Retrieve a paginated list of persons.`,
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
        name: "search",
        type: "Query",
        schema: z.string().min(1).optional(),
      },
    ],
    response: z.object({
      items: z.array(
        z.object({
          id: z.string().uuid(),
          name: z.object({
            firstName: z.string().min(1).max(100),
            middleInitial: z.string().max(1).optional(),
            middleName: z.string().max(100).optional(),
            lastName: z.string().min(1).max(100),
            maidenName: z.string().max(100).optional(),
          }),
          email: z.string().max(320).email(),
          socialSecurityNumber: z
            .string()
            .regex(/^\d{3}-\d{2}-\d{4}$/)
            .optional(),
          dateOfBirth: z.string(),
          gender: z.enum(["male", "female", "unknown"]).optional(),
          phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
          address: z
            .object({
              addressLine1: z.string().min(1).max(150),
              addressLine2: z.string().max(150).optional(),
              city: z.string().min(1).max(100),
              stateProvince: z.string().min(1).max(100),
              postalCode: z.string().min(3).max(20),
              county: z.string().max(100).optional(),
            })
            .optional(),
          citizenshipStatus: z.enum([
            "citizen",
            "permanent_resident",
            "qualified_non_citizen",
            "undocumented",
            "other",
          ]),
          maritalStatus: z
            .enum(["single", "married", "divorced", "widowed", "separated"])
            .optional(),
          householdSize: z.number().int().gte(1),
          householdId: z.string().uuid().optional(),
          employmentStatus: z
            .enum([
              "employed_full_time",
              "employed_part_time",
              "self_employed",
              "unemployed",
              "retired",
              "student",
            ])
            .optional(),
          employerName: z.string().max(150).optional(),
          monthlyIncome: z.number().gte(0),
          incomeSources: z
            .array(
              z.enum([
                "employment",
                "self_employment",
                "unemployment_benefits",
                "social_security",
                "disability_benefits",
                "child_support",
                "alimony",
                "pension",
                "other",
              ])
            )
            .optional(),
          housingStatus: z
            .enum([
              "renting",
              "own_home",
              "staying_with_family_or_friends",
              "shelter",
              "unhoused",
              "other",
            ])
            .optional(),
          languagePreference: z
            .string()
            .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/)
            .optional(),
          disabilityStatus: z.boolean().optional(),
          veteranStatus: z.boolean().optional(),
          preferredContactMethod: z
            .enum(["phone", "email", "mail", "sms"])
            .optional(),
          consentToShareInformation: z.boolean().optional(),
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
    path: "/persons",
    alias: "createPerson",
    description: `Create a new person record.`,
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: createPerson_Body,
      },
    ],
    response: z.object({
      id: z.string().uuid(),
      name: z.object({
        firstName: z.string().min(1).max(100),
        middleInitial: z.string().max(1).optional(),
        middleName: z.string().max(100).optional(),
        lastName: z.string().min(1).max(100),
        maidenName: z.string().max(100).optional(),
      }),
      email: z.string().max(320).email(),
      socialSecurityNumber: z
        .string()
        .regex(/^\d{3}-\d{2}-\d{4}$/)
        .optional(),
      dateOfBirth: z.string(),
      gender: z.enum(["male", "female", "unknown"]).optional(),
      phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
      address: z
        .object({
          addressLine1: z.string().min(1).max(150),
          addressLine2: z.string().max(150).optional(),
          city: z.string().min(1).max(100),
          stateProvince: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          county: z.string().max(100).optional(),
        })
        .optional(),
      citizenshipStatus: z.enum([
        "citizen",
        "permanent_resident",
        "qualified_non_citizen",
        "undocumented",
        "other",
      ]),
      maritalStatus: z
        .enum(["single", "married", "divorced", "widowed", "separated"])
        .optional(),
      householdSize: z.number().int().gte(1),
      householdId: z.string().uuid().optional(),
      employmentStatus: z
        .enum([
          "employed_full_time",
          "employed_part_time",
          "self_employed",
          "unemployed",
          "retired",
          "student",
        ])
        .optional(),
      employerName: z.string().max(150).optional(),
      monthlyIncome: z.number().gte(0),
      incomeSources: z
        .array(
          z.enum([
            "employment",
            "self_employment",
            "unemployment_benefits",
            "social_security",
            "disability_benefits",
            "child_support",
            "alimony",
            "pension",
            "other",
          ])
        )
        .optional(),
      housingStatus: z
        .enum([
          "renting",
          "own_home",
          "staying_with_family_or_friends",
          "shelter",
          "unhoused",
          "other",
        ])
        .optional(),
      languagePreference: z
        .string()
        .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/)
        .optional(),
      disabilityStatus: z.boolean().optional(),
      veteranStatus: z.boolean().optional(),
      preferredContactMethod: z
        .enum(["phone", "email", "mail", "sms"])
        .optional(),
      consentToShareInformation: z.boolean().optional(),
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
        status: 409,
        description: `A conflict occurred with the current state of the resource.`,
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
    path: "/persons/:personId",
    alias: "getPerson",
    description: `Retrieve a single person by identifier.`,
    requestFormat: "json",
    parameters: [
      {
        name: "personId",
        type: "Path",
        schema: z.string().uuid(),
      },
    ],
    response: z.object({
      id: z.string().uuid(),
      name: z.object({
        firstName: z.string().min(1).max(100),
        middleInitial: z.string().max(1).optional(),
        middleName: z.string().max(100).optional(),
        lastName: z.string().min(1).max(100),
        maidenName: z.string().max(100).optional(),
      }),
      email: z.string().max(320).email(),
      socialSecurityNumber: z
        .string()
        .regex(/^\d{3}-\d{2}-\d{4}$/)
        .optional(),
      dateOfBirth: z.string(),
      gender: z.enum(["male", "female", "unknown"]).optional(),
      phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
      address: z
        .object({
          addressLine1: z.string().min(1).max(150),
          addressLine2: z.string().max(150).optional(),
          city: z.string().min(1).max(100),
          stateProvince: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          county: z.string().max(100).optional(),
        })
        .optional(),
      citizenshipStatus: z.enum([
        "citizen",
        "permanent_resident",
        "qualified_non_citizen",
        "undocumented",
        "other",
      ]),
      maritalStatus: z
        .enum(["single", "married", "divorced", "widowed", "separated"])
        .optional(),
      householdSize: z.number().int().gte(1),
      householdId: z.string().uuid().optional(),
      employmentStatus: z
        .enum([
          "employed_full_time",
          "employed_part_time",
          "self_employed",
          "unemployed",
          "retired",
          "student",
        ])
        .optional(),
      employerName: z.string().max(150).optional(),
      monthlyIncome: z.number().gte(0),
      incomeSources: z
        .array(
          z.enum([
            "employment",
            "self_employment",
            "unemployment_benefits",
            "social_security",
            "disability_benefits",
            "child_support",
            "alimony",
            "pension",
            "other",
          ])
        )
        .optional(),
      housingStatus: z
        .enum([
          "renting",
          "own_home",
          "staying_with_family_or_friends",
          "shelter",
          "unhoused",
          "other",
        ])
        .optional(),
      languagePreference: z
        .string()
        .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/)
        .optional(),
      disabilityStatus: z.boolean().optional(),
      veteranStatus: z.boolean().optional(),
      preferredContactMethod: z
        .enum(["phone", "email", "mail", "sms"])
        .optional(),
      consentToShareInformation: z.boolean().optional(),
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
    path: "/persons/:personId",
    alias: "updatePerson",
    description: `Apply partial updates to an existing person.`,
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: createPerson_Body,
      },
      {
        name: "personId",
        type: "Path",
        schema: z.string().uuid(),
      },
    ],
    response: z.object({
      id: z.string().uuid(),
      name: z.object({
        firstName: z.string().min(1).max(100),
        middleInitial: z.string().max(1).optional(),
        middleName: z.string().max(100).optional(),
        lastName: z.string().min(1).max(100),
        maidenName: z.string().max(100).optional(),
      }),
      email: z.string().max(320).email(),
      socialSecurityNumber: z
        .string()
        .regex(/^\d{3}-\d{2}-\d{4}$/)
        .optional(),
      dateOfBirth: z.string(),
      gender: z.enum(["male", "female", "unknown"]).optional(),
      phoneNumber: z.string().regex(/^\+?[0-9 .\-()]{7,20}$/),
      address: z
        .object({
          addressLine1: z.string().min(1).max(150),
          addressLine2: z.string().max(150).optional(),
          city: z.string().min(1).max(100),
          stateProvince: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          county: z.string().max(100).optional(),
        })
        .optional(),
      citizenshipStatus: z.enum([
        "citizen",
        "permanent_resident",
        "qualified_non_citizen",
        "undocumented",
        "other",
      ]),
      maritalStatus: z
        .enum(["single", "married", "divorced", "widowed", "separated"])
        .optional(),
      householdSize: z.number().int().gte(1),
      householdId: z.string().uuid().optional(),
      employmentStatus: z
        .enum([
          "employed_full_time",
          "employed_part_time",
          "self_employed",
          "unemployed",
          "retired",
          "student",
        ])
        .optional(),
      employerName: z.string().max(150).optional(),
      monthlyIncome: z.number().gte(0),
      incomeSources: z
        .array(
          z.enum([
            "employment",
            "self_employment",
            "unemployment_benefits",
            "social_security",
            "disability_benefits",
            "child_support",
            "alimony",
            "pension",
            "other",
          ])
        )
        .optional(),
      housingStatus: z
        .enum([
          "renting",
          "own_home",
          "staying_with_family_or_friends",
          "shelter",
          "unhoused",
          "other",
        ])
        .optional(),
      languagePreference: z
        .string()
        .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/)
        .optional(),
      disabilityStatus: z.boolean().optional(),
      veteranStatus: z.boolean().optional(),
      preferredContactMethod: z
        .enum(["phone", "email", "mail", "sms"])
        .optional(),
      consentToShareInformation: z.boolean().optional(),
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
        status: 409,
        description: `A conflict occurred with the current state of the resource.`,
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
    path: "/persons/:personId",
    alias: "deletePerson",
    description: `Permanently remove a person record.`,
    requestFormat: "json",
    parameters: [
      {
        name: "personId",
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
