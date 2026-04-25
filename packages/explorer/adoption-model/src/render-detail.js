#!/usr/bin/env node
/**
 * render-detail.js
 *
 * Generates the Customization Model detail page (customization-model.html).
 * Shows a single state's full adoption stack: UX layer → state overlay →
 * Safety Net Blueprint → adapters → vendor systems. Annotated with role
 * labels and right-side callouts explaining each layer.
 */


function renderSVG() {
  // Vendor rows: row 1 (solid) and row 2 (lighter, indicating there are more)
  const vendorsRow1 = ['Eligibility Engine', 'Case Management', 'Document Mgmt', 'Scheduling'];
  const vendorsRow2 = ['EBT / Payments', 'Notices / NOA', 'Identity / Auth', 'Data Exchange'];

  const colWidth = 106;
  const colGap   = 14;
  const startX   = 488;
  const row1Y    = 584;
  const row2Y    = 638;

  const vendorBoxesRow1 = vendorsRow1.map((v, i) => {
    const x = startX + i * (colWidth + colGap);
    return `
  <rect x="${x}" y="${row1Y}" width="${colWidth}" height="34" rx="3" fill="#f9fafb" stroke="#9ca3af" stroke-width="1"/>
  <text x="${x + colWidth / 2}" y="${row1Y + 21}" font-size="8" text-anchor="middle" fill="#6b7280" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">${v}</text>`;
  }).join('');

  const vendorBoxesRow2 = vendorsRow2.map((v, i) => {
    const x = startX + i * (colWidth + colGap);
    return `
  <rect x="${x}" y="${row2Y}" width="${colWidth}" height="34" rx="3" fill="#f9fafb" stroke="#e5e7eb" stroke-width="1"/>
  <text x="${x + colWidth / 2}" y="${row2Y + 21}" font-size="8" text-anchor="middle" fill="#9ca3af" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">${v}</text>`;
  }).join('');

  // Dashed connectors from row 1 to row 2
  const row1to2 = vendorsRow1.map((_, i) => {
    const cx = startX + i * (colWidth + colGap) + colWidth / 2;
    return `<line x1="${cx}" y1="${row1Y + 34}" x2="${cx}" y2="${row2Y}" stroke="#d1d5db" stroke-width="1" stroke-dasharray="2,2"/>`;
  }).join('');

  // Fan-out lines from adapter bar to row 1 vendors
  const adapterFanOut = vendorsRow1.map((_, i) => {
    const vCx = startX + i * (colWidth + colGap) + colWidth / 2;
    return `<line x1="${570 + i * 80}" y1="552" x2="${vCx}" y2="${row1Y}" stroke="#d1d5db" stroke-width="1.2"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="760" viewBox="0 0 1400 760">

  <rect width="1400" height="760" fill="white"/>

  <!-- Header -->
  <rect x="0" y="0" width="1400" height="48" fill="#f9fafb"/>
  <line x1="0" y1="48" x2="1400" y2="48" stroke="#e5e7eb" stroke-width="1"/>

  <!-- Navigation chrome (hidden in PNG export) -->
  <g id="nav-chrome">
    <text id="breadcrumb" x="24" y="30" font-size="12" fill="#6b7280" cursor="pointer"
          font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">← Adoption Model</text>
    <text x="160" y="30" font-size="12" fill="#9ca3af" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"> / </text>
    <text x="174" y="30" font-size="12" font-weight="600" fill="#111827" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Customization Model</text>
  </g>


  <!-- ═══════════════════════════════════ CENTER STACK ════════════════════════════════ -->

  <!-- 1. State UX Layer -->
  <rect x="480" y="68" width="440" height="52" rx="4" fill="#e0e7ff" stroke="#818cf8" stroke-width="1.5"/>
  <text x="700" y="98" font-size="12" text-anchor="middle" font-weight="600" fill="#4338ca" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State UX Layer</text>

  <!-- UX → Overlay -->
  <line x1="700" y1="120" x2="700" y2="148" stroke="#c7d2fe" stroke-width="1.5"/>

  <!-- 2. State Overlay (thin) -->
  <rect x="480" y="148" width="440" height="60" rx="4" fill="#f0fdf4" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="6,3"/>
  <text x="700" y="174" font-size="11" text-anchor="middle" font-weight="600" fill="#15803d" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State Overlay</text>
  <text x="700" y="191" font-size="9" text-anchor="middle" fill="#16a34a" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State-specific eligibility rules · Local regulations · Custom fields</text>

  <!-- Overlay → Blueprint -->
  <line x1="700" y1="208" x2="700" y2="228" stroke="#93c5fd" stroke-width="1.5"/>

  <!-- 3. Safety Net Blueprint (large, shared) -->
  <rect x="480" y="228" width="440" height="268" rx="6" fill="#eff6ff" stroke="#2563eb" stroke-width="2"/>
  <text x="700" y="268" font-size="15" text-anchor="middle" font-weight="700" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Safety Net Blueprint</text>
  <text x="700" y="287" font-size="9" text-anchor="middle" fill="#93c5fd" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Shared investment — not built per state</text>

  <rect x="496" y="304" width="192" height="26" rx="3" fill="#dbeafe"/>
  <text x="592" y="321" font-size="9" text-anchor="middle" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">API Contracts (OpenAPI)</text>
  <rect x="496" y="338" width="192" height="26" rx="3" fill="#dbeafe"/>
  <text x="592" y="355" font-size="9" text-anchor="middle" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State Machines</text>
  <rect x="496" y="372" width="192" height="26" rx="3" fill="#dbeafe"/>
  <text x="592" y="389" font-size="9" text-anchor="middle" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Decision Rules</text>
  <rect x="496" y="406" width="192" height="26" rx="3" fill="#dbeafe"/>
  <text x="592" y="423" font-size="9" text-anchor="middle" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Domain Events</text>

  <rect x="712" y="304" width="192" height="26" rx="3" fill="#dbeafe"/>
  <text x="808" y="321" font-size="9" text-anchor="middle" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">SNAP / Medicaid Compliance</text>
  <rect x="712" y="338" width="192" height="26" rx="3" fill="#dbeafe"/>
  <text x="808" y="355" font-size="9" text-anchor="middle" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Modern Architecture Patterns</text>
  <rect x="712" y="372" width="192" height="26" rx="3" fill="#dbeafe"/>
  <text x="808" y="389" font-size="9" text-anchor="middle" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Mock Server + Client SDKs</text>
  <rect x="712" y="406" width="192" height="26" rx="3" fill="#dbeafe"/>
  <text x="808" y="423" font-size="9" text-anchor="middle" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Industry Research</text>

  <text x="700" y="472" font-size="9" text-anchor="middle" fill="#93c5fd" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Adopted as-is · Overlaid where needed · Never forked</text>

  <!-- Blueprint → Adapters -->
  <line x1="700" y1="496" x2="700" y2="516" stroke="#93c5fd" stroke-width="1.5"/>

  <!-- 4. Adapter bar -->
  <rect x="480" y="516" width="440" height="36" rx="3" fill="#fef9c3" stroke="#d97706" stroke-width="1.5"/>
  <text x="700" y="538" font-size="9" text-anchor="middle" fill="#92400e" letter-spacing="1" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">ADAPTERS — one per vendor system, built by the state</text>

  <!-- Adapter fan-out to vendor row 1 -->
  ${adapterFanOut}

  <!-- 5. Vendor systems -->
  ${vendorBoxesRow1}
  ${row1to2}
  ${vendorBoxesRow2}

  <text x="700" y="706" font-size="9" text-anchor="middle" fill="#d1d5db" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Swap any vendor — only its adapter changes</text>


  <!-- ═══════════════════════════════════ LEFT LABELS ══════════════════════════════════ -->

  <line x1="460" y1="94" x2="340" y2="94" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3,2"/>
  <rect x="238" y="84" width="76" height="20" rx="3" fill="#f3f4f6"/>
  <text x="276" y="98" font-size="9" text-anchor="middle" font-weight="600" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">STATE BUILDS</text>

  <line x1="460" y1="178" x2="340" y2="178" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3,2"/>
  <rect x="212" y="168" width="112" height="20" rx="3" fill="#f0fdf4"/>
  <text x="268" y="182" font-size="9" text-anchor="middle" font-weight="600" fill="#15803d" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">STATE CONFIGURES</text>

  <line x1="460" y1="362" x2="340" y2="362" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3,2"/>
  <rect x="196" y="352" width="128" height="20" rx="3" fill="#eff6ff"/>
  <text x="260" y="366" font-size="9" text-anchor="middle" font-weight="600" fill="#1d4ed8" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">BLUEPRINT PROVIDES</text>

  <line x1="460" y1="534" x2="340" y2="534" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3,2"/>
  <rect x="228" y="524" width="96" height="20" rx="3" fill="#f3f4f6"/>
  <text x="276" y="538" font-size="9" text-anchor="middle" font-weight="600" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">STATE WIRES UP</text>

  <line x1="480" y1="638" x2="340" y2="638" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3,2"/>
  <rect x="176" y="628" width="148" height="20" rx="3" fill="#f9fafb"/>
  <text x="250" y="642" font-size="9" text-anchor="middle" font-weight="600" fill="#6b7280" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">STATE'S EXISTING SYSTEMS</text>


  <!-- ═══════════════════════════════════ RIGHT CALLOUTS ════════════════════════════════ -->

  <line x1="940" y1="178" x2="1020" y2="178" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3,2"/>
  <rect x="1024" y="152" width="340" height="56" rx="4" fill="#f0fdf4" stroke="#86efac" stroke-width="1"/>
  <text x="1040" y="172" font-size="9" fill="#15803d" font-weight="600" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">What states typically configure:</text>
  <text x="1040" y="188" font-size="9" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">State-specific income thresholds · Program add-ons · Local</text>
  <text x="1040" y="202" font-size="9" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">agency codes · Custom workflow steps · Branding</text>

  <line x1="940" y1="362" x2="1020" y2="362" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3,2"/>
  <rect x="1024" y="290" width="340" height="148" rx="4" fill="#eff6ff" stroke="#bfdbfe" stroke-width="1"/>
  <text x="1040" y="312" font-size="9" fill="#1d4ed8" font-weight="600" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">What the blueprint provides out of the box:</text>
  <text x="1040" y="330" font-size="9" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">· Intake, eligibility, workflow, case mgmt API contracts</text>
  <text x="1040" y="346" font-size="9" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">· Application, interview, determination state machines</text>
  <text x="1040" y="362" font-size="9" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">· Federal SNAP / Medicaid compliance built in</text>
  <text x="1040" y="378" font-size="9" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">· Domain event model for loose coupling</text>
  <text x="1040" y="394" font-size="9" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">· Mock server + generated TypeScript clients</text>
  <text x="1040" y="418" font-size="9" fill="#93c5fd" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Vetted against JSM, ServiceNow, IBM Curam, Salesforce Gov</text>

  <line x1="940" y1="534" x2="1020" y2="534" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3,2"/>
  <rect x="1024" y="508" width="340" height="56" rx="4" fill="#fef9c3" stroke="#fcd34d" stroke-width="1"/>
  <text x="1040" y="528" font-size="9" fill="#92400e" font-weight="600" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">One adapter per vendor system:</text>
  <text x="1040" y="544" font-size="9" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Translates blueprint API calls → vendor-specific API calls.</text>
  <text x="1040" y="558" font-size="9" fill="#374151" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">Swap the vendor, rewrite only its adapter — nothing else changes.</text>

</svg>`;
}

// ── Export SVG string for SPA assembly ───────────────────────────────────────

export function detailSVG() {
  return renderSVG();
}
