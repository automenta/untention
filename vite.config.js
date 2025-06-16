import { defineConfig } from 'vite';
import path from 'path'; // Import path module for alias resolution

export default defineConfig({
  // Base public path when served in production.
  // Useful if your app is not served from the root of your domain (e.g., '/my-app/').
  // Defaults to '/'
  // base: '/', 

  // Configure the development server
  server: {
    port: 3000, // Ensure consistency with your previous setup
    open: true, // Automatically open the browser when dev server starts
    // host: true, // Expose to network (e.g., for mobile testing on local network)
  },
  
  // Build options
  build: {
    outDir: 'dist', // Output directory for production build
    sourcemap: true, // Generate sourcemaps for debugging production builds
    // Minify output. 'esbuild' is faster, 'terser' offers more configuration.
    // minify: 'esbuild', 
    // rollupOptions: {
    //   // Custom Rollup options if needed for advanced bundling scenarios
    //   // For example, to externalize certain dependencies or configure output formats
    // },
  },

  // Resolve options for module imports
  resolve: {
    alias: {
      // Set up path aliases for easier imports (e.g., import Component from '@/components/Component.js')
      // This assumes your source code is in 'src'
      '@': path.resolve(__dirname, './src'),
      // Example for specific directories:
      // '@components': path.resolve(__dirname, './src/components'),
      // '@utils': path.resolve(__dirname, './src/utils'),
    },
  },

  // CSS options
  css: {
    // Preprocessor options (e.g., for Sass, Less, Stylus)
    // preprocessorOptions: {
    //   scss: {
    //     additionalData: `@import "./src/styles/variables.scss";` // Example for global Sass variables
    //   },
    // },
    // Enable CSS Modules for local scoping of styles (e.g., import styles from './MyComponent.module.css')
    // modules: {
    //   scopeBehaviour: 'local',
    //   generateScopedName: '[name]__[local]___[hash:base64:5]',
    // },
  },

  // Vite plugins
  plugins: [
    // Add Vite plugins here. Examples:
    // - @vitejs/plugin-react for React projects
    // - vite-plugin-pwa for Progressive Web App features
    // - vite-plugin-eslint for ESLint integration during development
    // - vite-plugin-image for image optimization
  ],

  // Define global variables (e.g., for older libraries that expect process.env.NODE_ENV)
  // Note: For new code, prefer import.meta.env
  // define: {
  //   'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  // },
});
