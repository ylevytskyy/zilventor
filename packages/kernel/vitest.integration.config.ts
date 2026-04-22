import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.integration.spec.ts', 'src/occt/**/__tests__/**/*.spec.ts'],
    testTimeout: 120_000
  }
});
