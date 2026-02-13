# Creating New APIs

> **Status: Draft**

This guide provides instructions for creating new REST APIs that follow our established patterns. It can be used by developers or AI agents to generate consistent, validated API specifications.

## Quick Start

For simple cases, use the template generator:

```bash
npm run api:new -- --name "benefits" --resource "Benefit"
```

This generates:
- `openapi/benefits.yaml` - Main API spec
- `openapi/components/benefits.yaml` - Resource schema
- `openapi/examples/benefits.yaml` - Example data

Then customize the generated files to match your domain requirements.

---

## Manual Creation Guide

If you need more control or are building a complex API, follow these steps.

### Step 1: Understand the File Structure

```
openapi/
├── {resource-plural}.yaml          # Main API specification
├── components/
│   ├── common.yaml                 # Shared schemas (Address, Name, etc.)
│   ├── common-parameters.yaml      # Shared query parameters
│   ├── common-responses.yaml       # Shared error responses
│   └── {resource-plural}.yaml      # Resource-specific schemas
└── examples/
    └── {resource-plural}.yaml      # Example data for testing
```

### Step 2: Define the Resource Schema

Create `openapi/components/{resource-plural}.yaml`:

```yaml
# {Resource} Schema
{Resource}:
  type: object
  additionalProperties: false
  required:
    - id
    - {required-fields}
    - createdAt
    - updatedAt
  properties:
    # Standard fields (required for all resources)
    id:
      type: string
      format: uuid
      readOnly: true
      description: Unique identifier (server-generated).
    createdAt:
      type: string
      format: date-time
      readOnly: true
      description: Timestamp when the resource was created.
    updatedAt:
      type: string
      format: date-time
      readOnly: true
      description: Timestamp when the resource was last updated.

    # Resource-specific fields
    {fieldName}:
      type: string
      minLength: 1
      maxLength: 200
      description: Description of the field.
      example: "Example value"
```

### Step 3: Create the API Specification

Create `openapi/{resource-plural}.yaml`:

