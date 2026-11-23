/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
        skipWaiting: true,
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules') || id.includes('pdfjs-dist')) return undefined;
          if (/[\/](motion|motion-dom|motion-utils|framer-motion)[\/]/.test(id)) return 'motion';
          return 'vendor';
        },
      },
    },
  },
  test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'node' },
});
