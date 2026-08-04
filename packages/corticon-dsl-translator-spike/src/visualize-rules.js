#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { posix as posixPath } from 'node:path';
import { isBlankTemplateRule } from './corticon/rulesheet.js';
import { resolveRuleflowContext } from './classify/ruleflow-context.js';
import { entriesOf } from './map-utils.js';
import { parseCliArgs } from './cli-utils.js';
import { FONT, PALETTE, box, arrow, wrapSvgAsHtml, escapeXml } from './diagram-utils.js';

function printUsage() {
  console.error('Usage: node src/visualize-rules.js <project.json> [--out <file.html>]');
  console.error('  <project.json> is the output of ANY phase script that carries the project through --');
  console.error('  ingest-project.js --out (the project itself), or graph-project.js/classify-project.js/');
  console.error('  translate-project.js --out (each wraps it as { project, ... }).');
  console.error('  --out defaults to generated/rules-diagram.html');
  console.error('Example: node src/ingest-project.js fixtures/all-patterns --out generated/all-patterns.json');
  console.error('         node src/visualize-rules.js generated/all-patterns.json --out generated/all-patterns-diagram.html');
}

/** Every rulesheet/ruleflow map used below expects Map.get() -- normalize the JSON-deserialized plain-object shape (or the still-live Map, either is possible depending which phase's --out this came from) into real Maps once, up front. */
function normalizeProject(raw) {
  const project = raw.project ?? raw;
  return { ...project, rulesheets: new Map(entriesOf(project.rulesheets)), ruleflows: new Map(entriesOf(project.ruleflows)) };
}

// Same visual language as packages/explorer/context-map/src/render.js -- reusing
// this repo's existing diagram color vocabulary (via diagram-utils.js's PALETTE)
// rather than inventing a new one, so a reader who's seen the context map
// recognizes the same meaning: teal = confirmed/real, purple = a decision point,
// tan/dashed = not live, dark navy = an external call (context-map's own "api"
// color, reused here for a service call-out -- both are the same real-world
// thing, an outbound call to something outside this system).
const COLOR = {
  rulesheet: PALETTE.teal,
  branch: PALETTE.purple,
  serviceCallout: PALETTE.amber,
  unreachable: PALETTE.tan,
  loopBorder: PALETTE.flag,
  // No PALETTE color left unused by the rule-flow boxes above -- a plain
  // white/gray box is deliberate here anyway: the Vocabulary isn't a rule, a
  // decision, or an external call, so it shouldn't visually read as one.
  vocabulary: { fill: '#ffffff', stroke: '#9ca3af' },
};

const BOX_W = 520;
const V_GAP = 30;
const H_GAP = 50;
const PAD = 24;

/**
 * A statement never wraps mid-line -- confirmed genuinely ambiguous, not just
 * cosmetic: a wrapped continuation line ("= true") looked visually identical to a
 * new, separate action starting fresh, with no way to tell them apart. Rather than
 * wrap and add a separator, the box itself grows wide enough to fit its own
 * longest line, so a statement is always shown whole. Rough monospace/bold
 * character-width estimates, not real font-metrics measurement -- good enough
 * for a diagram whose job is showing real content unambiguously, not exact
 * typesetting.
 */
function boxWidthFor(title, sublabel, bodyLines) {
  const candidates = [title.length * 7.5, sublabel ? sublabel.length * 6.2 : 0, ...bodyLines.map((l) => l.length * 6.5)];
  return Math.max(BOX_W, Math.ceil(Math.max(...candidates)) + 24);
}

function toPosix(p) {
  return p.split('\\').join('/');
}

function resolveInvokes(invokes, fromKey, ruleflowKeys, rulesheetKeys) {
  if (!invokes) return { kind: 'unknown', file: null };
  if (invokes.startsWith('#//@ruleflow/@connectorList')) {
    const match = invokes.match(/@connectorList\.(\d+)/);
    return { kind: 'connector', file: null, connectorIndex: match ? Number(match[1]) : 0 };
  }
  const hashIndex = invokes.indexOf('#//@');
  const rawPath = hashIndex >= 0 ? invokes.slice(0, hashIndex) : invokes;
  const decodedPath = decodeURIComponent(rawPath);
  const fromDir = posixPath.dirname(toPosix(fromKey));
  const resolved = posixPath.normalize(posixPath.join(fromDir === '.' ? '' : fromDir, decodedPath));
  const ruleflowMatch = ruleflowKeys.find((k) => toPosix(k) === resolved);
  if (ruleflowMatch) return { kind: 'ruleflow', file: ruleflowMatch };
  const rulesheetMatch = rulesheetKeys.find((k) => toPosix(k) === resolved);
  if (rulesheetMatch) return { kind: 'rulesheet', file: rulesheetMatch };
  return { kind: 'unknown', file: resolved };
}

