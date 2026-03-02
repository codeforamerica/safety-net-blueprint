import type { StorybookConfig } from '@storybook/react-vite';
import yaml from '@modyfi/vite-plugin-yaml';
import { saveContractPlugin } from './save-contract-plugin';

const config: StorybookConfig = {
  stories: ['../storybook/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials', 'storybook-addon-tag-badges'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal(config) {
    config.plugins = config.plugins ?? [];
    config.plugins.push(yaml());
    config.plugins.push(saveContractPlugin());

    return config;
  },
};

export default config;
