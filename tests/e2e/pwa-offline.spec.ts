import { test, expect } from '@playwright/test';

/**
 * PWA offline check.
 *
 * This test proves that the service worker registers and becomes the
 * controller of the page — a pre-requisite for any offline behavior.
 *
 * CAVEAT (known carry-forward to Task 27 — CI pipeline):
 * `vite-plugin-pwa`'s dev-mode service worker only precaches `index.html`,
 * not the app's JS/CSS/WASM chunks. A full "works offline after first load"
 * guarantee requires the Workbox-generated service worker from
 * `vite build` + `vite preview`. The production `sw.js` emitted by
 * `vite build` today precaches 5 entries (~644 KiB). Wiring a separate
 * Playwright project that runs against `pnpm preview` on a different port,
 * then cutting the network and reloading, is the natural next step. That
 * belongs with the CI workflow work in Task 27 rather than this task.
 *
 * For now: verify SW registration + active state in the dev server, and
 * additionally verify that a reload with the network cut still yields an
 * HTML response (served from the SW precache) and reports the service worker
 * as the controller.
 */
test('Service worker registers and controls the page', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 120_000 });

  // 1) Registration + activation — the plugin calls registerSW() via our
  //    main.tsx bootstrap, which resolves once the SW is installing/active.
  await page.waitForFunction(
    async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return false;
      return !!reg.active || !!reg.installing || !!reg.waiting;
    },
    null,
    { timeout: 30_000 }
  );

  // 2) Offline reload. The dev SW precaches only `index.html`, so the HTML
  //    shell must still load — enough to prove the SW is serving traffic.
  //    JS/CSS will 404 in dev; that's expected and covered above.
  await context.setOffline(true);
  const resp = await page.reload();
  expect(resp?.status()).toBeLessThan(400);

  // 3) After the offline reload, the page must be under SW control — i.e.
  //    `serviceWorker.controller` is populated. This is the bit that proves
  //    the SW is intercepting requests.
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  expect(controlled).toBe(true);
});
