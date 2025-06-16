import { defineConfig } from 'vite';

export default defineConfig({
  // Configure the development server
  server: {
    port: 3000, // Ensure consistency with your previous setup
    open: true, // Automatically open the browser
  },
  
  // Build options
  build: {
    outDir: 'dist', // Output directory for production build
    sourcemap: true, // Generate sourcemaps for debugging production builds
  },
});