/**
 * One "IF <conditions>" line and one line per real action per real rule (blank
 * template row excluded) -- this is the actual rule content the diagram exists to
 * show, not just which rulesheets exist. NEVER wrapped -- see boxWidthFor, which
 * grows the box instead, so a statement is always shown whole with no ambiguity
 * about where it ends. Each condition column is individually parenthesized before
 * joining with "AND", not just concatenated -- confirmed necessary, not cosmetic:
 * a single condition column's own text can carry an internal "or" (DC Medicaid's
 * real "Person.isInmate = F or Person.isInmate = null"), and joining that bare
 * with another AND-ed condition reads ambiguously (does AND bind the whole
 * "X or Y", or just the "Y" half?). This is the same real grouping bug found and
 * fixed in build-facts.js's own compileGuard -- see TRANSLATION-PATTERNS.md.
 */
// Maps a rule's own raw `overrides`/`overriddenBy` indices (Corticon's numbering,
// which still counts the blank/template row) to the "Rule N" numbers actually
// shown on the diagram (which don't) -- resolved once per rulesheet from the same
// filter pass that builds `realRules`, so the two numberings can never drift
// apart. Throws rather than silently showing a raw/wrong index if a real ref
// somehow points at the blank row itself or past the end of the array -- same
// reasoning as every other throw in this file: a fallback here would hide a real
// extraction bug, not display one.
function describeRuleRefs(rawIndices, displayIndexByRawIndex) {
  return rawIndices
    .map((rawIndex) => {
      const displayIndex = displayIndexByRawIndex.get(rawIndex);
      if (displayIndex === undefined) throw new Error(`Override reference to raw rule index ${rawIndex} doesn't resolve to a real, displayed rule`);
      return `Rule ${displayIndex}`;
    })
    .join(', ');
}

function rulesheetDetailLines(rulesheet) {
  const displayIndexByRawIndex = new Map();
  const realRules = [];
  rulesheet.rules.forEach((rule, rawIndex) => {
    if (isBlankTemplateRule(rule)) return;
    displayIndexByRawIndex.set(rawIndex, realRules.length);
    realRules.push(rule);
  });
  const lines = [];
  if (rulesheet.description) lines.push(rulesheet.description, '');
  // Multiple rules in one rulesheet are NOT sequential if/elseif -- Corticon's
  // decision-table model treats them as independent alternative rows, and its
  // default guarantee (Design-Time-Inferencing) requires them to be mutually
  // exclusive unless the rule author has set an explicit Override -- closer to a
  // switch/select than an if/elseif chain. That reasoning lives in
  // TRANSLATION-PATTERNS.md, not as a special "Case"/"Default" label here: whether
  // a given rule has its own condition or is the unconditional fallback is already
  // visible directly in the rendered IF/THEN text itself (present vs. absent) --
  // a separate naming scheme on top of that content turned out to be more
  // confusion than clarity, not less. A real Override IS shown explicitly, though
  // -- it's not implied by the rule's own condition text the way Case/Default was,
  // so leaving it out would hide a real, load-bearing priority relationship.
  realRules.forEach((rule, i) => {
    const realConditions = rule.conditions.filter(Boolean);
    const conditions = realConditions.length > 1 ? realConditions.map((c) => `(${c.text})`).join(' AND ') : realConditions[0]?.text;
    const overrideParts = [];
    if (rule.overrides) overrideParts.push(`overrides ${describeRuleRefs(rule.overrides, displayIndexByRawIndex)}`);
    if (rule.overriddenBy) overrideParts.push(`overridden by ${describeRuleRefs(rule.overriddenBy, displayIndexByRawIndex)}`);
    const overrideSuffix = overrideParts.length ? ` [${overrideParts.join('; ')}]` : '';
    const name = (rule.comment ? rule.comment.text : `Rule ${i}`) + overrideSuffix;
    lines.push(`${name}:`);
    // "THEN" only makes sense completing an "IF" -- an unconditional rule (no real
    // conditions at all, confirmed real: CreateHouseholds.ers/InitialBenefit.ers
    // both have zero <condition> elements in the raw XML, not just empty ones)
    // gets its actions shown as plain statements instead, not a dangling "THEN"
    // with nothing above it to complete. IF and its first action's THEN share one
    // line now that nothing wraps -- the box just grows wider instead -- with any
    // further action indented on its own line beneath, aligned under the first.
    const realActions = rule.actions.filter(Boolean);
    const actionTexts = realActions.length ? realActions.map((a) => a.text) : ['(no action)'];
    const firstPrefix = conditions ? `    IF ${conditions} THEN ` : '        ';
    lines.push(`${firstPrefix}${actionTexts[0]}`);
    const indent = ' '.repeat(firstPrefix.length);
    for (const actionText of actionTexts.slice(1)) {
      lines.push(`${indent}${actionText}`);
    }
  });
  if (!lines.length) lines.push('(no real rules)');
  return lines;
}

