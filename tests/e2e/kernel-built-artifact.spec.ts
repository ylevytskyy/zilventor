/**
 * kernel-built-artifact.spec.ts
 *
 * Verifies that the production Vite build (dist/) produces a working kernel
 * worker — i.e., the OCCT glue and WASM load correctly and the kernel can
 * produce a real solid (non-placeholder geometry).
 *
 * This spec MUST be run against a pre-started `vite preview` serving the built
 * dist/ on port 5193 (the default port this spec targets). It targets the BUILT
 * artifact, NOT the dev server — the dev server hides the bug this was designed
 * to catch (the old `new Worker(new URL(…))` form inlines the TypeScript as a
 * `data:video/mp2t` URL in production builds, causing a SyntaxError at
 * runtime). CI wiring (a dedicated Playwright `built-artifact` project that
 * starts the preview server automatically) is handled in Task A5.
 *
 * Prerequisite: `pnpm --filter @zilventor/app build` must have run first.
 * The CI step that runs this spec should be:
 *   1. pnpm --filter @zilventor/app build
 *   2. npx playwright test --project=built-artifact
 *
 * Port: 5193 (distinct from the dev server's 5173 so both can co-exist).
 */

import { test, expect } from '@playwright/test';

test('kernel initialises and produces real geometry in the built app', async ({ page }) => {
  // Register the console listener BEFORE navigation so we catch any errors
  // that fire during worker initialisation (e.g. the data:video/mp2t
  // SyntaxError fires before "Ready" appears — registering after goto would
  // miss it entirely).
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Navigate to the built app served by vite preview on port 5193.
  await page.goto('http://localhost:5193/');

  // 1. Kernel-ready gate: the status bar shows "Ready" once the kernel worker
  //    has initialised and OCCT has loaded. Allow 120s — the 50MB WASM may
  //    need time to download and compile on first load.
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 120_000 });

  // 2. Confirm no SyntaxError from a data: URL worker inlining.
  //    The listener was registered before goto so it captured any errors
  //    that fired during worker init (before "Ready" appeared).
  expect(
    consoleErrors.filter(t => /SyntaxError|data:video\/mp2t/.test(t)),
    `Unexpected data: URL / SyntaxError in console: ${consoleErrors.join('; ')}`
  ).toEqual([]);

  // 3. Create a part and extrude it → proves the kernel ran OCCT, not a stub.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: 'Numeric rectangle…' }).click();
  await page.getByLabel('x1').fill('0');
  await page.getByLabel('y1').fill('0');
  await page.getByLabel('x2').fill('100');
  await page.getByLabel('y2').fill('50');
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'Extrude' }).click();
  await page.getByLabel('Distance').fill('30');
  await page.getByRole('button', { name: 'OK' }).click();

  await expect(page.getByText(/Extrusion1/)).toBeVisible({ timeout: 30_000 });

  // 4. Confirm real geometry was produced (triangle count > 0).
  //    The viewport sets `data-triangle-count` once the mesh is rendered.
  //    A placeholder / failed kernel would leave this at 0 or absent.
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /^[1-9]\d*$/,
    { timeout: 30_000 }
  );

  const triangleCount = await page.locator('[data-triangle-count]').getAttribute('data-triangle-count');
  console.log(`[kernel-built-artifact] triangle count: ${triangleCount} — OCCT geometry confirmed`);
});
