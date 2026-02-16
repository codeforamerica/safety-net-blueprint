import '@trussworks/react-uswds/lib/uswds.css';
import '@trussworks/react-uswds/lib/index.css';

import type { Preview } from '@storybook/react';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      bottomPanelHeight: 0,
      storySort: {
        order: ['Forms', 'Scenarios'],
      },
    },
  },
  initialGlobals: {
    panel: false,
  },
};

export default preview;