/**
 * One "name: Type" (or "name -> Entity []" for an association) line per attribute --
 * the .ecore Vocabulary that every rulesheet's terms are ultimately typed against,
 * previously entirely absent from this diagram (confirmed real gap: "what about the
 * vocabulary in .ecore?"). Throws if a real attribute's own type name is missing --
 * a silent "?" placeholder here would be the same class of bug as the branch-label
 * fallback that turned out to be masking a real extraction failure: a fallback for
 * data that should always be resolvable hides the bug instead of surfacing it.
 */
function entityAttributeLines(entity, customTypes) {
  const lines = [];
  for (const [attrName, attr] of entriesOf(entity.attributes)) {
    if (!attr.type?.name) throw new Error(`Vocabulary attribute "${attrName}" has no resolved type name -- real vocabulary.js data should always have one; a silent "?" placeholder here would hide a real extraction gap`);
    const collectionMark = attr.isCollection ? ' []' : '';
    if (attr.kind === 'association') {
      lines.push(`${attrName} -> ${attr.type.name}${collectionMark}`);
    } else if (attr.type.kind === 'customType' && customTypes) {
      const ct = customTypes.get(attr.type.name);
      if (ct?.isEnum && ct.values?.length) {
        lines.push(`${attrName}: ${ct.values.join(' | ')}${collectionMark}`);
      } else {
        lines.push(`${attrName}: ${attr.type.name}${collectionMark}`);
      }
    } else {
      lines.push(`${attrName}: ${attr.type.name}${collectionMark}`);
    }
  }
  return lines.length ? lines : ['(no attributes)'];
}

/** Lays out every entity from every real Vocabulary file as its own box, wrapped into rows once a row holds 4 -- a flat list, not a real entity-relationship diagram with association lines drawn between boxes (no fixture yet has enough entities for that to matter more than this simpler layout). */
function layoutVocabulary(project, originX, originY) {
  const svg = [];
  let x = originX;
  let y = originY;
  let rowHeight = 0;
  let colCount = 0;
  let maxWidth = originX;
  for (const [vocabFile, vocab] of entriesOf(project.vocabularies)) {
    svg.push(`<text x="${originX}" y="${y}" font-size="13" font-weight="700" fill="#374151" font-family="${FONT}">Vocabulary: ${escapeXml(vocabFile)}</text>`);
    y += 26;
    for (const [entityName, entity] of entriesOf(vocab.entities)) {
      if (colCount === 4) {
        x = originX;
        y += rowHeight + V_GAP;
        rowHeight = 0;
        colCount = 0;
      }
      const customTypesMap = new Map(entriesOf(vocab.customTypes));
      const lines = entityAttributeLines(entity, customTypesMap);
      const w = boxWidthFor(entityName, null, lines);
      const { svg: s, height } = box(x, y, w, entityName, null, lines, COLOR.vocabulary, false);
      svg.push(s);
      rowHeight = Math.max(rowHeight, height);
      maxWidth = Math.max(maxWidth, x + w);
      x += w + H_GAP;
      colCount++;
    }
    y += rowHeight + V_GAP;
    x = originX;
    rowHeight = 0;
    colCount = 0;
  }
  return { svg: svg.join('\n'), width: maxWidth - originX, exitY: y };
}

