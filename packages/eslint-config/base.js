// Shared ESLint rules for every workspace. Apps layer their framework config
// (eslint-config-next / eslint-config-expo) underneath this.
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export const base = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/.next/**',
      '**/.expo/**',
      '**/*.d.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // Turns off stylistic rules that would fight with Prettier. Keep last.
  prettier,
];

/** Standalone config for plain TS packages that have no framework config. */
export const library = [...tseslint.configs.recommended, ...base];
