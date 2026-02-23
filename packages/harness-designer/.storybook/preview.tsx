import '@trussworks/react-uswds/lib/uswds.css';
import '@trussworks/react-uswds/lib/index.css';
import '@safety-net/form-engine-react/src/theme';

import React, { useCallback } from 'react';
import type { Preview } from '@storybook/react';
import { useGlobals } from '@storybook/preview-api';
import { EditorVisibilityProvider } from '@safety-net/form-engine-react';

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
        method: 'alphabetical',
      },
    },
  },
  globalTypes: {
    editor: {
      description: 'Toggle the source editor panel',
      toolbar: {
        title: 'Editor',
        icon: 'markup',
        items: [
          { value: 'show', title: 'Show Editor', icon: 'eye' },
          { value: 'hide', title: 'Hide Editor', icon: 'eyeclose' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    panel: false,
    editor: 'show',
  },
  decorators: [
    (Story) => {
      const [globals, updateGlobals] = useGlobals();
      const visible = globals.editor !== 'hide';
      const setVisible = useCallback(
        (show: boolean) => updateGlobals({ editor: show ? 'show' : 'hide' }),
        [updateGlobals],
      );
      return (
        <EditorVisibilityProvider visible={visible} setVisible={setVisible}>
          <Story />
        </EditorVisibilityProvider>
      );
    },
  ],
};

export default preview;
