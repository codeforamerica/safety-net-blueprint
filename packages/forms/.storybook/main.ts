import type { StorybookConfig } from '@storybook/react-vite';
import yaml from '@modyfi/vite-plugin-yaml';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal(config) {
    config.plugins = config.plugins ?? [];
    config.plugins.push(yaml());

    // Allow ?raw imports for YAML source display
    config.assetsInclude = config.assetsInclude ?? [];

    return config;
  },
};

export default config;
