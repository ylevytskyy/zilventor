import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tsparser, parserOptions: { project: true } },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['packages/app/**', 'packages/shared/**', 'packages/kernel/src/adapter/**', 'packages/kernel/src/storage/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['opencascade.js', 'opencascade.js/*'] }]
    }
  },
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/vitest.*.config.ts'] }
];
