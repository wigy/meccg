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
    /**
     * Engine modules must not value-import the @meccg/shared barrel
     * (`../index.js`). The barrel re-exports the engine, so a value import back
     * into it forms a package-wide import cycle. Import values from their leaf
     * module instead (types/, effects/, state-utils.js, rng.js, constants.js,
     * movement-map.js, rules/, …). Type-only imports from the barrel are fine
     * (erased at compile time, no runtime cycle).
     */
    files: ["packages/shared/src/engine/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../index.js", "../../index.js"],
              allowTypeImports: true,
              message:
                "Inside engine/, import values from their leaf module, not the @meccg/shared barrel (../index.js) — it re-exports the engine, forming an import cycle. Type-only imports from the barrel are allowed.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ["**/dist/", "**/node_modules/", "**/public/bundle.js"],
  },
);
