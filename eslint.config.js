import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**"],
  },
  {
    files: ["script.js", "js/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-empty": "warn",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["tests/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: js.configs.recommended.rules,
  },
  {
    files: ["data/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
];
