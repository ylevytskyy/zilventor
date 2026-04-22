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
  // opencascade.js is a large Emscripten bundle; pre-bundling via esbuild
  // fails because it can't understand the raw `.wasm` import the package's
  // default entry does. We load the Emscripten JS and the `.wasm?url`
  // explicitly from `occtLoader.ts`, so we need Vite to leave the package
  // alone rather than try to transform it.
  optimizeDeps: {
    exclude: ['opencascade.js', 'opencascade.js/dist/node.js']
  },
  // Treat the wasm file as a static asset so `?url` imports resolve.
  assetsInclude: ['**/*.wasm'],
  build: { target: 'es2022' }
});
