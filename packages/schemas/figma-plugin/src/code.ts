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
): Promise<{ matched: number; cleared: number; unmatched: string[] }> {
  let matched = 0;
  let cleared = 0;
  const unmatchedFields: string[] = [];
  const usedFields = new Set<string>();

  // Build a combined list of all known fields from example and metadata
  const allFields = new Set<string>();
  for (const key of Object.keys(example)) {
    if (!key.startsWith('_')) allFields.add(key);
  }
  for (const key of Object.keys(metadata)) {
    allFields.add(key);
  }

  for (const node of textNodes) {
    const nodeName = node.name;

    // Skip special nodes: labels (end with -label) and system nodes (start with __)
    if (nodeName.endsWith('-label') || nodeName.startsWith('__')) continue;

    // Try to find a matching field from all known fields
    let matchedField: string | null = null;

    // First pass: try exact matches
    for (const fieldName of allFields) {
      if (stringsMatch(nodeName, fieldName, 'exact')) {
        matchedField = fieldName;
        break;
      }

      // Also try matching against the label from metadata
      const meta = metadata[fieldName];
      if (meta && stringsMatch(nodeName, meta.label, 'exact')) {
        matchedField = fieldName;
        break;
      }
    }

    // Second pass: try fuzzy matches only if no exact match and fuzzy mode enabled
    if (!matchedField && matchMode === 'fuzzy') {
      for (const fieldName of allFields) {
        if (stringsMatch(nodeName, fieldName, 'fuzzy')) {
          matchedField = fieldName;
          break;
        }

        // Also try matching against the label from metadata
        const meta = metadata[fieldName];
        if (meta && stringsMatch(nodeName, meta.label, 'fuzzy')) {
          matchedField = fieldName;
          break;
        }
      }
    }

    if (matchedField) {
      // Load fonts before changing text
      await figma.loadFontAsync(node.fontName as FontName);

      const matchedValue = example[matchedField];
      const meta = metadata[matchedField];

      // If value exists, format and display it; otherwise clear the field
      if (matchedValue !== null && matchedValue !== undefined && matchedValue !== '') {
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
      } else {
        // Clear the field - use empty string or placeholder
        node.characters = '';
        cleared++;
      }

      usedFields.add(matchedField);
    }
  }

  // Find unmatched fields (fields in example that weren't found in any layer)
  for (const fieldName of Object.keys(example)) {
    if (!fieldName.startsWith('_') && !usedFields.has(fieldName)) {
      unmatchedFields.push(fieldName);
    }
  }

  return { matched, cleared, unmatched: unmatchedFields };
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

// Generate a form-style layout (label + value pairs)
async function generateFormLayout(
  example: Record<string, any>,
  metadata: Record<string, FieldMetadata>,
  exampleName: string
): Promise<FrameNode> {
  // Load a font
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });

  // Create main frame
  const frame = figma.createFrame();
  frame.name = exampleName;
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.paddingTop = 24;
  frame.paddingBottom = 24;
  frame.paddingLeft = 24;
  frame.paddingRight = 24;
  frame.itemSpacing = 16;
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  frame.cornerRadius = 8;

  // Add title (named __title so it won't be matched during populate)
  const title = figma.createText();
  title.name = '__title';
  title.fontName = { family: 'Inter', style: 'Medium' };
  title.characters = exampleName;
  title.fontSize = 18;
  title.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
  frame.appendChild(title);

  // Add fields
  let fieldCount = 0;
  for (const [fieldName, value] of Object.entries(example)) {
    if (fieldName.startsWith('_')) continue;

    const meta = metadata[fieldName];
    const label = meta?.label || fieldName;
    const displayValue = String(value ?? '');

    // Create row frame
    const row = figma.createFrame();
    row.name = fieldName;
    row.layoutMode = 'HORIZONTAL';
    row.primaryAxisSizingMode = 'AUTO';
    row.counterAxisSizingMode = 'AUTO';
    row.itemSpacing = 16;
    row.fills = [];

    // Create label
    const labelNode = figma.createText();
    labelNode.name = `${fieldName}-label`;
    labelNode.fontName = { family: 'Inter', style: 'Medium' };
    labelNode.characters = label;
    labelNode.fontSize = 12;
    labelNode.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }];
    labelNode.resize(140, labelNode.height);
    row.appendChild(labelNode);

    // Create value
    const valueNode = figma.createText();
    valueNode.name = label; // Name it with the label for easy matching later
    valueNode.fontName = { family: 'Inter', style: 'Regular' };
    valueNode.characters = displayValue || '—';
    valueNode.fontSize = 12;
    valueNode.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
    row.appendChild(valueNode);

    frame.appendChild(row);
    fieldCount++;
  }

  return frame;
}

