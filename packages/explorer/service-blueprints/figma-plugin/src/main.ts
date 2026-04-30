import { renderBlueprint } from './renderer.js';
import intake from './_current.json';
import type { Blueprint } from './types.js';

const BLUEPRINTS: Record<string, Blueprint> = {
  intake: intake as Blueprint,
};

figma.showUI(__html__, { width: 320, height: 180, title: 'Service Blueprint' });

figma.ui.on('message', async (msg: { type: string; blueprint: string }) => {
  if (msg.type === 'generate') {
    const blueprint = BLUEPRINTS[msg.blueprint];
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
});
