import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Local recordings and historical preview experiments are not product tests.
export default mergeConfig(viteConfig, defineConfig({
  test: { include: ['src/**/*.test.{ts,tsx}'] },
}));
