#!/usr/bin/env node
/**
 * render-overview.js
 *
 * Generates the Adoption Model overview page (adoption-model.html).
 * Shows the before/after contrast: isolated state stacks vs. the shared
 * blueprint architecture. Clicking the right panel navigates to the
 * Customization Model detail view.
 */


// ── Before panel: one isolated state column ───────────────────────────────────

function beforeStateColumn(x, label, vendors) {
  const cx = x + 89; // center of 178px wide column
  const [v1, v2, v3, v4] = vendors;
  return `
  <!-- ${label} before column -->
  <rect x="${x}" y="108" width="178" height="498" rx="6" fill="none" stroke="#d1d5db" stroke-width="1.5" stroke-dasharray="5,3"/>
  <text x="${cx}" y="126" font-size="10" text-anchor="middle" fill="#b0b7bf" font-style="italic" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">${label}</text>

  <rect x="${x+14}" y="134" width="150" height="38" rx="4" fill="#e0e7ff" stroke="#818cf8" stroke-width="1.5"/>
  <text x="${cx}" y="157" font-size="10" text-anchor="middle" fill="#4338ca" font-weight="600" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State UX Layer</text>

  <rect x="${x+14}" y="502" width="66" height="30" rx="3" fill="#e5e7eb" stroke="#c4cad2" stroke-width="1"/>
  <text x="${x+47}" y="521" font-size="8" text-anchor="middle" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">${v1}</text>
  <rect x="${x+96}" y="502" width="66" height="30" rx="3" fill="#e5e7eb" stroke="#c4cad2" stroke-width="1"/>
  <text x="${x+129}" y="521" font-size="8" text-anchor="middle" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">${v2}</text>

  <rect x="${x+14}" y="556" width="66" height="30" rx="3" fill="#e5e7eb" stroke="#c4cad2" stroke-width="1"/>
  <text x="${x+47}" y="575" font-size="8" text-anchor="middle" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">${v3}</text>
  <rect x="${x+96}" y="556" width="66" height="30" rx="3" fill="#e5e7eb" stroke="#c4cad2" stroke-width="1"/>
  <text x="${x+129}" y="575" font-size="8" text-anchor="middle" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">${v4}</text>

  <path d="M ${cx-30} 172 C ${cx-60} 300 ${cx-60} 420 ${cx-42} 502" stroke="#bfc5cc" stroke-width="1.3" fill="none"/>
  <path d="M ${cx-10} 172 C ${cx-30} 300 ${cx+10} 420 ${cx+12} 502" stroke="#bfc5cc" stroke-width="1.3" fill="none"/>
  <path d="M ${cx+20} 172 C ${cx+50} 320 ${cx-42} 440 ${cx-48} 556" stroke="#bfc5cc" stroke-width="1.3" fill="none"/>
  <path d="M ${cx+40} 172 C ${cx+60} 340 ${cx+45} 450 ${cx+38} 556" stroke="#bfc5cc" stroke-width="1.3" fill="none"/>
  <path d="M ${cx-20} 172 C ${cx+50} 300 ${cx-60} 440 ${cx+38} 502" stroke="#bfc5cc" stroke-width="1.3" fill="none" opacity="0.5"/>
  <path d="M ${cx+30} 172 C ${cx-61} 320 ${cx+52} 430 ${cx-44} 556" stroke="#bfc5cc" stroke-width="1.3" fill="none" opacity="0.5"/>`;
}

// ── After panel: one state column ─────────────────────────────────────────────

function afterStateColumn(colX, label) {
  const cx  = colX + 100; // center of 200px wide column
  return `
  <!-- ${label} after column -->
  <text x="${cx}" y="112" font-size="11" font-weight="600" text-anchor="middle" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">${label}</text>
  <rect x="${colX}" y="120" width="200" height="42" rx="4" fill="#e0e7ff" stroke="#818cf8" stroke-width="1.5"/>
  <text x="${cx}" y="145" font-size="10" text-anchor="middle" fill="#4338ca" font-weight="600" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State UX Layer</text>
  <line x1="${cx}" y1="162" x2="${cx}" y2="208" stroke="#c7d2fe" stroke-width="1.5"/>`;
}

// ── After panel: adapter bar ───────────────────────────────────────────────────

function adapterBar(colX) {
  const cx = colX + 100;
  return `
  <rect x="${colX}" y="420" width="200" height="32" rx="3" fill="#fef9c3" stroke="#d97706" stroke-width="1.5"/>
  <text x="${cx}" y="440" font-size="8" text-anchor="middle" fill="#92400e" letter-spacing="1" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">ADAPTERS</text>
  <line x1="${cx-40}" y1="452" x2="${cx-58}" y2="502" stroke="#d1d5db" stroke-width="1.2"/>
  <line x1="${cx}"    y1="452" x2="${cx}"    y2="502" stroke="#d1d5db" stroke-width="1.2"/>
  <line x1="${cx+40}" y1="452" x2="${cx+58}" y2="502" stroke="#d1d5db" stroke-width="1.2"/>`;
}

// ── After panel: vendor row ────────────────────────────────────────────────────

function vendorRow(colX, vendors) {
  const cx = colX + 100;
  const offsets = [-70, 0, 70];
  return vendors.map((v, i) => {
    const vx = cx + offsets[i] - 30;
    return `
  <rect x="${vx}" y="502" width="60" height="30" rx="3" fill="#f9fafb" stroke="#9ca3af" stroke-width="1"/>
  <text x="${vx + 30}" y="521" font-size="8" text-anchor="middle" fill="#6b7280" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">${v}</text>`;
  }).join('');
}

// ── Overlay connector (after) ─────────────────────────────────────────────────

