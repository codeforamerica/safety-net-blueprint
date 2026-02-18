import { describe, it, expect } from 'vitest';
import { dirs } from './config.js';

describe('storybook config', () => {
  it('exports correct directory paths', () => {
    expect(dirs).toEqual({
      contracts: 'authored/contracts',
      stories: 'storybook/stories',
      custom: 'storybook/custom',
    });
  });

  it('uses custom/ not snapshots/ for user-customized stories', () => {
    expect(dirs.custom).toBe('storybook/custom');
    expect(dirs).not.toHaveProperty('snapshots');
  });
});
