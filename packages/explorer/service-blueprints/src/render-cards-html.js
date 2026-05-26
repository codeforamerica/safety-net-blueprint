#!/usr/bin/env node
/**
 * render-cards-html.js
 *
 * Generates an HTML preview of the policy cards for debugging.
 * Reads staged JSON from figma-plugin/src/; writes to dist/<domain>-cards.html.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir      = resolve(__dirname, '..', 'output');
const pluginSrcDir = resolve(__dirname, 'figma-plugin', 'src');

export function renderCardsHtml(domain) {
  const cards     = JSON.parse(readFileSync(resolve(pluginSrcDir, '_current_cards.json'), 'utf8'));
  const cardTypes = JSON.parse(readFileSync(resolve(pluginSrcDir, '_current_card_types.json'), 'utf8'));

  function resolveType(type) {
    const def = cardTypes.types[type];
    return (def?.rendersAs) ? cardTypes.types[def.rendersAs] || def : def || {};
  }

  function cardHtml(card) {
    const typeDef = resolveType(card.type);
    const headerBg = typeDef.headerBg || '#555';
    const headerFg = typeDef.headerFg || '#fff';
    const bodyBg   = typeDef.bodyBg   || '#f5f5f5';
    const bodyFg   = typeDef.bodyFg   || '#111';
    const label    = typeDef.label    || card.type.toUpperCase();
    return `
    <div style="border-radius:6px;overflow:hidden;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.12);">
      <div style="background:${headerBg};color:${headerFg};padding:4px 8px;font-size:10px;font-weight:700;letter-spacing:0.05em;">${label}</div>
      <div style="background:${bodyBg};color:${bodyFg};padding:8px 10px;">
        <div style="font-size:12px;font-weight:600;line-height:1.4;margin-bottom:4px;">${card.text}</div>
        ${card.subtext ? `<div style="font-size:11px;opacity:0.8;margin-bottom:4px;line-height:1.4;">${card.subtext}</div>` : ''}
        ${card.citation ? `<div style="font-size:10px;font-weight:600;opacity:0.6;">${card.citation}</div>` : ''}
      </div>
    </div>`;
  }

  const columnsHtml = cards.phases.map(phase => {
    const subPhasesHtml = phase.subPhases.map(sub => `
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #ddd;">${sub.label}</div>
        ${sub.cards.map(cardHtml).join('')}
      </div>`).join('');

    return `
    <div style="min-width:280px;max-width:320px;flex-shrink:0;background:#f9f9f9;border-radius:8px;padding:16px;border:1px solid #e0e0e0;">
      <div style="font-size:13px;font-weight:800;color:#1a1a1a;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #1a1a1a;">${phase.label}</div>
      ${subPhasesHtml}
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; padding: 24px; }</style>
</head>
<body>
  <div style="margin-bottom:20px;">
    <h1 style="font-size:16px;font-weight:800;color:#1a1a1a;">${cards.name} — Policy Cards</h1>
    <p style="font-size:12px;color:#888;margin-top:4px;">${cards.phases.reduce((n, p) => n + p.subPhases.reduce((m, s) => m + s.cards.length, 0), 0)} cards across ${cards.phases.length} phases</p>
  </div>
  <div style="display:flex;gap:16px;align-items:flex-start;">
    ${columnsHtml}
  </div>
</body>
</html>`;

  mkdirSync(distDir, { recursive: true });
  const htmlPath = resolve(distDir, `${domain}-cards.html`);
  writeFileSync(htmlPath, html);
  return htmlPath;
}
