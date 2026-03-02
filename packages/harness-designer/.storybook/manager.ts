import { addons } from '@storybook/manager-api';
import { renderLabel, type TagBadgeParameters } from 'storybook-addon-tag-badges';

addons.setConfig({
  panelPosition: 'bottom',
  showPanel: false,
  sidebar: {
    collapsedRoots: [],
    renderLabel,
  },
  tagBadges: [
    {
      tags: 'custom',
      badge: {
        text: 'Custom',
        bgColor: '#dbeafe',
        fgColor: '#1e40af',
        tooltip: 'User-customized story variant',
      },
      display: {
        sidebar: [
          { type: 'story', skipInherited: false },
          { type: 'component', skipInherited: false },
        ],
        toolbar: false,
      },
    },
    {
      tags: 'read-only',
      badge: {
        text: 'Read-only',
        bgColor: '#f3f4f6',
        fgColor: '#6b7280',
        tooltip: 'Base story — Save as Custom to persist edits',
      },
      display: {
        sidebar: [
          { type: 'story', skipInherited: false },
          { type: 'component', skipInherited: false },
        ],
        toolbar: false,
      },
    },
  ] satisfies TagBadgeParameters,
});
