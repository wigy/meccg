/**
 * @module ESLint configuration for the MECCG monorepo.
 *
 * Uses ESLint 9 flat config with typescript-eslint for type-aware linting
 * across all workspace packages.
 */
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /** Allow underscore-prefixed params/vars to be unused (common destructuring pattern). */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      /** Enum values are compared with string unions throughout the codebase. */
      "@typescript-eslint/no-unsafe-enum-comparison": "off",
    },
  },
  {
    ignores: ["**/dist/", "**/node_modules/", "**/public/bundle.js"],
  },
);
