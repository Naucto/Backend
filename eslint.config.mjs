import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

const privateFieldSyntax = {
  selector: 'PrivateIdentifier',
  message: 'Use the private keyword rather than a #private field.',
};

const roleLiteralSyntax = {
  selector: [
    'Literal[value=/^(Admin|Moderator|User)$/]',
    'TemplateElement[value.raw=/^(Admin|Moderator|User)$/]',
  ].join(', '),
  message: 'Refer to a role through the constants of src/auth/access/roles.ts.',
};

const styleRules = {
  'no-console': 'warn',
  'no-var': 'error',
  'prefer-const': 'error',
  'id-length': [
    'error',
    { min: 2, properties: 'never', exceptions: ['i', 'j', 'k', 'x', 'y', 'a', 'b', '_', 'Y'] },
  ],
  'no-restricted-syntax': ['error', privateFieldSyntax],
};

export default defineConfig([
  {
    ignores: ['dist/**', 'client/**', 'coverage/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.eslint.json',
      },
    },
    plugins: {
      js,
      '@typescript-eslint': tseslint.plugin,
      'simple-import-sort': simpleImportSort,
    },
    extends: ['js/recommended'],
    rules: {
      ...styleRules,
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
    plugins: {
      js,
    },
    extends: ['js/recommended'],
    rules: styleRules,
  },
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Seeds and tooling are command-line scripts: printing what they did is the whole interface.
    files: ['prisma/**/*.ts', 'tool/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.ts'],
    ignores: ['src/config/env.ts', 'tool/generate-swagger.ts', 'test/env.ts', '**/*.spec.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read it with getEnv / getOptionalEnv from src/config/env.ts, where it is declared.',
        },
      ],
    },
  },
  {
    // Restating the whole list: a later block replaces a rule's options rather than adding to them.
    files: ['**/*.ts'],
    ignores: ['src/auth/access/roles.ts', 'prisma/**'],
    rules: {
      'no-restricted-syntax': ['error', privateFieldSyntax, roleLiteralSyntax],
    },
  },
  prettier,
  {
    // After the Prettier preset, which turns curly off: its 'all' form never fights the formatter.
    files: ['**/*.{ts,js,mjs}'],
    rules: { curly: ['error', 'all'] },
  },
]);