/**
 * Lays out one ruleflow's nodes top-to-bottom, recursing into nested ruleflows and
 * branch targets. Returns { svg, width, height, entryX, entryY, exitX, exitY } so
 * the caller can connect an arrow into/out of this whole block -- deliberately NOT
 * a general-purpose auto-layout engine: this spike's fixtures have at most one
 * branch fork per row and one level of loop-nesting, and handling exactly that
 * (rather than the fully general case) is what makes a straightforward recursive
 * stack-and-fork layout sufficient here. A project with deeper/wider branching
 * would need a real graph-layout library, not this.
 */
function layoutRuleflow(project, ruleflowKey, ruleflowKeys, rulesheetKeys, originX, originY, visited) {
  const svg = [];
  let y = originY;
  let maxWidth = BOX_W;
  const flow = project.ruleflows.get(ruleflowKey);
  let prevExit = null;

  // Draws a connecting arrow from `from` to (toX, toY). When the previous exit
  // was the "otherwise, skip" bypass path (from.dashed === true), the connecting
  // segment is also dashed -- so the entire bypass route (horizontal right, down,
  // horizontal left, then this final segment to the next node) reads as one
  // continuous dashed path with a single arrowhead at the destination, rather
  // than a dashed route that abruptly ends in mid-air followed by a separate
  // solid arrow to the actual box.
  function connect(from, toX, toY) {
    if (!from) return null;
    if (from.dashed) return `<line x1="${from.x}" y1="${from.y}" x2="${toX}" y2="${toY}" stroke="#6b7280" stroke-width="1.5" stroke-dasharray="3,3" marker-end="url(#arrow)"/>`;
    return arrow(from.x, from.y, toX, toY);
  }

  if (visited.has(ruleflowKey)) {
    const { svg: s, height } = box(originX, y, BOX_W, `(${ruleflowKey}, shown above)`, null, [], COLOR.unreachable, true);
    svg.push(s);
    return { svg: svg.join('\n'), width: BOX_W, height, entryX: originX + BOX_W / 2, entryY: y, exitX: originX + BOX_W / 2, exitY: y + height };
  }
  visited.add(ruleflowKey);

  // The .erf ruleflow FILE itself never got any visible representation before --
  // only the .ers rulesheets it invokes showed up as boxes, with the ruleflow
  // structure only implied by sequencing/branching/loop-wrapping. Confirmed real
  // confusion: "where are the erf's?" -- fixed with an explicit label naming the
  // real ruleflow file every layout block belongs to.
  const labelY = y;
  svg.push(`<text x="${originX}" y="${labelY}" font-size="13" font-weight="700" fill="#374151" font-family="${FONT}">Ruleflow: ${escapeXml(ruleflowKey)}</text>`);
  y += 26;
  // An incoming arrow should point at the actual FIRST BOX, not at this label's
  // own text baseline sitting 26px above it -- confirmed real disconnect: the
  // arrow visually stopped short of any real content once other spacing changes
  // shifted things around, because `entryY` used to be `originY` (the label's own
  // position), not where node layout actually begins.
  const entryY = y;
  // Same reasoning for X: boxes now have DYNAMIC widths (see boxWidthFor), so a
  // fixed `originX + BOX_W / 2` no longer reliably lands on the real first box's
  // own center once that box is wider or narrower than the old fixed BOX_W.
  // Captured from whichever real box turns out to be first, below.
  let entryX = originX + BOX_W / 2;
  let entryXCaptured = false;

  for (const node of flow.nodes ?? []) {
    if (node.kind === 'ActivityNode') {
      const resolved = resolveInvokes(node.invokes, ruleflowKey, ruleflowKeys, rulesheetKeys);
      if (resolved.kind === 'rulesheet') {
        const rulesheet = project.rulesheets.get(resolved.file);
        const label = `${node.iterative ? `${node.name} [LOOP]` : node.name} (${resolved.file})`;
        const lines = rulesheetDetailLines(rulesheet);
        const w = boxWidthFor(label, null, lines);
        if (!entryXCaptured) { entryX = originX + w / 2; entryXCaptured = true; }
        const { svg: s, height } = box(originX, y, w, label, null, lines, COLOR.rulesheet, false);
        if (node.iterative) {
          svg.push(`<rect x="${originX - 10}" y="${y - 10}" width="${w + 20}" height="${height + 20}" rx="10" fill="none" stroke="${COLOR.loopBorder}" stroke-width="1.5" stroke-dasharray="6,4"/>`);
        }
        svg.push(s);
        if (prevExit) svg.push(connect(prevExit, originX + w / 2, y));
        prevExit = { x: originX + w / 2, y: y + height };
        maxWidth = Math.max(maxWidth, originX + w - originX);
        y += height + V_GAP;
      } else if (resolved.kind === 'ruleflow') {
        // An iterative nested ruleflow draws its own "ITERATIVE LOOP: NAME" label
        // and dashed border ABOVE its own content (at y-20/y-14), on top of that
        // nested layout's own "Ruleflow: ...erf" label drawn at its own origin --
        // confirmed real overlap when whatever came immediately before (e.g. a
        // branch's own "(otherwise, skip)" routing arrow, or another iterative
        // loop's own label) didn't leave room for both. Extra clearance reserved
        // here, on top of the ordinary V_GAP already applied by whatever produced
        // this `y`, specifically for this case.
        if (node.iterative) y += 24;
        const nested = layoutRuleflow(project, resolved.file, ruleflowKeys, rulesheetKeys, originX, y, visited);
        if (!entryXCaptured) { entryX = nested.entryX; entryXCaptured = true; }
        if (node.iterative) {
          svg.push(`<rect x="${originX - 14}" y="${y - 14}" width="${nested.width + 28}" height="${nested.height + 28}" rx="12" fill="none" stroke="${COLOR.loopBorder}" stroke-width="2" stroke-dasharray="6,4"/>`);
          svg.push(`<text x="${originX - 14}" y="${y - 20}" font-size="11" font-weight="700" fill="${COLOR.loopBorder}" font-family="${FONT}">ITERATIVE LOOP: ${escapeXml(node.name)}</text>`);
        }
        svg.push(nested.svg);
        if (prevExit) svg.push(connect(prevExit, nested.entryX, nested.entryY));
        maxWidth = Math.max(maxWidth, nested.width);
        prevExit = { x: nested.exitX, y: nested.exitY };
        y = nested.exitY + V_GAP;
      } else if (resolved.kind === 'connector') {
        const connectorList = [...entriesOf(flow.connectors).map(([, c]) => c)];
        const connector = connectorList[resolved.connectorIndex];
        const connectorLabel = `${node.name} (${ruleflowKey})`;
        const calloutLines = connector?.className ? [`SERVICE CALL-OUT: ${connector.className}`] : ['SERVICE CALL-OUT'];
        const w = boxWidthFor(connectorLabel, null, calloutLines);
        if (!entryXCaptured) { entryX = originX + w / 2; entryXCaptured = true; }
        const { svg: s, height } = box(originX, y, w, connectorLabel, null, calloutLines, COLOR.serviceCallout, false);
        svg.push(s);
        if (prevExit) svg.push(connect(prevExit, originX + w / 2, y));
        prevExit = { x: originX + w / 2, y: y + height };
        y += height + V_GAP;
      }
    } else {
      // BranchContainer: draw the branch box, then lay its targets out side by side
      // beneath it -- one column per branch. Each branch's own target list is
      // rendered as its own short vertical stack (not recursing into nested
      // ruleflows from inside a branch -- not confirmed real in any fixture yet).
      // Throws rather than silently showing "?" if a real BranchContainer's own
      // condition text is missing -- same reasoning as entityAttributeLines above.
      if (!node.condition?.text) throw new Error(`BranchContainer "${node.name}" has no resolved condition text -- real ruleflow.js data should always have one for a real BranchContainer; a silent "?" placeholder here would hide a real extraction gap`);
      const branchLines = [node.condition.isEnum ? `SWITCH ${node.condition.text}` : `IF ${node.condition.text}`];
      const branchTitle = `${node.name} (${ruleflowKey})`;
      const branchW = boxWidthFor(branchTitle, null, branchLines);
      if (!entryXCaptured) { entryX = originX + branchW / 2; entryXCaptured = true; }
      const { svg: s, height: branchHeight } = box(originX, y, branchW, branchTitle, null, branchLines, COLOR.branch, false);
      svg.push(s);
      if (prevExit) svg.push(connect(prevExit, originX + branchW / 2, y));
      const branchTop = y + branchHeight + V_GAP;
      let branchX = originX;
      let tallestBranch = 0;
      let rightExtent = originX + branchW;
      const branchExits = [];
      for (const branch of node.branches ?? []) {
        let by = branchTop;
        // Label each branch arrow with the enum/value(s) it matches -- strip the
        // type-name prefix (e.g. "programTrack#trackA" -> "trackA") so only the
        // meaningful value is shown. For non-enum branches (e.g. "true"/"false"),
        // the label is used as-is.
        const rawLabels = (branch.labels ?? []).map((l) => (l.includes('#') ? l.slice(l.lastIndexOf('#') + 1) : l));
        const branchLabel = rawLabels.length ? rawLabels.join(' | ') : null;
        svg.push(arrow(originX + branchW / 2, y + branchHeight, branchX + branchW / 2, branchTop, branchLabel));
        // A branch's own targets can chain more than one node (confirmed real:
        // this fixture's own DisabilityBranchA -> DisabilityBranchB both run,
        // in sequence, under the SAME "true" branch -- see ruleflow.js's own
        // comment). An earlier version of this loop only connected the branch
        // box to the FIRST target and then silently stacked every later target
        // below it with no arrow at all, making a real chained target look like
        // an unconnected, orphaned box.
        let branchPrevExit = null;
        let branchColW = branchW;
        for (const target of branch.targets ?? []) {
          const resolved = resolveInvokes(target.invokes, ruleflowKey, ruleflowKeys, rulesheetKeys);
          if (resolved.kind !== 'rulesheet') continue;
          const rulesheet = project.rulesheets.get(resolved.file);
          const lines = rulesheetDetailLines(rulesheet);
          const targetLabel = `${target.name} (${resolved.file})`;
          const w = boxWidthFor(targetLabel, null, lines);
          branchColW = Math.max(branchColW, w);
          const { svg: ts, height: th } = box(branchX, by, w, targetLabel, null, lines, COLOR.rulesheet, false);
          if (branchPrevExit) svg.push(arrow(branchPrevExit.x, branchPrevExit.y, branchX + w / 2, by));
          svg.push(ts);
          branchPrevExit = { x: branchX + w / 2, y: by + th };
          by += th + V_GAP;
        }
        tallestBranch = Math.max(tallestBranch, by - branchTop);
        rightExtent = Math.max(rightExtent, branchX + branchColW);
        if (branchPrevExit) branchExits.push(branchPrevExit);
        branchX += branchColW + H_GAP;
      }
      const convergeY = branchTop + tallestBranch - V_GAP;
      // Every branch here (confirmed real in every fixture so far) only labels the
      // value(s) it explicitly matches -- Corticon's own file format never shows a
      // declared "otherwise"/"false" branch alongside it. That's a REAL condition
      // with no visible alternative path, not a true/false fork -- so what happens
      // when nothing matches (skip straight past every branch's targets to
      // whatever comes next) has to be drawn explicitly, routed around the
      // branch's own target boxes rather than through them, or a reader has no way
      // to tell "this always happens" from "this only happens sometimes, and here
      // is where execution goes otherwise".
      const routeX = rightExtent + 40;
      const otherwiseY = y + branchHeight / 2;
      // Routed with clearance BELOW the tallest branch column's own bottom edge
      // (convergeY), not exactly at it -- confirmed real overlap when the return
      // segment ran flush against the box border. All three segments share the
      // same dashed style and the same arrowhead marker, drawn manually here
      // (not via the shared arrow() helper, which always draws solid) so the
      // whole routed path reads as one consistent "this is the skip path" line,
      // not dashed-then-suddenly-solid.
      const returnY = convergeY + 15;
      svg.push(`<line x1="${originX + branchW}" y1="${otherwiseY}" x2="${routeX}" y2="${otherwiseY}" stroke="#6b7280" stroke-width="1.5" stroke-dasharray="3,3"/>`);
      svg.push(`<line x1="${routeX}" y1="${otherwiseY}" x2="${routeX}" y2="${returnY}" stroke="#6b7280" stroke-width="1.5" stroke-dasharray="3,3"/>`);
      svg.push(`<line x1="${routeX}" y1="${returnY}" x2="${originX + branchW / 2}" y2="${returnY}" stroke="#6b7280" stroke-width="1.5" stroke-dasharray="3,3"/>`);
      svg.push(`<text x="${routeX + 6}" y="${(otherwiseY + returnY) / 2}" font-size="11" fill="#6b7280" font-family="${FONT}">(if no match, skip)</text>`);
      // Draw convergence arrows: each branch column's last exit drops down to
      // returnY, showing that matched branches execute their targets and then
      // fall through to the same continuation point as the skip path. The
      // center column (same X as the branch container's own center) draws a
      // SOLID line -- that's the normal matched-branch flow, continuing
      // straight to the next node. Off-center columns draw dashed -- they are
      // lateral branches converging back. Drawing center-column as dashed
      // would make it visually merge with the solid connect() arrow that
      // follows, producing the half-dotted/half-solid artifact seen when a
      // single branch column sits at center X.
      const centerX = originX + branchW / 2;
      for (const exit of branchExits) {
        if (exit.y < returnY) {
          const atCenter = Math.abs(exit.x - centerX) < 1;
          if (atCenter) {
            svg.push(`<line x1="${exit.x}" y1="${exit.y}" x2="${exit.x}" y2="${returnY}" stroke="#6b7280" stroke-width="1.5"/>`);
          } else {
            svg.push(`<line x1="${exit.x}" y1="${exit.y}" x2="${exit.x}" y2="${returnY}" stroke="#6b7280" stroke-width="1.5" stroke-dasharray="3,3"/>`);
          }
        }
      }
      maxWidth = Math.max(maxWidth, branchX - originX - H_GAP, routeX - originX + 120);
      prevExit = { x: originX + branchW / 2, y: returnY };
      y = returnY + V_GAP;
    }
  }

  return {
    svg: svg.join('\n'),
    width: maxWidth,
    height: y - originY - V_GAP,
    entryX,
    entryY,
    exitX: prevExit ? prevExit.x : entryX,
    exitY: prevExit ? prevExit.y : entryY,
  };
}

