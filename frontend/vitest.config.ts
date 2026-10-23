import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    // Relative /api calls in the tests reach the real backend started by the global setup.
    environmentOptions: { jsdom: { url: 'http://127.0.0.1:8789/' } },
    globalSetup: './test/global-setup.ts',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/vite-env.d.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { statements: 85, branches: 80, functions: 85, lines: 85 },
    },
  },
});
