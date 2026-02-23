#!/usr/bin/env node
/**
 * API Template Generator
 *
 * Generates a new OpenAPI spec with all established patterns pre-applied.
 *
 * Usage:
 *   npm run api:new -- --name "benefits" --resource "Benefit"
 *   npm run api:new -- --name "case-workers" --resource "CaseWorker"
 *
 * Generates:
 *   - {name}-openapi.yaml - Main API spec (with schemas inline)
 *   - {name}-openapi-examples.yaml - Example data
 */

import { writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    name: null,
    resource: null,
    out: null,
    help: false
  };

  const positional = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--name':
      case '-n':
        options.name = args[++i];
        break;
      case '--resource':
      case '-r':
        options.resource = args[++i];
        break;
      case '--out':
      case '-o':
        options.out = args[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (!args[i].startsWith('-')) {
          positional.push(args[i]);
        }
        break;
    }
  }

  // Fall back to positional args: api:new -- pizza-shop Pizza
  if (!options.name && positional.length >= 1) options.name = positional[0];
  if (!options.resource && positional.length >= 2) options.resource = positional[1];

  return options;
}

function showHelp() {
  console.log(`
API Template Generator

Generates a new OpenAPI spec with all established patterns pre-applied.

Usage:
  npm run api:new -- --name <api-name> --resource <ResourceName>
  npm run api:new -- <api-name> <ResourceName>

Options:
  -n, --name <name>        API name in kebab-case (e.g., "benefits", "case-workers")
  -r, --resource <name>    Resource name in PascalCase (e.g., "Benefit", "CaseWorker")
  -o, --out <dir>          Output directory (default: packages/contracts/)
  -h, --help               Show this help message

Examples:
  npm run api:new -- --name benefits --resource Benefit
  npm run api:new -- benefits Benefit
  npm run api:new -- benefits Benefit --out /tmp

Generated files:
  - {name}-openapi.yaml              Main API specification (schemas inline)
  - {name}-openapi-examples.yaml     Example data for testing
`);
}

// =============================================================================
// Name Utilities
// =============================================================================

function toKebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function toCamelCase(str) {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toPascalCase(str) {
  return str
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

function pluralize(str) {
  // Simple pluralization - works for most cases
  if (str.endsWith('y')) {
    return str.slice(0, -1) + 'ies';
  }
  if (str.endsWith('s') || str.endsWith('x') || str.endsWith('ch') || str.endsWith('sh')) {
    return str + 'es';
  }
  return str + 's';
}

// =============================================================================
// Template Generators
// =============================================================================

function generateApiSpec(name, resource) {
  const kebabName = toKebabCase(name);
  const resourcePlural = pluralize(resource);
  const resourcePluralLower = resourcePlural.toLowerCase();
  const resourceIdParam = `${toCamelCase(resource)}Id`;

  return `openapi: 3.1.0
info:
  title: ${resource} Service API
  version: 1.0.0
  description: |
    REST API for managing ${resourcePluralLower}. The specification defines CRUD operations
    for creating, reading, updating, and deleting ${resourcePluralLower}.
  contact:
    name: API Support
    email: support@example.com
servers:
- url: https://api.example.com
  description: Production server
- url: http://localhost:8080
  description: Local development server
tags:
- name: ${resourcePlural}
  description: Manage ${resourcePluralLower}.
paths:
  "/${resourcePluralLower}":
    get:
      summary: List ${resourcePluralLower}
      description: Retrieve a paginated list of ${resourcePluralLower}.
      operationId: list${resourcePlural}
      tags:
      - ${resourcePlural}
      parameters:
      - "$ref": "./components/parameters.yaml#/SearchQueryParam"
      - "$ref": "./components/parameters.yaml#/LimitParam"
      - "$ref": "./components/parameters.yaml#/OffsetParam"
      responses:
        '200':
          description: A paginated collection of ${resourcePluralLower}.
          content:
            application/json:
              schema:
                "$ref": "#/components/schemas/${resource}List"
        '400':
          "$ref": "./components/responses.yaml#/BadRequest"
        '500':
          "$ref": "./components/responses.yaml#/InternalError"
    post:
      summary: Create a ${resource.toLowerCase()}
      description: Create a new ${resource.toLowerCase()} record.
      operationId: create${resource}
      tags:
      - ${resourcePlural}
      requestBody:
        required: true
        content:
          application/json:
            schema:
              "$ref": "#/components/schemas/${resource}Create"
      responses:
        '201':
          description: ${resource} created successfully.
          headers:
            Location:
              description: URL of the newly created ${resource.toLowerCase()} resource.
              schema:
                type: string
                format: uri
          content:
            application/json:
              schema:
                "$ref": "#/components/schemas/${resource}"
        '400':
          "$ref": "./components/responses.yaml#/BadRequest"
        '422':
          "$ref": "./components/responses.yaml#/UnprocessableEntity"
        '500':
          "$ref": "./components/responses.yaml#/InternalError"
  "/${resourcePluralLower}/{${resourceIdParam}}":
    parameters:
    - "$ref": "#/components/parameters/${resource}IdParam"
    get:
      summary: Get a ${resource.toLowerCase()}
      description: Retrieve a single ${resource.toLowerCase()} by identifier.
      operationId: get${resource}
      tags:
      - ${resourcePlural}
      responses:
        '200':
          description: ${resource} retrieved successfully.
          content:
            application/json:
              schema:
                "$ref": "#/components/schemas/${resource}"
              examples:
                ${resource}Example1:
                  "$ref": "./${kebabName}-openapi-examples.yaml#/${resource}Example1"
        '404':
          "$ref": "./components/responses.yaml#/NotFound"
        '500':
          "$ref": "./components/responses.yaml#/InternalError"
    patch:
      summary: Update a ${resource.toLowerCase()}
      description: Apply partial updates to an existing ${resource.toLowerCase()}.
      operationId: update${resource}
      tags:
      - ${resourcePlural}
      requestBody:
        required: true
        content:
          application/json:
            schema:
              "$ref": "#/components/schemas/${resource}Update"
      responses:
        '200':
          description: ${resource} updated successfully.
          content:
            application/json:
              schema:
                "$ref": "#/components/schemas/${resource}"
        '400':
          "$ref": "./components/responses.yaml#/BadRequest"
        '404':
          "$ref": "./components/responses.yaml#/NotFound"
        '422':
          "$ref": "./components/responses.yaml#/UnprocessableEntity"
        '500':
          "$ref": "./components/responses.yaml#/InternalError"
    delete:
      summary: Delete a ${resource.toLowerCase()}
      description: Permanently remove a ${resource.toLowerCase()} record.
      operationId: delete${resource}
      tags:
      - ${resourcePlural}
      responses:
        '204':
          description: ${resource} deleted successfully.
        '404':
          "$ref": "./components/responses.yaml#/NotFound"
        '500':
          "$ref": "./components/responses.yaml#/InternalError"
components:
  parameters:
    ${resource}IdParam:
      name: ${resourceIdParam}
      in: path
      required: true
      description: Unique identifier of the ${resource.toLowerCase()}.
      schema:
        type: string
        format: uuid
      example: 4d1f13f0-3e26-4c50-b2fb-8d140f7ec1c2
  schemas:
    ${resource}:
      type: object
      additionalProperties: false
      required:
        - id
        - name
        - createdAt
        - updatedAt
      properties:
        id:
          type: string
          format: uuid
          readOnly: true
          description: Unique identifier (server-generated).
        name:
          type: string
          minLength: 1
          maxLength: 200
          description: Name of the ${resource.toLowerCase()}.
        description:
          type: string
          maxLength: 1000
          description: Optional description.
        status:
          type: string
          enum:
            - active
            - inactive
            - pending
          description: Current status.
        createdAt:
          type: string
          format: date-time
          readOnly: true
          description: Timestamp when the ${resource.toLowerCase()} was created.
        updatedAt:
          type: string
          format: date-time
          readOnly: true
          description: Timestamp when the ${resource.toLowerCase()} was last updated.
    ${resource}Create:
      allOf:
      - "$ref": "#/components/schemas/${resource}"
      - type: object
        description: |
          Payload to create a new ${resource.toLowerCase()} record.

          Note: id, createdAt, and updatedAt are server-generated (readOnly) and will be returned in the response.
    ${resource}Update:
      allOf:
      - "$ref": "#/components/schemas/${resource}"
      - type: object
        description: |
          Payload to update one or more mutable fields of an existing ${resource.toLowerCase()}. Partial updates are supported.

          Note: id, createdAt, and updatedAt are server-generated (readOnly) and cannot be updated.
        minProperties: 1
    ${resource}List:
      type: object
      additionalProperties: false
      required:
      - items
      - total
      - limit
      - offset
      properties:
        items:
          type: array
          items:
            "$ref": "#/components/schemas/${resource}"
        total:
          type: integer
          minimum: 0
          description: Total number of ${resourcePluralLower} available.
        limit:
          type: integer
          minimum: 1
          maximum: 100
          description: Maximum number of ${resourcePluralLower} requested.
        offset:
          type: integer
          minimum: 0
          description: Number of items skipped before the current page.
        hasNext:
          type: boolean
          description: Indicates whether more ${resourcePluralLower} are available beyond the current page.
`;
}

function generateExamples(name, resource) {
  const uuid1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const uuid2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  const now = new Date().toISOString();

  return `# ${resource} Examples
# Example data for testing and documentation.
# These examples are validated against the schema by npm run validate:syntax

${resource}Example1:
  id: "${uuid1}"
  name: "Example ${resource} 1"
  description: "This is the first example ${resource.toLowerCase()}."
  status: "active"
  createdAt: "${now}"
  updatedAt: "${now}"

${resource}Example2:
  id: "${uuid2}"
  name: "Example ${resource} 2"
  description: "This is the second example ${resource.toLowerCase()}."
  status: "pending"
  createdAt: "${now}"
  updatedAt: "${now}"
`;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (!options.name || !options.resource) {
    console.error('Error: Both --name and --resource are required.\n');
    showHelp();
    process.exit(1);
  }

  const name = toKebabCase(options.name);
  const resource = toPascalCase(options.resource);

  console.log(`\n🚀 Generating API: ${name}`);
  console.log(`   Resource: ${resource}`);
  console.log('');

  // Output to --out dir, or packages/contracts/ by default
  const outDir = options.out || join(import.meta.dirname, '..');
  const specPath = join(outDir, `${name}-openapi.yaml`);
  const examplesPath = join(outDir, `${name}-openapi-examples.yaml`);

  if (existsSync(specPath)) {
    console.error(`Error: ${specPath} already exists.`);
    process.exit(1);
  }

  // Generate files
  console.log('📝 Generating files...\n');

  await writeFile(specPath, generateApiSpec(name, resource));
  console.log(`   ✅ ${specPath}`);

  await writeFile(examplesPath, generateExamples(name, resource));
  console.log(`   ✅ ${examplesPath}`);

  console.log(`
✨ API generated successfully!

Next steps:
  1. Edit ${name}-openapi.yaml to customize your resource schema
  2. Update ${name}-openapi-examples.yaml with realistic example data
  3. Run validation: npm run validate
  4. Generate clients: npm run clients:generate
  5. Start mock server: npm run mock:start
`);
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