function renderDiagram(project, context) {
  const ruleflowKeys = [...project.ruleflows.keys()];
  const rulesheetKeys = [...project.rulesheets.keys()];
  const visited = new Set();
  const blocks = [];
  let y = PAD;
  let maxWidth = 0;

  // The Vocabulary (.ecore) comes first -- every rulesheet's own terms are typed
  // against it, so it's the foundation the rest of the diagram builds on, not an
  // afterthought.
  const vocab = layoutVocabulary(project, PAD, y);
  blocks.push(vocab.svg);
  y = vocab.exitY + V_GAP;
  maxWidth = Math.max(maxWidth, vocab.width);

  for (const root of context.roots) {
    const laid = layoutRuleflow(project, root, ruleflowKeys, rulesheetKeys, PAD, y, visited);
    blocks.push(laid.svg);
    y = laid.exitY + V_GAP * 2;
    maxWidth = Math.max(maxWidth, laid.width);
  }

  if (context.unreachable.length) {
    blocks.push(`<text x="${PAD}" y="${y}" font-size="13" font-weight="700" fill="#374151" font-family="${FONT}">Unreachable (never invoked):</text>`);
    let uy = y + 20;
    for (const key of context.unreachable) {
      const lines = rulesheetDetailLines(project.rulesheets.get(key));
      const w = boxWidthFor(`${key} — dead content`, null, lines);
      const { svg: s, height } = box(PAD, uy, w, `${key} — dead content`, null, lines, COLOR.unreachable, true);
      blocks.push(s);
      maxWidth = Math.max(maxWidth, PAD + w);
      uy += height + 16;
    }
    y = uy;
  }

  const width = maxWidth + PAD * 2;
  const height = y + PAD;

  return wrapSvgAsHtml('Corticon rules diagram', width, height, blocks.join('\n'));
}

const args = parseCliArgs(process.argv);
if (!args) {
  printUsage();
  process.exit(0);
}

const project = normalizeProject(JSON.parse(readFileSync(args.positional, 'utf-8')));
const context = resolveRuleflowContext(project);
const html = renderDiagram(project, context);
const outFile = args.outFile ?? 'generated/rules-diagram.html';
writeFileSync(outFile, html);
console.log(`Wrote diagram to ${outFile}`);
