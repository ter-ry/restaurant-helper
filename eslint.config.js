import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  location: "readonly",
  history: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  fetch: "readonly",
  Request: "readonly",
  Response: "readonly",
  Headers: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Node: "readonly",
  HTMLElement: "readonly",
  HTMLInputElement: "readonly",
  HTMLSelectElement: "readonly",
  HTMLTextAreaElement: "readonly",
  Event: "readonly",
  KeyboardEvent: "readonly",
  FormData: "readonly",
  MutationObserver: "readonly",
  ResizeObserver: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  Blob: "readonly",
  File: "readonly",
  FileList: "readonly",
  URLPattern: "readonly",
  crypto: "readonly",
};

export default [
  {
    ignores: ["dist/**", "node_modules/**", "backend/**", "legacy/**", ".git/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "*.ts", "*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...browserGlobals,
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        module: "readonly",
        require: "readonly",
        global: "readonly",
        vi: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
];
