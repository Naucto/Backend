import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const styleRules = {
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
};

export default defineConfig([
  {
    ignores: ["dist/**", "client/**", "coverage/**"],
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
      ...styleRules,
      "@typescript-eslint/explicit-function-return-type": ["error", {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      }]
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
    rules: styleRules
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
  },
  {
    // Seeds and tooling are command-line scripts: printing what they did is the whole interface.
    files: ["prisma/**/*.ts", "tool/**/*.ts"],
    rules: {
      "no-console": "off"
    }
  }
]);
