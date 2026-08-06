/**
 * Shared JSON panel builder for the rules and graph HTML visualizers.
 * Renders JSON data as collapsible YAML-style output (keys without quotes,
 * indented children, - prefix for array items). Root objects expand directly
 * without a wrapper label.
 */
import { readFileSync } from 'node:fs';
import { esc } from '../../explorer/lib/html.js';

const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';

export function jsonPanel(id, label, filePath) {
  if (!filePath) return { navHtml: '', panelHtml: '' };
  let content;
  try { content = readFileSync(filePath, 'utf-8'); }
  catch { content = null; }
  const navHtml = `<a class="nav-link" data-tab="${esc(id)}">${esc(label)}</a>`;
  const panelHtml = `
<div id="${id}" class="tab-panel" style="padding:1.5rem 2rem">
  <h2 style="font-size:15px;font-weight:700;color:#111827;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">${esc(label)}</h2>
  ${content === null
    ? `<p style="color:#9ca3af;font-size:12px">(file not found: ${esc(filePath)})</p>`
    : `<div id="${esc(id)}-tree" style="font-size:11px;line-height:1.7;font-family:${MONO};background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:6px;overflow:auto"></div>
  <script>
  (function() {
    var data = ${content};
    var el = document.getElementById(${JSON.stringify(id + '-tree')});
    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function render(val, key, isItem) {
      var keyLabel = isItem
        ? '<span style="color:#89b4fa">-</span> '
        : (key !== null && key !== undefined)
          ? '<span style="color:#89dceb">' + esc(key) + '</span><span style="color:#6c7086">:</span> '
          : null;
      if (val === null) return (keyLabel||'') + '<span style="color:#f38ba8">null</span>';
      if (typeof val === 'boolean') return (keyLabel||'') + '<span style="color:#fab387">' + val + '</span>';
      if (typeof val === 'number') return (keyLabel||'') + '<span style="color:#a6e3a1">' + val + '</span>';
      if (typeof val === 'string') {
        var q = !val || /[:#\[\]{}&*!,|>?\\]/.test(val) || val==='true'||val==='false'||val==='null';
        return (keyLabel||'') + '<span style="color:#a6da95">' + (q?'"'+esc(val)+'"':esc(val)) + '</span>';
      }
      if (Array.isArray(val)) {
        if (!val.length) return (keyLabel||'') + '<span style="color:#6c7086">[]</span>';
        var items = val.map(function(v){ return '<div style="margin-left:16px">'+render(v,null,true)+'</div>'; }).join('');
        if (keyLabel===null) return items;
        return '<details open><summary style="cursor:pointer;list-style:none;user-select:none"><span class="json-toggle">-</span> '+keyLabel+'</summary>'+items+'</details>';
      }
      if (typeof val === 'object') {
        var keys = Object.keys(val);
        if (!keys.length) return (keyLabel||'') + '<span style="color:#6c7086">{}</span>';
        var children = keys.map(function(k){ return '<div style="margin-left:16px">'+render(val[k],k,false)+'</div>'; }).join('');
        if (keyLabel===null) return children;
        return '<details open><summary style="cursor:pointer;list-style:none;user-select:none"><span class="json-toggle">-</span> '+keyLabel+'</summary>'+children+'</details>';
      }
      return (keyLabel||'') + esc(String(val));
    }
    el.innerHTML = render(data, null, false);
    el.addEventListener('toggle', function(e){ if(e.target.tagName==='DETAILS'){ e.target.querySelector('.json-toggle').textContent = e.target.open?'-':'+'; } }, true);
  })();
  </script>`}
</div>`;
  return { navHtml, panelHtml };
}
