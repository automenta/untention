import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom', // Switched to node to use native crypto
    globals: true, // To use describe, it, expect globally
    include: ['tests/unit/**/*.spec.js'],
    setupFiles: ['tests/setup.js'],
  },
});