function overlayConnector(cx) {
  return `<line x1="${cx}" y1="388" x2="${cx}" y2="420" stroke="#93c5fd" stroke-width="1.5"/>`;
}

// ── Full SVG ──────────────────────────────────────────────────────────────────

function renderSVG() {
  const beforeCols = [
    { x: 38,  label: 'State A', vendors: ['Eligibility', 'Case Mgmt', 'EDBC', 'Documents'] },
    { x: 240, label: 'State B', vendors: ['EligSys 2.0', 'IBM Curam', 'EDBC', 'DocuWare'] },
    { x: 442, label: 'State C', vendors: ['Eligibility', 'Salesforce', 'FACTS', 'Laserfiche'] },
  ];

  const afterCols = [
    { x: 720,  label: 'State A', vendors: ['Eligibility', 'Case Mgmt', 'EDBC'] },
    { x: 947,  label: 'State B', vendors: ['EligSys 2.0', 'IBM Curam', 'EDBC'] },
    { x: 1174, label: 'State C', vendors: ['FACTS', 'Salesforce', 'DocuWare'] },
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="630" viewBox="0 0 1400 630">

  <rect width="1400" height="630" fill="white"/>

  <!-- Header -->
  <rect x="0" y="0" width="1400" height="48" fill="#f9fafb"/>
  <line x1="0" y1="48" x2="1400" y2="48" stroke="#e5e7eb" stroke-width="1"/>
  <text x="700" y="30" font-size="14" text-anchor="middle" font-weight="700" fill="#111827" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Safety Net Blueprint — Adoption Model</text>

  <!-- Panel labels -->
  <text x="347" y="80" font-size="11" font-weight="600" text-anchor="middle" fill="#9ca3af" letter-spacing="1.5" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">WITHOUT THE BLUEPRINT</text>
  <text x="1047" y="80" font-size="11" font-weight="600" text-anchor="middle" fill="#2563eb" letter-spacing="1.5" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">WITH THE BLUEPRINT</text>

  <!-- Before panel background -->
  <rect x="20" y="92" width="655" height="520" rx="6" fill="#f9fafb" stroke="#e5e7eb" stroke-width="1"/>

  <!-- Panel divider -->
  <line x1="695" y1="56" x2="695" y2="622" stroke="#e5e7eb" stroke-width="1.5"/>

  ${beforeCols.map(c => beforeStateColumn(c.x, c.label, c.vendors)).join('')}

  <!-- Safety Net Blueprint foundation (shared across all after columns) -->
  <rect x="720" y="208" width="654" height="180" rx="6" fill="#eff6ff" stroke="#2563eb" stroke-width="2"/>
  <text x="1047" y="258" font-size="15" text-anchor="middle" font-weight="700" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Safety Net Blueprint</text>
  <text x="1047" y="280" font-size="10" text-anchor="middle" fill="#3b82f6" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">API contracts · State machines · Decision rules · Compliance</text>
  <text x="1047" y="298" font-size="10" text-anchor="middle" fill="#3b82f6" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Architecture best practices · Modern patterns · Industry research</text>
  <text x="1047" y="383" font-size="9" text-anchor="middle" fill="#93c5fd" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">One shared investment — adopted by every state</text>

  <!-- State overlays (thin, inside blueprint block) -->
  <rect x="730" y="318" width="174" height="52" rx="3" fill="#dbeafe" stroke="#60a5fa" stroke-width="1" stroke-dasharray="4,3"/>
  <text x="817" y="340" font-size="9" text-anchor="middle" font-weight="600" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State A Overlay</text>
  <text x="817" y="356" font-size="8" text-anchor="middle" fill="#3b82f6" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State-specific rules</text>

  <rect x="960" y="318" width="174" height="52" rx="3" fill="#dbeafe" stroke="#60a5fa" stroke-width="1" stroke-dasharray="4,3"/>
  <text x="1047" y="340" font-size="9" text-anchor="middle" font-weight="600" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State B Overlay</text>
  <text x="1047" y="356" font-size="8" text-anchor="middle" fill="#3b82f6" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State-specific rules</text>

  <rect x="1190" y="318" width="174" height="52" rx="3" fill="#dbeafe" stroke="#60a5fa" stroke-width="1" stroke-dasharray="4,3"/>
  <text x="1277" y="340" font-size="9" text-anchor="middle" font-weight="600" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State C Overlay</text>
  <text x="1277" y="356" font-size="8" text-anchor="middle" fill="#3b82f6" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State-specific rules</text>

  ${afterCols.map(c => afterStateColumn(c.x, c.label)).join('')}
  ${afterCols.map(c => overlayConnector(c.x + 100)).join('')}
  ${afterCols.map(c => adapterBar(c.x)).join('')}
  ${afterCols.map(c => vendorRow(c.x, c.vendors)).join('')}

  <!-- Column separators -->
  <line x1="934"  y1="100" x2="934"  y2="622" stroke="#f3f4f6" stroke-width="1"/>
  <line x1="1161" y1="100" x2="1161" y2="622" stroke="#f3f4f6" stroke-width="1"/>

  <!-- Navigation chrome (hidden in PNG export) -->
  <g id="nav-chrome">
    <rect id="detail-trigger" x="710" y="56" width="674" height="566" fill="transparent" rx="4" cursor="pointer"/>
    <text x="1366" y="610" font-size="10" text-anchor="end" fill="#93c5fd" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" pointer-events="none">Click to see how customization works →</text>
  </g>

</svg>`;
}

// ── Export SVG string for SPA assembly ───────────────────────────────────────

export function overviewSVG() {
  return renderSVG();
}
