import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'ZilInventor',
        short_name: 'ZilInventor',
        theme_color: '#1f1f1f',
        background_color: '#1f1f1f',
        display: 'standalone',
        icons: []
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024
      }
    })
  ],
  worker: { format: 'es' },
  build: { target: 'es2022' }
});
