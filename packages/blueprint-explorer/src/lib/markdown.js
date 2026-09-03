/**
 * Shared GFM markdown renderer for explorer build scripts.
 */

/** Inline markdown: bold, italic, code. Escapes HTML first. */
export function inlineMd(raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, `<code style="font-size:11px;background:#f0f0f0;padding:0 3px;border-radius:2px;font-family:monospace;">$1</code>`);
}

/** Render a GFM pipe table to an HTML table string, or null if not a table. */
export function parsePipeTable(lines) {
  const dataLines = lines.filter(l => !/^\s*\|?[\s\-:|]+\|?\s*$/.test(l));
  if (!dataLines.length) return null;
  const parseRow = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const [head, ...body] = dataLines;
  const thStyle = `padding:4px 8px;font-size:10px;font-weight:700;text-align:left;background:#f5f5f5;border:1px solid #e0e0e0;white-space:nowrap;`;
  const tdStyle = `padding:4px 8px;font-size:11px;border:1px solid #e0e0e0;`;
  const ths = parseRow(head).map(h => `<th style="${thStyle}">${inlineMd(h)}</th>`).join('');
  const trs = body.map(r => `<tr>${parseRow(r).map(c => `<td style="${tdStyle}">${inlineMd(c)}</td>`).join('')}</tr>`).join('');
  return `<div style="overflow-x:auto;margin:8px 0;"><table style="border-collapse:collapse;font-size:11px;"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

/** Render a multi-block GFM markdown string to HTML. */
export function renderMarkdown(text) {
  if (!text) return '';
  const mdStyle = `font-size:13px;color:#444;line-height:1.65;`;
  const h3 = `font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#666;margin:14px 0 4px;`;
  const h2 = `font-size:13px;font-weight:800;color:#333;margin:14px 0 4px;`;

  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);

  const rendered = blocks.map(block => {
    if (block.startsWith('### ')) return `<h4 style="${h3}">${inlineMd(block.slice(4))}</h4>`;
    if (block.startsWith('## '))  return `<h3 style="${h2}">${inlineMd(block.slice(3))}</h3>`;
    if (block.startsWith('# '))   return `<h2 style="${h2}">${inlineMd(block.slice(2))}</h2>`;

    if (block.startsWith('> ')) {
      const content = block.replace(/^> ?/gm, '').trim();
      return `<blockquote style="border-left:3px solid #ddd;padding:4px 10px;margin:6px 0;color:#666;font-style:italic;">${inlineMd(content)}</blockquote>`;
    }

    const lines = block.split('\n');

    if (lines.length >= 2 && lines[0].includes('|') && /^\s*\|?[\s\-:|]+\|?\s*$/.test(lines[1])) {
      const table = parsePipeTable(lines);
      if (table) return table;
    }

    if (lines.every(l => /^\s*[-*] /.test(l))) {
      const items = lines.map(l => `<li>${inlineMd(l.replace(/^\s*[-*] /, ''))}</li>`).join('');
      return `<ul style="margin:6px 0;padding-left:1.25rem;">${items}</ul>`;
    }

    if (lines.every(l => /^\s*\d+\. /.test(l))) {
      const items = lines.map(l => `<li>${inlineMd(l.replace(/^\s*\d+\. /, ''))}</li>`).join('');
      return `<ol style="margin:6px 0;padding-left:1.25rem;">${items}</ol>`;
    }

    return `<p style="margin:0 0 6px;">${inlineMd(lines.join(' '))}</p>`;
  }).join('');

  return `<div style="${mdStyle}">${rendered}</div>`;
}
