import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": ["error", { allowTernary: true, allowShortCircuit: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    // Hard rule from plan.md: the engine never touches apps/ or browser APIs.
    files: ["packages/engine/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["**/apps/**", "react", "react-*", "@xyflow/*"] }],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "indexedDB", "navigator", "performance", "Worker"],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
