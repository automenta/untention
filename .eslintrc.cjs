const path = require('path'); // Add this line to import the path module

module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true,
    node: true, // For vite.config.js and .eslintrc.cjs itself
    'vitest-globals/env': true // Add Vitest environment
  },
  extends: [
    'eslint:recommended',
    'plugin:import/errors', // Ensure imports are valid
    'plugin:import/warnings', // Warn on issues with imports
    'plugin:vitest-globals/recommended', // Add Vitest globals plugin
    'prettier', // Disable ESLint rules that conflict with Prettier
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // Add or override ESLint rules here
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }], // Warn on unused variables, ignore those starting with _, don't warn on unused catch arguments
    'no-console': ['warn', { allow: ['warn', 'error', 'info', 'debug'] }], // Allow console.warn, error, info, debug
    'import/no-unresolved': ['error', { commonjs: true, amd: true, ignore: ['^node:'] }], // Ensure imported modules can be resolved, ignore node: built-ins
    'import/named': 'error', // Ensure named imports correspond to a named export
    'import/namespace': 'error', // Ensure all exports are valid
    'import/default': 'error', // Ensure default import is valid
    'import/export': 'error', // Ensure all exports are valid
  },
  settings: {
    'import/resolver': {
      alias: {
        map: [
          ['@', path.resolve(__dirname, './src')], // Use absolute path
        ],
        extensions: ['.js', '.jsx', '.json'],
      },
    },
  },
  globals: {
    // Declare global variables that are not imported
    NostrTools: 'readonly', // Assuming NostrTools is loaded via a script tag and is read-only
    AggregateError: 'readonly', // Add AggregateError global
    localforage: 'readonly', // Add localforage global
  },
};
