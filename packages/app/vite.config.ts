import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Alias Node's `events` module to a tiny browser shim. `tar-stream` →
// `streamx` → `events-universal` calls `require('events')` which Vite would
// otherwise externalize to a stub, breaking `EventEmitter` at load time.
const eventsShim = fileURLToPath(new URL('./src/vendor/events-shim.ts', import.meta.url));
// Patch b4a@1.8.0's broken `write(buf, str, offset)` form — see shim for
// details. Both Node and browser entries are aliased so tar-stream reaches
// our wrapper regardless of the condition Vite resolves.
const b4aShim = fileURLToPath(new URL('./src/vendor/b4a-shim.js', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      // Enable the service worker in `vite dev` so Playwright's offline test
      // can exercise caching without spinning up a separate preview server.
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'ZilInventor',
        short_name: 'ZilInventor',
        theme_color: '#1f1f1f',
        background_color: '#1f1f1f',
        display: 'standalone',
        icons: []
      },
      workbox: {
        // Exclude the large OCCT WASM (~50 MB) from precache — it exceeds any
        // reasonable precache budget. The browser will cache it normally on
        // first fetch. All other wasm files (planegcs ≈ 1 MB) are precached.
        globPatterns: ['**/*.{js,css,html,svg}', '**/planegcs*.wasm'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024
      }
    })
  ],
  worker: {
    format: 'es',
    rollupOptions: {
      // opencascade.full.js is served as a public static asset at /occt/ (copied
      // by scripts/copy-occt.mjs at prebuild). Mark it external so Rollup does
      // not try to bundle it — the browser fetches it at runtime via a dynamic
      // import() in occtLoader.ts. The node.js branch is also external (Node-only,
      // never executed in the browser worker).
      external: [
        /^\/occt\//,
        'opencascade.js/dist/node.js',
        'opencascade.js'
      ]
    }
  },
  resolve: {
    alias: [
      { find: 'events', replacement: eventsShim },
      // Match bare `require('b4a')` only; `require('b4a/browser.js')`
      // inside our shim still resolves to the real package.
      { find: /^b4a$/, replacement: b4aShim }
    ]
  },
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
