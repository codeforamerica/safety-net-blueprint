# Safety Net Schema Populator - Figma Plugin

A Figma plugin that populates your designs with realistic data from the Safety Net API schemas.

## Features

- **Text Layer Population**: Automatically fills text layers based on field name matching
- **Dropdown Support**: Swaps component variants for enum/dropdown fields
- **Multiple Examples**: Choose from different example records (e.g., different applicants)
- **Fuzzy Matching**: Matches layer names even if they don't exactly match field names

## Installation

### Development Installation

1. Install dependencies:
   ```bash
   cd packages/schemas/figma-plugin
   npm install
   ```

2. Build the plugin:
   ```bash
   npm run build
   ```

3. In Figma:
   - Go to **Plugins** → **Development** → **Import plugin from manifest...**
   - Select the `manifest.json` file in this directory

## Usage

### 1. Export Data

From the `packages/schemas` directory, run:

```bash
npm run figma:export
```

This generates `design-export/figma-plugin/all-data.json` containing:
- Schema metadata (field types, dropdown options)
- Example data (realistic sample records)

### 2. Run the Plugin

1. Open your Figma file
2. Select the frames/layers you want to populate (or select nothing for entire page)
3. Run the plugin: **Plugins** → **Development** → **Safety Net Schema Populator**
4. Load your data using one of these methods:
   - **Drag and drop** the `all-data.json` file into the plugin
   - **Click "browse"** to select the JSON file
   - **Paste** the JSON contents in the "Paste JSON" tab
5. Use the **Browse tab** to:
   - Select a resource type (Applications, Households, Incomes, Persons)
   - Filter and explore available fields
   - Preview example data before applying
6. Click "Populate Selection"

### Layer Naming Convention

Name your text layers to match field names. The plugin uses fuzzy matching, so these all work:

| Field Name | Matching Layer Names |
|------------|---------------------|
| `firstName` | "First Name", "firstName", "first_name", "FirstName" |
| `dateOfBirth` | "Date of Birth", "DOB", "dateOfBirth", "Birth Date" |
| `maritalStatus` | "Marital Status", "maritalStatus", "Status" |

### Dropdown Components

For enum/dropdown fields:

1. Create a **Component Set** with variants for each option
2. Name the component to match the field (e.g., "maritalStatus" or "Marital Status")
3. Create variants with names matching the enum values (e.g., "Single", "Married", "Divorced")
4. The plugin will automatically swap to the correct variant

## Development

### Project Structure

```
figma-plugin/
├── manifest.json      # Figma plugin manifest
├── package.json       # Node dependencies
├── build.js          # Build script
├── tsconfig.json     # TypeScript config
└── src/
    ├── code.ts       # Main plugin code (runs in Figma sandbox)
    └── ui.html       # Plugin UI (HTML/CSS/JS)
```

### Building

```bash
npm run build        # One-time build
npm run watch        # Watch mode for development
```

### Debugging

- Open Figma's developer console: **Plugins** → **Development** → **Open Console**
- Use `console.log()` in `code.ts` to debug plugin code
- Use browser dev tools pattern in `ui.html` for UI debugging

## Data Format

The plugin expects JSON in this format:

```json
{
  "metadata": {
    "firstName": {
      "type": "text",
      "label": "First Name"
    },
    "maritalStatus": {
      "type": "dropdown",
      "label": "Marital Status",
      "options": ["Single", "Married", "Divorced", "Widowed"]
    }
  },
  "examples": [
    {
      "firstName": "John",
      "maritalStatus": "Married"
    }
  ]
}
```