```yaml
openapi: 3.1.0
info:
  title: {Resource} Service API
  version: 1.0.0
  description: |
    REST API for managing {resources}.
  contact:
    name: API Support
    email: support@example.com

servers:
  - url: https://api.example.com
    description: Production server
  - url: http://localhost:8080
    description: Local development server

tags:
  - name: {Resources}
    description: Manage {resources}.

paths:
  "/{resources}":
    get:
      summary: List {resources}
      description: Retrieve a paginated list of {resources}.
      operationId: list{Resources}
      tags:
        - {Resources}
      parameters:
        - "$ref": "./components/common-parameters.yaml#/SearchQueryParam"
        - "$ref": "./components/common-parameters.yaml#/LimitParam"
        - "$ref": "./components/common-parameters.yaml#/OffsetParam"
      responses:
        '200':
          description: A paginated collection of {resources}.
          content:
            application/json:
              schema:
                "$ref": "#/components/schemas/{Resource}List"
        '400':
          "$ref": "./components/common-responses.yaml#/BadRequest"
        '500':
          "$ref": "./components/common-responses.yaml#/InternalError"

    post:
      summary: Create a {resource}
      description: Create a new {resource} record.
      operationId: create{Resource}
      tags:
        - {Resources}
      requestBody:
        required: true
        content:
          application/json:
            schema:
              "$ref": "#/components/schemas/{Resource}Create"
      responses:
        '201':
          description: {Resource} created successfully.
          headers:
            Location:
              description: URL of the newly created resource.
              schema:
                type: string
                format: uri
          content:
            application/json:
              schema:
                "$ref": "#/components/schemas/{Resource}"
        '400':
          "$ref": "./components/common-responses.yaml#/BadRequest"
        '422':
          "$ref": "./components/common-responses.yaml#/UnprocessableEntity"
        '500':
          "$ref": "./components/common-responses.yaml#/InternalError"

  "/{resources}/{resourceId}":
    parameters:
      - "$ref": "#/components/parameters/{Resource}IdParam"

    get:
      summary: Get a {resource}
      description: Retrieve a single {resource} by identifier.
      operationId: get{Resource}
      tags:
        - {Resources}
      responses:
        '200':
          description: {Resource} retrieved successfully.
          content:
            application/json:
              schema:
                "$ref": "#/components/schemas/{Resource}"
        '404':
          "$ref": "./components/common-responses.yaml#/NotFound"
        '500':
          "$ref": "./components/common-responses.yaml#/InternalError"

    patch:
      summary: Update a {resource}
      description: Apply partial updates to an existing {resource}.
      operationId: update{Resource}
      tags:
        - {Resources}
      requestBody:
        required: true
        content:
          application/json:
            schema:
              "$ref": "#/components/schemas/{Resource}Update"
      responses:
        '200':
          description: {Resource} updated successfully.
          content:
            application/json:
              schema:
                "$ref": "#/components/schemas/{Resource}"
        '400':
          "$ref": "./components/common-responses.yaml#/BadRequest"
        '404':
          "$ref": "./components/common-responses.yaml#/NotFound"
        '422':
          "$ref": "./components/common-responses.yaml#/UnprocessableEntity"
        '500':
          "$ref": "./components/common-responses.yaml#/InternalError"

    delete:
      summary: Delete a {resource}
      description: Permanently remove a {resource} record.
      operationId: delete{Resource}
      tags:
        - {Resources}
      responses:
        '204':
          description: {Resource} deleted successfully.
        '404':
          "$ref": "./components/common-responses.yaml#/NotFound"
        '500':
          "$ref": "./components/common-responses.yaml#/InternalError"

components:
  parameters:
    {Resource}IdParam:
      name: {resourceId}
      in: path
      required: true
      description: Unique identifier of the {resource}.
      schema:
        type: string
        format: uuid
      example: 4d1f13f0-3e26-4c50-b2fb-8d140f7ec1c2

  schemas:
    {Resource}:
      "$ref": "./components/{resource-plural}.yaml#{Resource}"

    {Resource}Create:
      allOf:
        - "$ref": "./components/{resource-plural}.yaml#{Resource}"
        - type: object
          description: |
            Payload to create a new {resource}.
            Note: id, createdAt, updatedAt are server-generated.

    {Resource}Update:
      allOf:
        - "$ref": "./components/{resource-plural}.yaml#{Resource}"
        - type: object
          description: |
            Partial update payload. All fields optional.
          minProperties: 1

    {Resource}List:
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
            "$ref": "#/components/schemas/{Resource}"
        total:
          type: integer
          minimum: 0
          description: Total number of {resources} available.
        limit:
          type: integer
          minimum: 1
          maximum: 100
          description: Maximum number of items requested.
        offset:
          type: integer
          minimum: 0
          description: Number of items skipped.
        hasNext:
          type: boolean
          description: Whether more results exist.
```

### Step 4: Create Example Data

Create `openapi/examples/{resource-plural}.yaml`:

```yaml
# {Resource} Examples
{Resource}Example1:
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  {fieldName}: "Example value 1"
  createdAt: "2024-01-15T10:30:00Z"
  updatedAt: "2024-01-15T10:30:00Z"

{Resource}Example2:
  id: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
  {fieldName}: "Example value 2"
  createdAt: "2024-01-16T14:45:00Z"
  updatedAt: "2024-01-16T14:45:00Z"
```

### Step 5: Validate

Run all validation layers:

```bash
npm run validate
```

This runs:
1. **Syntax validation** - OpenAPI 3.1 compliance, $ref resolution, example validation
2. **Lint validation** - Naming conventions, response codes, content types
3. **Pattern validation** - Search params, pagination, list response structure

---

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| File names | kebab-case | `case-workers.yaml` |
| URL paths | kebab-case | `/case-workers` |
| Path parameters | camelCase | `{caseWorkerId}` |
| Query parameters | camelCase | `?sortOrder=desc` |
| Operation IDs | camelCase | `listCaseWorkers` |
| Schema names | PascalCase | `CaseWorker` |
| Property names | camelCase | `firstName` |

---

## Common Field Patterns

### Standard Resource Fields (Required)

