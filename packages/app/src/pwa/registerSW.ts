/// <reference types="vite-plugin-pwa/client" />
import { registerSW as viteRegisterSW } from 'virtual:pwa-register';

/**
 * Register the Vite-PWA-generated service worker. The actual SW is produced by
 * `vite-plugin-pwa`'s Workbox build (see `packages/app/vite.config.ts`); this
 * helper just wires its lifecycle callbacks. We surface nothing to the UI yet
 * — `onNeedRefresh` / `onOfflineReady` will be connected to the status bar in
 * a later iteration.
 */
export function register(): void {
  viteRegisterSW({
    onNeedRefresh() {
      // Surface in the status bar in a later iteration
    },
    onOfflineReady() {
      // No-op for MVP
    }
  });
}
