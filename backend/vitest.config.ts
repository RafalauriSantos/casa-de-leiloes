import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 30_000,
    // A test must never write to the real public anchor, whatever the shell holds. The anchor tests turn it on themselves.
    env: { ANCHOR_MODE: 'off' },
    // Integration tests share one real database: run files one at a time.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Entry points and the embedded CA are exercised by the deployed app and by the slice-0 checks, not by line coverage.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/dev-server.ts', 'src/shared/supabase-ca.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { statements: 95, branches: 90, functions: 90, lines: 95 },
    },
  },
});