Every resource must include:

```yaml
id:
  type: string
  format: uuid
  readOnly: true
  description: Unique identifier (server-generated).

createdAt:
  type: string
  format: date-time
  readOnly: true
  description: Timestamp when created.

updatedAt:
  type: string
  format: date-time
  readOnly: true
  description: Timestamp when last updated.
```

### String Fields

```yaml
name:
  type: string
  minLength: 1
  maxLength: 200
  description: Human-readable name.
  example: "Example Name"
```

### Enum Fields

```yaml
status:
  type: string
  enum:
    - active
    - inactive
    - pending
  description: Current status.
  example: "active"
```

### Date Fields

```yaml
dateOfBirth:
  type: string
  format: date
  description: Date of birth (YYYY-MM-DD).
  example: "1990-05-15"
```

### Monetary Fields

```yaml
amount:
  type: number
  minimum: 0
  description: Monetary amount in dollars.
  example: 1500.00
```

### Sensitive Fields

```yaml
socialSecurityNumber:
  type: string
  pattern: "^\\d{3}-\\d{2}-\\d{4}$"
  description: SSN for identity verification.
  example: "123-45-6789"
```

### Reusable Schemas

Reference shared schemas from `./components/common.yaml`:

```yaml
# Address
address:
  "$ref": "./common.yaml#/Address"

# Person's name
name:
  "$ref": "./common.yaml#/Name"

# Email
email:
  "$ref": "./common.yaml#/Email"

# Phone
phone:
  "$ref": "./common.yaml#/PhoneNumber"
```

---

## Search Query Syntax

All list endpoints support the `q` query parameter with this syntax:

| Pattern | Description | Example |
|---------|-------------|---------|
| `term` | Full-text search | `john` |
| `field:value` | Exact match | `status:approved` |
| `field:>value` | Greater than | `income:>1000` |
| `field:>=value` | Greater or equal | `income:>=1000` |
| `field:<value` | Less than | `income:<5000` |
| `field:<=value` | Less or equal | `income:<=5000` |
| `field:val1,val2` | Match any (OR) | `status:approved,pending` |
| `-field:value` | Exclude/negate | `-status:denied` |
| `field:*` | Field exists | `email:*` |
| `field.nested:value` | Nested field | `address.state:CA` |

Multiple conditions separated by spaces are ANDed:
```
status:active income:>1000 address.state:CA
```

---

## Validation Rules Enforced

### Required for List Endpoints
- Must have `SearchQueryParam` (or `q` parameter)
- Must have `LimitParam` (or `limit` parameter)
- Must have `OffsetParam` (or `offset` parameter)
- Response must have `items`, `total`, `limit`, `offset` properties
- `items` must be an array

### Required for POST Endpoints
- Must return 201 Created
- Should have Location header
- Must have request body

### Required for PATCH Endpoints
- Must return 200 OK
- Must have request body

### Required for Single Resource GET
- Must handle 404 Not Found

### Error Responses
- Should use shared `$ref` for 400, 404, 422, 500 responses

---

## Checklist

Before submitting a new API:

- [ ] Resource schema in `openapi/components/{name}.yaml`
- [ ] Main spec in `openapi/{name}.yaml`
- [ ] Examples in `openapi/examples/{name}.yaml`
- [ ] All required fields have `id`, `createdAt`, `updatedAt`
- [ ] List endpoint has search and pagination parameters
- [ ] List response has `items`, `total`, `limit`, `offset`, `hasNext`
- [ ] POST returns 201 with Location header
- [ ] PATCH returns 200
- [ ] DELETE returns 204
- [ ] Single-resource GET handles 404
- [ ] Error responses use shared `$ref`
- [ ] `npm run validate` passes with no errors

---

## Reference

- **Pattern configuration**: `openapi/patterns/api-patterns.yaml`
- **Shared parameters**: `openapi/components/common-parameters.yaml`
- **Shared responses**: `openapi/components/common-responses.yaml`
- **Shared schemas**: `openapi/components/common.yaml`
- [Validation Guide](./validation.md)
- [Search Patterns](../decisions/search-patterns.md)
