/**
 * Minimal RFC 4180 CSV parser.
 * Handles quoted fields with embedded commas, newlines, and escaped quotes.
 * No external dependencies.
 *
 * @param {string} text - Raw CSV text
 * @returns {Array<Record<string, string>>} Array of row objects keyed by header
 */
export function parseCSV(text) {
  const rows = [];
  let i = 0;
  const len = text.length;

  function parseField() {
    if (i >= len || text[i] === '\n' || text[i] === '\r') return '';

    if (text[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let value = '';
      while (i < len) {
        if (text[i] === '"') {
          if (i + 1 < len && text[i + 1] === '"') {
            // Escaped quote
            value += '"';
            i += 2;
          } else {
            // End of quoted field
            i++; // skip closing quote
            break;
          }
        } else {
          value += text[i];
          i++;
        }
      }
      return value;
    }

    // Unquoted field
    let value = '';
    while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
      value += text[i];
      i++;
    }
    return value;
  }

  function parseRow() {
    const fields = [];
    while (i < len && text[i] !== '\n' && text[i] !== '\r') {
      fields.push(parseField());
      if (i < len && text[i] === ',') {
        i++; // skip comma
      }
    }
    // Skip line ending
    if (i < len && text[i] === '\r') i++;
    if (i < len && text[i] === '\n') i++;
    return fields;
  }

  // Parse header row
  const headers = parseRow();

  // Parse data rows
  while (i < len) {
    // Skip blank lines
    if (text[i] === '\n' || text[i] === '\r') {
      if (text[i] === '\r') i++;
      if (i < len && text[i] === '\n') i++;
      continue;
    }
    const fields = parseRow();
    if (fields.length === 0) continue;

    const row = {};
    for (let h = 0; h < headers.length; h++) {
      row[headers[h]] = (fields[h] || '').trim();
    }
    rows.push(row);
  }

  return rows;
}
