# Getting Started: UX Designers

> **Status: Draft**

This guide explains how to generate and use the ORCA data model reference for designing safety net program interfaces.

## What is the ORCA Data Model?

The ORCA (Open Rules for Client Applications) data model defines the standardized fields, types, and relationships used across safety net benefit applications. It includes:

- **Person information** - names, addresses, contact info, demographics
- **Household data** - members, relationships, expenses, utilities
- **Income & employment** - jobs, wages, self-employment, other income sources
- **Application details** - status, screening flags, preferences, expedited info

The data model is defined in OpenAPI schema files and can be exported as an interactive HTML reference.

## Generating the Design Reference

### Prerequisites

1. Make sure you have Node.js installed (v20.19.0 or later)
2. From the repository root, install dependencies:
   ```bash
   npm install
   ```

### Generate the HTML Reference

From the repository root:

```bash
npm run design:reference
```

This creates an interactive HTML file at `docs/schema-reference.html`. Open this file in your browser to explore the data model.

## Using the Design Reference

### Navigation

- **Left sidebar**: Lists all domains (Person, Household, Application, Income) and their schemas
- **State selector**: Filter fields by state implementation (use "All Fields" to see everything)
- **Schema sections**: Click any schema in the sidebar to jump to its details

### Understanding Field Information

Each field shows:

| Column | Description |
|--------|-------------|
| Field | The technical field name (use this for layer naming in design tools) |
| Label | Human-readable display name |
| Type | Data type - text, number, date, boolean, or linked schema |
| Required | Whether the field is mandatory |
| Notes | Additional context, validation rules, or allowed values |

### Linked Schemas

When a field type shows an arrow (e.g., `→ Address`), click the link to navigate to that schema's definition. This helps you understand nested data structures.

### State-Specific Fields

Some fields only apply to certain state implementations. Use the state selector to:
- See which fields are relevant for a specific state
- Identify fields marked as "State-specific" that may vary by implementation

## Example Workflow

1. **Starting a new form design**
   - Generate the latest reference: `npm run design:reference`
   - Open the HTML in your browser
   - Navigate to the relevant schema (e.g., "Person" for applicant info)

2. **Finding field names for your design**
   - Look up the field in the reference
   - Use the "Field" column value for naming layers in your design tool
   - Check "Notes" for validation rules or allowed values

3. **Understanding relationships**
   - Click linked types to explore related schemas
   - Use the domain groupings to understand which schemas belong together

## Keeping the Reference Updated

The data model may change as new features are added. Re-run `npm run design:reference` periodically to get the latest field definitions.

## Questions?

If you find fields missing from the reference or have questions about the data model, reach out to the engineering team or file an issue in the repository.
