import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";

export default defineConfig([
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.eslint.json"
      }
    },
    plugins: {
      js,
      react: pluginReact,
      "@typescript-eslint": tseslint.plugin,
    },
    extends: ["js/recommended"],
    rules: {
      indent: ["error", 2],
      quotes: ["error", "double"],
      "@typescript-eslint/no-unused-vars": "warn",
      "no-console": "warn",
      "react/react-in-jsx-scope": "off",
      "react/self-closing-comp": "error",
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
    files: ["**/*.{js,mjs,cjs,jsx}"],
    languageOptions: {
      globals: globals.browser
    },
    plugins: {
      js,
      react: pluginReact
    },
    extends: ["js/recommended"],
    rules: {
      indent: ["error", 2],
      quotes: ["error", "double"],
      "no-console": "warn",
      "react/react-in-jsx-scope": "off",
      "react/self-closing-comp": "error",
      "no-var": "error",
      "prefer-const": "error",
      "object-curly-spacing": ["error", "always"],
      "semi": ["error", "always"],
      "eol-last": ["error", "always"],
      "no-multiple-empty-lines": ["error", { "max": 1 }]
    }
  },
  tseslint.configs.recommended
]);

