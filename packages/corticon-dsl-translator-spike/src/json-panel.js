/**
 * Shared JSON panel builder for the rules and graph HTML visualizers.
 * Renders JSON data as collapsible YAML-style output (keys without quotes,
 * indented children, - prefix for array items). Root objects expand directly
 * without a wrapper label.
 *
 * Rendering is deferred until the panel is first made active — avoids building
 * innerHTML for all panels at page load. Large root arrays (>500 items) are
 * paginated to keep initial render fast.
 *
 * opts.maxDepth — collapse nodes at this depth and deeper regardless of size.
 *   Depth 0 = root. E.g. maxDepth:3 opens root → sections → individual items,
 *   then collapses their contents.
 */
import { readFileSync } from 'node:fs';
import { esc } from '../../explorer/lib/html.js';

const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
const PAGE_SIZE = 200;

export function jsonPanel(id, label, filePath, opts = {}) {
  if (!filePath) return { navHtml: '', panelHtml: '' };
  let content;
  try { content = readFileSync(filePath, 'utf-8'); }
  catch { content = null; }
  const maxDepth = opts.maxDepth ?? null; // null = no depth limit
  const expandAllOnOpen = opts.expandAllOnOpen ?? false; // when true, opening a collapsed node expands all its descendants
  const navHtml = `<a class="nav-link" data-tab="${esc(id)}">${esc(label)}</a>`;
  const btnStyle = 'font-size:10px;padding:2px 8px;cursor:pointer;background:#f9fafb;border:1px solid #d1d5db;border-radius:4px;color:#374151';
  const panelHtml = `
<div id="${id}" class="tab-panel" style="padding:1.5rem 2rem">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb">
    <h2 style="font-size:15px;font-weight:700;color:#111827;margin:0;flex:1">${esc(label)}</h2>
    <button style="${btnStyle}" onclick="(function(el){el.querySelectorAll('details').forEach(function(d){d.open=true;var t=d.querySelector('.json-toggle');if(t)t.textContent='-';});})(document.getElementById('${esc(id)}-tree'))">Expand all</button>
    <button style="${btnStyle}" onclick="(function(el){el.querySelectorAll('details').forEach(function(d){d.open=false;var t=d.querySelector('.json-toggle');if(t)t.textContent='+';});})(document.getElementById('${esc(id)}-tree'))">Collapse all</button>
  </div>
  ${content === null
    ? `<p style="color:#9ca3af;font-size:12px">(file not found: ${esc(filePath)})</p>`
    : `<div id="${esc(id)}-tree" style="font-size:11px;line-height:1.7;font-family:${MONO};background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:6px;overflow:auto"></div>
  <script>
  (function() {
    var data = ${content};
    var elId = ${JSON.stringify(id + '-tree')};
    var PAGE = ${PAGE_SIZE};
    var EXPAND_ALL_ON_OPEN = ${expandAllOnOpen};
    var EXPAND_DEEP_ON_OPEN = ${opts.expandDeepOnOpen ?? false};
    var MAX_DEPTH = ${maxDepth === null ? 'Infinity' : maxDepth};
    window.__jsonPanels = window.__jsonPanels || {};
    window.__jsonPanels[${JSON.stringify(id)}] = function() {
      var el = document.getElementById(elId);
      if (!el || el._rendered) return;
      el._rendered = true;
      function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
      window.__jsCopy = window.__jsCopy || function(btn) {
        var text = btn.dataset.key;
        function showCopied() {
          var prev = btn.textContent;
          btn.textContent = String.fromCharCode(10003);
          setTimeout(function(){ btn.textContent = prev; }, 1200);
        }
        function fallback() {
          var ta = document.createElement('textarea');
          ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;width:1px;height:1px';
          document.body.appendChild(ta); ta.focus(); ta.select();
          try { document.execCommand('copy'); showCopied(); } catch(e){}
          document.body.removeChild(ta);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(showCopied).catch(fallback);
        } else { fallback(); }
      };
      function copyBtn(k) {
        return '<button style="opacity:0.5;margin-left:4px;margin-right:2px;font-size:10px;cursor:pointer;color:#89b4fa;background:#313244;border:1px solid #45475a;padding:0 4px;line-height:1.5;vertical-align:middle;border-radius:3px" onmouseenter="this.style.opacity=1;this.style.background=\\'#45475a\\'" onmouseleave="this.style.opacity=0.5;this.style.background=\\'#313244\\'" onclick="event.preventDefault();event.stopPropagation();window.__jsCopy(this)" data-key="' + esc(String(k)) + '" title="Copy key">\u2398</button>';
      }
      function render(val, key, isItem, depth) {
        depth = depth || 0;
        var keyLabel = isItem
          ? '<span style="color:#89b4fa">-</span> '
          : (key !== null && key !== undefined)
            ? copyBtn(key) + '<span style="color:#89dceb;user-select:text;cursor:text" onclick="event.stopPropagation()">' + esc(key) + '</span><span style="color:#6c7086">:</span> '
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
          var open = depth < MAX_DEPTH;
          var items = val.map(function(v){ return '<div style="margin-left:16px">'+render(v,null,true,depth+1)+'</div>'; }).join('');
          if (keyLabel===null) return items;
          var toggleStyle = isItem ? ' style="color:#89b4fa"' : '';
          return '<details'+(open?' open':'')+'><summary style="cursor:pointer;list-style:none;user-select:none"><span class="json-toggle"'+toggleStyle+'>'+(open?'-':'+')+'</span> '+(isItem?'':keyLabel)+(open?'':' <span style="color:#6c7086;font-size:10px">['+val.length+']</span>')+'</summary>'+items+'</details>';
        }
        if (typeof val === 'object') {
          var keys = Object.keys(val);
          if (!keys.length) return (keyLabel||'') + '<span style="color:#6c7086">{}</span>';
          var open = depth < MAX_DEPTH;
          var children = keys.map(function(k){ return '<div style="margin-left:16px">'+render(val[k],k,false,depth+1)+'</div>'; }).join('');
          if (keyLabel===null) return children;
          var toggleStyle = isItem ? ' style="color:#89b4fa"' : '';
          return '<details'+(open?' open':'')+'><summary style="cursor:pointer;list-style:none;user-select:none"><span class="json-toggle"'+toggleStyle+'>'+(open?'-':'+')+'</span> '+(isItem?'':keyLabel)+(open?'':' <span style="color:#6c7086;font-size:10px">['+keys.length+']</span>')+'</summary>'+children+'</details>';
        }
        return (keyLabel||'') + esc(String(val));
      }
      // Paginate root arrays so initial render is fast
      if (Array.isArray(data) && data.length > PAGE) {
        var offset = 0;
        function renderPage() {
          var slice = data.slice(offset, offset + PAGE);
          var html = slice.map(function(v){ return '<div style="margin-left:0">'+render(v,null,true,1)+'</div>'; }).join('');
          offset += slice.length;
          var div = document.createElement('div');
          div.innerHTML = html;
          el.appendChild(div);
          if (offset < data.length) {
            var btn = document.createElement('button');
            btn.textContent = 'Show next ' + Math.min(PAGE, data.length - offset) + ' of ' + (data.length - offset) + ' remaining';
            btn.style.cssText = 'margin:8px 0;padding:4px 10px;font-size:11px;cursor:pointer;background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:4px';
            btn.onclick = function() { btn.remove(); renderPage(); };
            el.appendChild(btn);
          }
        }
        var total = document.createElement('div');
        total.style.cssText = 'color:#6c7086;font-size:11px;margin-bottom:8px';
        total.textContent = data.length + ' items total, showing ' + PAGE + ' at a time';
        el.appendChild(total);
        renderPage();
      } else {
        el.innerHTML = render(data, null, false, 0);
        // Pre-mark already-open details so expandAllOnOpen doesn't fire on the
        // initial async toggle events the browser emits after innerHTML is set.
        el.querySelectorAll('details[open]').forEach(function(d) { d._expanded = true; });
      }
      el.addEventListener('toggle', function(e){
        if(e.target.tagName!=='DETAILS') return;
        var t=e.target.querySelector('.json-toggle'); if(t) t.textContent=e.target.open?'-':'+';
        if(EXPAND_ALL_ON_OPEN && e.target.open && !e.target._expanded) {
          e.target._expanded=true;
          var directChildren=e.target.querySelectorAll(':scope > div > details');
          for(var i=0;i<directChildren.length;i++){
            directChildren[i].open=true;
            var nt=directChildren[i].querySelector('.json-toggle'); if(nt) nt.textContent='-';
          }
        }
        if(EXPAND_DEEP_ON_OPEN && e.target.open && !e.target._expanded) {
          e.target._expanded=true;
          e.target.querySelectorAll('details').forEach(function(d){
            d._expanded=true; d.open=true;
            var nt=d.querySelector('.json-toggle'); if(nt) nt.textContent='-';
          });
        }
      }, true);
    };
  })();
  </script>`}
</div>`;
  return { navHtml, panelHtml };
}
