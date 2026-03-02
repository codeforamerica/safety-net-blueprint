import { defineConfig } from 'vite';
import { resolve } from 'path';
import yaml from '@modyfi/vite-plugin-yaml';

export default defineConfig({
  plugins: [yaml()],
  resolve: {
    alias: {
      '@harness': resolve(__dirname, '../harness-designer'),
      '@contracts': resolve(__dirname, './contracts'),
      '@openapi': resolve(__dirname, '../contracts'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
