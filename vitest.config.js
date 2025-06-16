import { defineConfig } from 'vitest/config';
import path from 'path'; // Import path module for alias resolution

export default defineConfig({
  test: {
    // Enable JSDOM environment for browser-like testing (e.g., DOM manipulation)
    // Keep 'jsdom' as per your provided file, but note that native crypto might behave differently.
    environment: 'jsdom',
    // To use describe, it, expect globally without explicit imports
    globals: true,
    // Specify which files are test files
    include: ['tests/unit/**/*.spec.js'],
    // Setup files to run before each test file (e.g., for global mocks or polyfills)
    setupFiles: ['tests/setup.js'],
    // Configure test coverage reporting
    coverage: {
      provider: 'v8', // or 'istanbul'
      reporter: ['text', 'json', 'html'], // Output formats for coverage reports
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.js', // Exclude test files themselves from coverage
        '**/*.spec.js', // Exclude spec files themselves from coverage
        'src/index.js', // Often the entry point doesn't need coverage
        'src/main.js', // If you have a separate main entry
      ],
      include: ['src/**/*.js'], // Only include files in src for coverage
    },
  },
  resolve: {
    alias: {
      // Re-use the same path aliases as in vite.config.js for consistency in tests
      '@': path.resolve(__dirname, './src'),
    },
  },
});
