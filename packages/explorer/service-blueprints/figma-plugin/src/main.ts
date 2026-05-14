import { renderBlueprint, renderCards } from './renderer.js';
import intake from './_current.json';
import cardsIntake from './_current_cards.json';
import type { Blueprint, CardData } from './types.js';

const BLUEPRINTS: Record<string, Blueprint> = {
  intake: intake as Blueprint,
};

const CARDS: Record<string, CardData> = {
  intake: cardsIntake as CardData,
};

figma.showUI(__html__, { width: 320, height: 240, title: 'Service Blueprint' });

figma.ui.on('message', async (msg: { type: string; blueprint?: string; domain?: string }) => {
  if (msg.type === 'generate') {
    const blueprint = BLUEPRINTS[msg.blueprint ?? ''];
    if (!blueprint) {
      figma.notify(`Unknown blueprint: ${msg.blueprint}`, { error: true });
      return;
    }
    try {
      await renderBlueprint(blueprint);
    } catch (e) {
      figma.notify(`Error: ${(e as Error).message}`, { error: true });
    }
  }

  if (msg.type === 'generate-cards') {
    const data = CARDS[msg.domain ?? ''];
    if (!data) {
      figma.notify(`Unknown domain: ${msg.domain}`, { error: true });
      return;
    }
    try {
      await renderCards(data);
    } catch (e) {
      figma.notify(`Error: ${(e as Error).message}`, { error: true });
    }
  }
});
