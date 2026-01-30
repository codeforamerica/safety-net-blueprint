// Safety Net Schema Populator - Figma Plugin
// Main plugin code that runs in Figma's sandbox

// Show the UI
figma.showUI(__html__, { width: 400, height: 600 });

// Types for our data format
interface FieldMetadata {
  type: 'text' | 'dropdown' | 'boolean' | 'date';
  options?: string[];  // For dropdowns
  label: string;       // Human-readable label
}

interface SchemaData {
  metadata: Record<string, FieldMetadata>;
  examples: Record<string, any>[];
}

interface PopulateRequest {
  type: 'populate';
  data: SchemaData;
  exampleIndex: number;
  matchMode: 'exact' | 'fuzzy';
}

// Normalize a string for matching (lowercase, remove spaces/special chars)
function normalizeForMatch(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Check if two strings match (exact or fuzzy)
function stringsMatch(a: string, b: string, mode: 'exact' | 'fuzzy'): boolean {
  if (mode === 'exact') {
    return normalizeForMatch(a) === normalizeForMatch(b);
  }
  // Fuzzy: check if one contains the other
  const normA = normalizeForMatch(a);
  const normB = normalizeForMatch(b);
  return normA.includes(normB) || normB.includes(normA);
}

// Find all text nodes in the selection or page
function findTextNodes(node: SceneNode | PageNode): TextNode[] {
  const textNodes: TextNode[] = [];

  function traverse(n: SceneNode | PageNode) {
    if (n.type === 'TEXT') {
      textNodes.push(n as TextNode);
    } else if ('children' in n) {
      for (const child of (n as any).children) {
        traverse(child);
      }
    }
  }

  traverse(node);
  return textNodes;
}

// Find component instances that might be dropdowns
function findComponentInstances(node: SceneNode | PageNode): InstanceNode[] {
  const instances: InstanceNode[] = [];

  function traverse(n: SceneNode | PageNode) {
    if (n.type === 'INSTANCE') {
      instances.push(n as InstanceNode);
    } else if ('children' in n) {
      for (const child of (n as any).children) {
        traverse(child);
      }
    }
  }

  traverse(node);
  return instances;
}

// Populate text nodes with data
async function populateTextNodes(
  textNodes: TextNode[],
  example: Record<string, any>,
  metadata: Record<string, FieldMetadata>,
  matchMode: 'exact' | 'fuzzy'
): Promise<{ matched: number; unmatched: string[] }> {
  let matched = 0;
  const unmatchedFields: string[] = [];
  const usedFields = new Set<string>();

  for (const node of textNodes) {
    const nodeName = node.name;

    // Try to find a matching field
    let matchedField: string | null = null;
    let matchedValue: any = null;

    // First pass: try exact matches
    for (const [fieldName, value] of Object.entries(example)) {
      // Skip internal metadata fields
      if (fieldName.startsWith('_')) continue;

      if (stringsMatch(nodeName, fieldName, 'exact')) {
        matchedField = fieldName;
        matchedValue = value;
        break;
      }

      // Also try matching against the label from metadata
      const meta = metadata[fieldName];
      if (meta && stringsMatch(nodeName, meta.label, 'exact')) {
        matchedField = fieldName;
        matchedValue = value;
        break;
      }
    }

    // Second pass: try fuzzy matches only if no exact match and fuzzy mode enabled
    if (!matchedField && matchMode === 'fuzzy') {
      for (const [fieldName, value] of Object.entries(example)) {
        // Skip internal metadata fields
        if (fieldName.startsWith('_')) continue;

        if (stringsMatch(nodeName, fieldName, 'fuzzy')) {
          matchedField = fieldName;
          matchedValue = value;
          break;
        }

        // Also try matching against the label from metadata
        const meta = metadata[fieldName];
        if (meta && stringsMatch(nodeName, meta.label, 'fuzzy')) {
          matchedField = fieldName;
          matchedValue = value;
          break;
        }
      }
    }

    if (matchedField && matchedValue !== null && matchedValue !== undefined) {
      // Load fonts before changing text
      await figma.loadFontAsync(node.fontName as FontName);

      // Format the value based on type
      const meta = metadata[matchedField];
      let displayValue = String(matchedValue);

      if (meta?.type === 'boolean') {
        displayValue = matchedValue ? 'Yes' : 'No';
      } else if (meta?.type === 'date' && matchedValue) {
        // Format date nicely
        try {
          const date = new Date(matchedValue);
          displayValue = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
        } catch {
          displayValue = String(matchedValue);
        }
      }

      node.characters = displayValue;
      matched++;
      usedFields.add(matchedField);
    }
  }

  // Find unmatched fields (skip internal metadata)
  for (const fieldName of Object.keys(example)) {
    if (!fieldName.startsWith('_') && !usedFields.has(fieldName)) {
      unmatchedFields.push(fieldName);
    }
  }

  return { matched, unmatched: unmatchedFields };
}

// Handle dropdown components (instances with variants)
async function populateDropdowns(
  instances: InstanceNode[],
  example: Record<string, any>,
  metadata: Record<string, FieldMetadata>,
  matchMode: 'exact' | 'fuzzy'
): Promise<number> {
  let matched = 0;

  for (const instance of instances) {
    const nodeName = instance.name;

    // Find matching dropdown field
    for (const [fieldName, meta] of Object.entries(metadata)) {
      if (meta.type !== 'dropdown' || !meta.options) continue;

      if (stringsMatch(nodeName, fieldName, matchMode) ||
          stringsMatch(nodeName, meta.label, matchMode)) {

        const value = example[fieldName];
        if (value && meta.options.includes(value)) {
          // Try to set the variant property if the component supports it
          const mainComponent = instance.mainComponent;
          if (mainComponent && mainComponent.parent?.type === 'COMPONENT_SET') {
            // Component set - look for variant with matching value
            const componentSet = mainComponent.parent as ComponentSetNode;

            // Find variant that matches the value
            for (const variant of componentSet.children) {
              if (variant.type === 'COMPONENT') {
                const variantProps = (variant as ComponentNode).variantProperties;
                if (variantProps) {
                  const values = Object.values(variantProps);
                  if (values.some(v => stringsMatch(String(v), value, 'fuzzy'))) {
                    instance.swapComponent(variant as ComponentNode);
                    matched++;
                    break;
                  }
                }
              }
            }
          }
        }
        break;
      }
    }
  }

  return matched;
}

// Handle messages from the UI
figma.ui.onmessage = async (msg: any) => {
  if (msg.type === 'populate') {
    const request = msg as PopulateRequest;
    const { data, exampleIndex, matchMode } = request;

    if (!data.examples || data.examples.length === 0) {
      figma.notify('No example data provided', { error: true });
      return;
    }

    const example = data.examples[exampleIndex] || data.examples[0];
    const metadata = data.metadata || {};

    // Get the scope to search
    const scope = figma.currentPage.selection.length > 0
      ? figma.currentPage.selection
      : [figma.currentPage];

    let totalTextMatched = 0;
    let totalDropdownMatched = 0;
    let allUnmatched: string[] = [];

    for (const node of scope) {
      // Find and populate text nodes
      const textNodes = findTextNodes(node);
      const textResult = await populateTextNodes(textNodes, example, metadata, matchMode);
      totalTextMatched += textResult.matched;
      allUnmatched = [...allUnmatched, ...textResult.unmatched];

      // Find and populate dropdown components
      const instances = findComponentInstances(node);
      const dropdownMatched = await populateDropdowns(instances, example, metadata, matchMode);
      totalDropdownMatched += dropdownMatched;
    }

    // Remove duplicates from unmatched
    const uniqueUnmatched = [...new Set(allUnmatched)];

    figma.ui.postMessage({
      type: 'populate-result',
      textMatched: totalTextMatched,
      dropdownMatched: totalDropdownMatched,
      unmatched: uniqueUnmatched
    });

    const total = totalTextMatched + totalDropdownMatched;
    figma.notify(`Populated ${total} field${total !== 1 ? 's' : ''}`);
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
