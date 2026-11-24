/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Not autoUpdate: that reloads the page the moment a new version installs. main.tsx applies it in the background.
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,woff2,svg,webmanifest,pdf}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // The course catalogues are several MB each: opened from the network, not stored for offline use.
        globIgnores: ['**/docs/catalogue-*.pdf'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/docs\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          // PDF reading and writing load only when used, so they stay out of the vendor chunk.
          if (!id.includes('node_modules') || /pdfjs-dist|pdf-lib|fontkit|@fontsource[\/]/.test(id)) return undefined;
          if (/[\/](motion|motion-dom|motion-utils|framer-motion)[\/]/.test(id)) return 'motion';
          return 'vendor';
        },
      },
    },
  },
  test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'node' },
});
