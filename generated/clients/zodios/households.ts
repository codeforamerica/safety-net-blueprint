import { makeApi, Zodios, type ZodiosOptions } from "@zodios/core";
import { z } from "zod";

const createHousehold_Body = z
  .object({
    id: z.string().uuid(),
    homeAddress: z.object({
      addressLine1: z.string().min(1).max(150),
      addressLine2: z.string().max(150).optional(),
      city: z.string().min(1).max(100),
      stateProvince: z.string().min(1).max(100),
      postalCode: z.string().min(3).max(20),
      county: z.string().max(100).optional(),
    }),
    mailingAddress: z
      .object({
        addressLine1: z.string().min(1).max(150),
        addressLine2: z.string().max(150).optional(),
        city: z.string().min(1).max(100),
        stateProvince: z.string().min(1).max(100),
        postalCode: z.string().min(3).max(20),
        county: z.string().max(100).optional(),
      })
      .optional(),
    phoneNumber: z
      .string()
      .regex(/^\+?[0-9 .\-()]{7,20}$/)
      .optional(),
    members: z
      .array(
        z.object({
          personId: z.string().uuid(),
          relationship: z.enum([
            "head_of_household",
            "spouse",
            "husband",
            "wife",
            "partner",
            "child",
            "parent",
            "sibling",
            "grandparent",
            "grandchild",
            "other_relative",
            "non_relative",
          ]),
        })
      )
      .min(1),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .and(z.object({}).partial().passthrough());

export const schemas = {
  createHousehold_Body,
};

const endpoints = makeApi([
  {
    method: "get",
    path: "/households",
    alias: "listHouseholds",
    description: `Retrieve a paginated list of households.`,
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
    ],
    response: z.object({
      items: z.array(
        z.object({
          id: z.string().uuid(),
          homeAddress: z.object({
            addressLine1: z.string().min(1).max(150),
            addressLine2: z.string().max(150).optional(),
            city: z.string().min(1).max(100),
            stateProvince: z.string().min(1).max(100),
            postalCode: z.string().min(3).max(20),
            county: z.string().max(100).optional(),
          }),
          mailingAddress: z
            .object({
              addressLine1: z.string().min(1).max(150),
              addressLine2: z.string().max(150).optional(),
              city: z.string().min(1).max(100),
              stateProvince: z.string().min(1).max(100),
              postalCode: z.string().min(3).max(20),
              county: z.string().max(100).optional(),
            })
            .optional(),
          phoneNumber: z
            .string()
            .regex(/^\+?[0-9 .\-()]{7,20}$/)
            .optional(),
          members: z
            .array(
              z.object({
                personId: z.string().uuid(),
                relationship: z.enum([
                  "head_of_household",
                  "spouse",
                  "husband",
                  "wife",
                  "partner",
                  "child",
                  "parent",
                  "sibling",
                  "grandparent",
                  "grandchild",
                  "other_relative",
                  "non_relative",
                ]),
              })
            )
            .min(1),
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
    path: "/households",
    alias: "createHousehold",
    description: `Create a new household record.`,
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: createHousehold_Body,
      },
    ],
    response: z.object({
      id: z.string().uuid(),
      homeAddress: z.object({
        addressLine1: z.string().min(1).max(150),
        addressLine2: z.string().max(150).optional(),
        city: z.string().min(1).max(100),
        stateProvince: z.string().min(1).max(100),
        postalCode: z.string().min(3).max(20),
        county: z.string().max(100).optional(),
      }),
      mailingAddress: z
        .object({
          addressLine1: z.string().min(1).max(150),
          addressLine2: z.string().max(150).optional(),
          city: z.string().min(1).max(100),
          stateProvince: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          county: z.string().max(100).optional(),
        })
        .optional(),
      phoneNumber: z
        .string()
        .regex(/^\+?[0-9 .\-()]{7,20}$/)
        .optional(),
      members: z
        .array(
          z.object({
            personId: z.string().uuid(),
            relationship: z.enum([
              "head_of_household",
              "spouse",
              "husband",
              "wife",
              "partner",
              "child",
              "parent",
              "sibling",
              "grandparent",
              "grandchild",
              "other_relative",
              "non_relative",
            ]),
          })
        )
        .min(1),
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
    path: "/households/:householdId",
    alias: "getHousehold",
    description: `Retrieve a single household by identifier.`,
    requestFormat: "json",
    parameters: [
      {
        name: "householdId",
        type: "Path",
        schema: z.string().uuid(),
      },
    ],
    response: z.object({
      id: z.string().uuid(),
      homeAddress: z.object({
        addressLine1: z.string().min(1).max(150),
        addressLine2: z.string().max(150).optional(),
        city: z.string().min(1).max(100),
        stateProvince: z.string().min(1).max(100),
        postalCode: z.string().min(3).max(20),
        county: z.string().max(100).optional(),
      }),
      mailingAddress: z
        .object({
          addressLine1: z.string().min(1).max(150),
          addressLine2: z.string().max(150).optional(),
          city: z.string().min(1).max(100),
          stateProvince: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          county: z.string().max(100).optional(),
        })
        .optional(),
      phoneNumber: z
        .string()
        .regex(/^\+?[0-9 .\-()]{7,20}$/)
        .optional(),
      members: z
        .array(
          z.object({
            personId: z.string().uuid(),
            relationship: z.enum([
              "head_of_household",
              "spouse",
              "husband",
              "wife",
              "partner",
              "child",
              "parent",
              "sibling",
              "grandparent",
              "grandchild",
              "other_relative",
              "non_relative",
            ]),
          })
        )
        .min(1),
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
    path: "/households/:householdId",
    alias: "updateHousehold",
    description: `Apply partial updates to an existing household.`,
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: createHousehold_Body,
      },
      {
        name: "householdId",
        type: "Path",
        schema: z.string().uuid(),
      },
    ],
    response: z.object({
      id: z.string().uuid(),
      homeAddress: z.object({
        addressLine1: z.string().min(1).max(150),
        addressLine2: z.string().max(150).optional(),
        city: z.string().min(1).max(100),
        stateProvince: z.string().min(1).max(100),
        postalCode: z.string().min(3).max(20),
        county: z.string().max(100).optional(),
      }),
      mailingAddress: z
        .object({
          addressLine1: z.string().min(1).max(150),
          addressLine2: z.string().max(150).optional(),
          city: z.string().min(1).max(100),
          stateProvince: z.string().min(1).max(100),
          postalCode: z.string().min(3).max(20),
          county: z.string().max(100).optional(),
        })
        .optional(),
      phoneNumber: z
        .string()
        .regex(/^\+?[0-9 .\-()]{7,20}$/)
        .optional(),
      members: z
        .array(
          z.object({
            personId: z.string().uuid(),
            relationship: z.enum([
              "head_of_household",
              "spouse",
              "husband",
              "wife",
              "partner",
              "child",
              "parent",
              "sibling",
              "grandparent",
              "grandchild",
              "other_relative",
              "non_relative",
            ]),
          })
        )
        .min(1),
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
    path: "/households/:householdId",
    alias: "deleteHousehold",
    description: `Permanently remove a household record.`,
    requestFormat: "json",
    parameters: [
      {
        name: "householdId",
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
