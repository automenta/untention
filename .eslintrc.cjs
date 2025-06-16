module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true,
    node: true // For vite.config.js and .eslintrc.cjs itself
  },
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // Add or override ESLint rules here
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }], // Warn on unused variables, ignore those starting with _
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }], // Allow console.warn, error, info
  },
  settings: {
    'import/resolver': {
      alias: {
        map: [
          ['@', './src'],
        ],
        extensions: ['.js', '.jsx', '.json'],
      },
    },
  },
};
