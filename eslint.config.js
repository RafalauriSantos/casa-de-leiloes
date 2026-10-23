import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const MODULE_INTERNALS = String.raw`^\.\./(?!\.\.)[^/]+/(?!index$).+`;

export default defineConfig(
  { ignores: ['eslint.config.js', '**/dist/**', '**/node_modules/**', '**/.vercel/**', 'supabase/.temp/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // A module is reached only through its index.ts.
    files: ['backend/src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: MODULE_INTERNALS, message: 'Import another module only through its index.ts.' }] }],
    },
  },
  {
    // rules.ts is pure: no I/O, no framework, no wall clock (the clock is a parameter).
    files: ['backend/src/modules/**/rules.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: ['pg', 'jose', 'hono'],
        patterns: [
          { group: ['hono/*', '@hono/*', 'node:*'], message: 'rules.ts must stay pure.' },
          { regex: MODULE_INTERNALS, message: 'Import another module only through its index.ts.' },
        ],
      }],
      'no-restricted-globals': ['error', 'fetch', 'process'],
      'no-restricted-syntax': ['error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'rules.ts receives the clock as a parameter.' },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'rules.ts receives the clock as a parameter.' },
      ],
    },
  },
  {
    // A feature is reached only through its index.ts.
    files: ['frontend/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: String.raw`^@/features/[^/]+/.+`, message: 'Import a feature only through its index.ts.' }] }],
    },
  },
);
