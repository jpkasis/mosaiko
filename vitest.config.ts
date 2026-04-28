import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // next-intl and a few other modules do their own CJS/ESM dance. Loading
    // them via vitest's default vitest-node transforms them on demand; keep
    // the config explicit about the extensions we care about so the resolver
    // doesn't wander into .d.ts files.
    globals: false,
    testTimeout: 10_000,
  },
});
