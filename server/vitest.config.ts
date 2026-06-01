import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/__tests__/helpers/setup.ts'],
    globalSetup: './src/__tests__/helpers/globalSetup.ts',
    include: ['src/__tests__/**/*.test.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/generated/**', 'src/index.ts'],
    },
    testTimeout: 15000,
  },
});
