# Getting Started: UX Designers

> **Status: Draft**

This guide explains how to explore the ORCA data model when designing safety net program interfaces.

## What is the ORCA Data Model?

The ORCA (Open Rules for Client Applications) data model defines the standardized fields, types, and relationships used across safety net benefit applications. It includes:

- **Person information** - names, addresses, contact info, demographics
- **Household data** - members, relationships, expenses, utilities
- **Income & employment** - jobs, wages, self-employment, other income sources
- **Application details** - status, screening flags, preferences, expedited info

The data model is defined in OpenAPI schema files. The **Data Dictionary** in the Explorer turns those files into a browsable, field-level reference.

## Opening the Data Dictionary

### Online (no setup)

The published Explorer hub always reflects the current `main` branch:

- Explorer hub: <https://codeforamerica.github.io/safety-net-blueprint/packages/explorer/>
- Data Dictionary: <https://codeforamerica.github.io/safety-net-blueprint/packages/explorer/tools/data-dictionaries/index.html>

Pick a domain (Intake, Client Management, Case Management, Document Management, Scheduling, Users, Workflow) to open its dictionary page.

### Locally

If you need the dictionary for a branch or a state overlay that is not published yet:

1. Make sure you have Node.js installed (v20.19.0 or later)
2. From the repository root, install dependencies:
   ```bash
   npm install
   ```
3. Build the Data Dictionary from the explorer package:
   ```bash
   cd packages/explorer
   npm run build:data-dictionaries
   ```

This regenerates the static HTML pages under `packages/explorer/tools/data-dictionaries/` (`index.html` plus one page per domain). Open `index.html` in your browser to explore the data model. See the [Explorer README](../../packages/explorer/README.md) for building from state-specific resolved specs.

## Using the Data Dictionary

### Navigation

- **Domain index**: Lists the domains and links to each domain's dictionary page
- **Left sidebar**: Lists every schema in the domain with its field count; click one to jump to its section
- **Search**: Filters the page to matching field names and descriptions
- **Export CSV**: Downloads the domain's field inventory for use in spreadsheets or design tools

### Understanding Field Information

Each field is shown as a card with:

| Item | Description |
|------|-------------|
| Field path | The technical field name, including its parent path (use this for layer naming in design tools) |
| Type | Data type - string, number, boolean, date, enum, uuid, or a `uuid(Entity)` reference to another entity |
| Values | Allowed values for enumerated fields |
| Annotations | Programs the field applies to, the policies (with citations) that require it, and its data classification |

### References to Other Entities

When a field's type is shown as `uuid(Application)`, `uuid(ApplicationMember)`, etc., the field holds the ID of another entity. Look that entity up in the sidebar (or on its domain's dictionary page) to understand nested data structures.

### Program-Specific Fields

Some fields only apply to certain programs, or only under certain conditions. Use the program badges and the "applies when" expression on each field to:
- See which fields are relevant for a specific program
- Identify fields that only appear in some situations

## Example Workflow

1. **Starting a new form design**
   - Open the Data Dictionary for the relevant domain (e.g., Intake for applicant info)
   - Use the sidebar to navigate to the relevant schema (e.g., "Person")

2. **Finding field names for your design**
   - Look up the field in the dictionary
   - Use the field path for naming layers in your design tool
   - Check the allowed values and annotations for validation rules and policy context

3. **Understanding relationships**
   - Follow `uuid(Entity)` references to explore related schemas
   - Use the domain pages to understand which schemas belong together

## Keeping the Reference Updated

The data model may change as new features are added. The published Data Dictionary is rebuilt from `main`; if you are working from a local build, re-run `npm run build:data-dictionaries` periodically to get the latest field definitions.

## Questions?

If you find fields missing from the dictionary or have questions about the data model, reach out to the engineering team or file an issue in the repository.
