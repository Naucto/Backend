import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: ["dist/**", "generated_client/**", "client/**", "coverage/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: globals.node,
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.eslint.json"
      }
    },
    plugins: {
      js,
      "@typescript-eslint": tseslint.plugin,
    },
    extends: ["js/recommended"],
    rules: {
      indent: ["error", 2],
      quotes: ["error", "double"],
      "linebreak-style": ["error", "unix"],
      "@typescript-eslint/no-unused-vars": "warn",
      "no-console": "warn",
      "no-var": "error",
      "prefer-const": "error",
      "object-curly-spacing": ["error", "always"],
      "semi": ["error", "always"],
      "@typescript-eslint/explicit-function-return-type": ["error", {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      }],
      "eol-last": ["error", "always"],
      "no-multiple-empty-lines": ["error", { "max": 1 }]
    }
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: globals.node
    },
    plugins: {
      js
    },
    extends: ["js/recommended"],
    rules: {
      indent: ["error", 2],
      quotes: ["error", "double"],
      "linebreak-style": ["error", "unix"],
      "no-console": "warn",
      "no-var": "error",
      "prefer-const": "error",
      "object-curly-spacing": ["error", "always"],
      "semi": ["error", "always"],
      "eol-last": ["error", "always"],
      "no-multiple-empty-lines": ["error", { "max": 1 }]
    }
  },
  tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_"
      }]
    }
  },
  {
    files: ["**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
]);
