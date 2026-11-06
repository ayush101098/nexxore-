/**
 * Shared ESLint preset for all NEXXORE workspaces.
 * Enforces GLOBAL RULE 1: no `any` without a `// justified:` comment
 * is a convention we lint softly here (warn) and review in PRs.
 */
/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'eslint-config-prettier',
  ],
  env: { node: true, browser: true, es2022: true },
  ignorePatterns: ['dist', '.next', 'node_modules', 'storybook-static', '*.cjs'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
};
