// Figma plugin main thread — has access to the Figma API
// Communicates with the UI via figma.ui.postMessage / figma.ui.on('message', ...)

figma.showUI(__html__, { width: 320, height: 240, title: 'Service Blueprint' });

figma.ui.on('message', (msg: { type: string; blueprint: string }) => {
  if (msg.type === 'generate') {
    // Generation logic goes here (Phase 3)
    figma.notify('Generating service blueprint...');
  }
});
