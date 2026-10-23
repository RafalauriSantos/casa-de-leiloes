import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 30_000,
    // Integration tests share one real database: run files one at a time.
    fileParallelism: false,
  },
});
