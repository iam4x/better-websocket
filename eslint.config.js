import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginPrettier from "eslint-plugin-prettier/recommended";
import eslintConfigPrettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";

/** @type {import('eslint').Linter.Config[]} */
export default [
  // prettier at first
  pluginPrettier,
  eslintConfigPrettier,
  // eslint defaults
  { files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"] },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  pluginJs.configs.recommended,
  // eslint-disable-next-line import/no-named-as-default-member
  ...tseslint.configs.recommended,
  // import plugin
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    rules: {
      "import/order": [
        "error",
        {
          "newlines-between": "always",
        },
      ],
    },
    settings: {
      "import/resolver": {
        typescript: true,
        node: true,
      },
    },
  },
  // custom rules
  {
    rules: {
      "object-shorthand": "error",
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-empty-object-type": [
        2,
        { allowInterfaces: "always" },
      ],
      "import/no-unresolved": [2, { ignore: ["bun:test"] }],
    },
  },
  {
    ignores: ["node_modules", "dist"],
  },
];
