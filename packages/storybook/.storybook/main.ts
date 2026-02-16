import type { StorybookConfig } from '@storybook/react-vite';
import yaml from '@modyfi/vite-plugin-yaml';
import { saveContractPlugin } from './save-contract-plugin';

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
    config.plugins.push(saveContractPlugin());

    return config;
  },
};

export default config;