// Generate an auto-layout with grouped fields
async function generateAutoLayout(
  example: Record<string, any>,
  metadata: Record<string, FieldMetadata>,
  exampleName: string
): Promise<FrameNode> {
  // Load fonts
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

  // Group fields by prefix
  const groups: Record<string, Array<{ fieldName: string; value: any; meta?: FieldMetadata }>> = {};

  for (const [fieldName, value] of Object.entries(example)) {
    if (fieldName.startsWith('_')) continue;

    const parts = fieldName.split('.');
    const groupName = parts.length > 1 ? parts[0] : 'general';

    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push({ fieldName, value, meta: metadata[fieldName] });
  }

  // Create main frame
  const frame = figma.createFrame();
  frame.name = exampleName;
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.paddingTop = 24;
  frame.paddingBottom = 24;
  frame.paddingLeft = 24;
  frame.paddingRight = 24;
  frame.itemSpacing = 24;
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  frame.cornerRadius = 8;

  // Add title (named __title so it won't be matched during populate)
  const title = figma.createText();
  title.name = '__title';
  title.fontName = { family: 'Inter', style: 'Semi Bold' };
  title.characters = exampleName;
  title.fontSize = 20;
  title.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
  frame.appendChild(title);

  // Create groups
  for (const [groupName, fields] of Object.entries(groups)) {
    const groupFrame = figma.createFrame();
    groupFrame.name = groupName;
    groupFrame.layoutMode = 'VERTICAL';
    groupFrame.primaryAxisSizingMode = 'AUTO';
    groupFrame.counterAxisSizingMode = 'AUTO';
    groupFrame.itemSpacing = 12;
    groupFrame.paddingTop = 16;
    groupFrame.paddingBottom = 16;
    groupFrame.paddingLeft = 16;
    groupFrame.paddingRight = 16;
    groupFrame.fills = [{ type: 'SOLID', color: { r: 0.98, g: 0.98, b: 0.98 } }];
    groupFrame.cornerRadius = 6;

    // Group title
    if (groupName !== 'general') {
      const groupTitle = figma.createText();
      groupTitle.fontName = { family: 'Inter', style: 'Medium' };
      groupTitle.characters = groupName.charAt(0).toUpperCase() + groupName.slice(1).replace(/([A-Z])/g, ' $1');
      groupTitle.fontSize = 14;
      groupTitle.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2 } }];
      groupFrame.appendChild(groupTitle);
    }

    // Field grid (2 columns)
    const gridFrame = figma.createFrame();
    gridFrame.name = 'fields';
    gridFrame.layoutMode = 'HORIZONTAL';
    gridFrame.layoutWrap = 'WRAP';
    gridFrame.primaryAxisSizingMode = 'FIXED';
    gridFrame.counterAxisSizingMode = 'AUTO';
    gridFrame.resize(400, 10);
    gridFrame.itemSpacing = 16;
    gridFrame.counterAxisSpacing = 12;
    gridFrame.fills = [];

    for (const { fieldName, value, meta } of fields) {
      const label = meta?.label || fieldName.split('.').pop() || fieldName;
      const displayValue = String(value ?? '');

      // Field container
      const fieldFrame = figma.createFrame();
      fieldFrame.name = fieldName;
      fieldFrame.layoutMode = 'VERTICAL';
      fieldFrame.primaryAxisSizingMode = 'AUTO';
      fieldFrame.counterAxisSizingMode = 'FIXED';
      fieldFrame.resize(180, 10);
      fieldFrame.itemSpacing = 4;
      fieldFrame.fills = [];

      // Label
      const labelNode = figma.createText();
      labelNode.name = `${fieldName}-label`;
      labelNode.fontName = { family: 'Inter', style: 'Regular' };
      labelNode.characters = label;
      labelNode.fontSize = 10;
      labelNode.fills = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }];
      fieldFrame.appendChild(labelNode);

      // Value
      const valueNode = figma.createText();
      valueNode.name = label;
      valueNode.fontName = { family: 'Inter', style: 'Medium' };
      valueNode.characters = displayValue || '—';
      valueNode.fontSize = 12;
      valueNode.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
      fieldFrame.appendChild(valueNode);

      gridFrame.appendChild(fieldFrame);
    }

    groupFrame.appendChild(gridFrame);
    frame.appendChild(groupFrame);
  }

  return frame;
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

    // Check if something is selected
    if (figma.currentPage.selection.length === 0) {
      figma.notify('Please select a frame to populate', { error: true });
      figma.ui.postMessage({ type: 'populate-error', message: 'No selection. Please select a frame in Figma first.' });
      return;
    }

    const example = data.examples[exampleIndex] || data.examples[0];
    const metadata = data.metadata || {};

    // Get the scope to search
    const scope = figma.currentPage.selection;

    let totalTextMatched = 0;
    let totalDropdownMatched = 0;
    let allUnmatched: string[] = [];

    let totalCleared = 0;

    for (const node of scope) {
      // Find and populate text nodes
      const textNodes = findTextNodes(node);
      const textResult = await populateTextNodes(textNodes, example, metadata, matchMode);
      totalTextMatched += textResult.matched;
      totalCleared += textResult.cleared;
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
      cleared: totalCleared,
      unmatched: uniqueUnmatched
    });

    const total = totalTextMatched + totalDropdownMatched;
    let message = `Populated ${total} field${total !== 1 ? 's' : ''}`;
    if (totalCleared > 0) {
      message += `, cleared ${totalCleared}`;
    }
    figma.notify(message);
  }

  if (msg.type === 'generate') {
    const { data, example, layoutStyle, exampleName } = msg;

    if (!example) {
      figma.notify('No example selected', { error: true });
      return;
    }

    const metadata = data.metadata || {};
    const frameName = exampleName || 'Generated Layout';

    try {
      let frame: FrameNode;

      if (layoutStyle === 'autolayout') {
        frame = await generateAutoLayout(example, metadata, frameName);
      } else {
        frame = await generateFormLayout(example, metadata, frameName);
      }

      // Position at center of viewport
      const center = figma.viewport.center;
      frame.x = center.x - frame.width / 2;
      frame.y = center.y - frame.height / 2;

      // Select the new frame
      figma.currentPage.selection = [frame];
      figma.viewport.scrollAndZoomIntoView([frame]);

      const fieldCount = Object.keys(example).filter(k => !k.startsWith('_')).length;

      figma.ui.postMessage({
        type: 'generate-result',
        fieldCount: fieldCount,
        frameName: frameName
      });

      figma.notify(`Generated "${frameName}" with ${fieldCount} fields`);
    } catch (error: any) {
      figma.notify(`Error generating layout: ${error.message}`, { error: true });
    }
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
