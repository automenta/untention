import { defineConfig } from 'vite';
import path from 'path'; // Import path module for alias resolution
import eslintPlugin from '@nabla/vite-plugin-eslint'; // Use default import
import { VitePWA } from 'vite-plugin-pwa'; // Import the PWA plugin
import { visualizer } from 'rollup-plugin-visualizer'; // Import the visualizer plugin

export default defineConfig({
  // Set the project root to 'src' because index.html is in src/index.html
  root: 'src',

  // Base public path when served in production.
  // Useful if your app is not served from the root of your domain (e.g., '/my-app/').
  // For GitHub Pages, this often needs to be set to your repository name, e.g., '/your-repo-name/'.
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
    minify: 'esbuild', // Activated minification
    rollupOptions: {
      output: {
        // Control output file names for better caching and organization
        entryFileNames: 'assets/[name]-[hash].js', // For main entry chunks
        chunkFileNames: 'assets/chunks/[name]-[hash].js', // For dynamically imported chunks
        assetFileNames: 'assets/[name]-[hash][extname]', // For assets like CSS, images
      },
    },
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
    eslintPlugin(), // Configure ESLint plugin using the default import
    VitePWA({ // Configure PWA plugin
      registerType: 'autoUpdate', // Automatically update service worker
      injectRegister: 'auto', // Inject service worker registration code
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'], // Files to cache
      },
      manifest: {
        name: 'Untention App',
        short_name: 'Untention',
        description: 'A decentralized thought management application',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'pwa-192x192.png', // You'll need to create these icons
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      devOptions: {
        enabled: true, // Enable PWA in development for testing
      },
    }),
    // Only run visualizer when explicitly requested (e.g., via `npm run build:analyze`)
    // This prevents it from running on every `npm run build` if not desired.
    process.env.NODE_ENV === 'production' && visualizer({
      filename: './dist/bundle-report.html', // Output file for the report
      open: true, // Automatically open the report in the browser
      gzipSize: true, // Show gzip sizes
      brotliSize: true, // Show brotli sizes
    }),
    // - vite-plugin-image for image optimization
  ],

  // Define global variables (e.g., for older libraries that expect process.env.NODE_ENV)
  // Note: For new code, prefer import.meta.env
  // define: {
  //   'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  // },
});
