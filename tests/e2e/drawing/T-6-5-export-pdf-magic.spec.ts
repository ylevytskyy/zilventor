// tests/e2e/drawing/T-6-5-export-pdf-magic.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithView } from '../helpers/seedDrawing';

/**
 * T-6-5 — Export Drawing PDF: magic bytes %PDF- + non-zero size.
 *
 * Mirrors 5e's T-5e-4 pattern:
 *   - Seed a drawing with one view.
 *   - Mock showSaveFilePicker to AbortError (preserves __zilventorDrawingPdfBytes).
 *   - Click Export PDF.
 *   - Assert: first 5 bytes are [37, 80, 68, 70, 45] ('%PDF-').
 */
test('T-6-5: Export PDF — magic bytes %PDF- and non-zero size', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed drawing with one projected view.
  await seedDrawingWithView(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    orientation: 'front', scale: { numerator: 1, denominator: 1 },
  });

  // 2. Mock showSaveFilePicker to abort immediately (matching the 5e PDF spec pattern).
  //    ExportDrawingPdfCommand sets __zilventorDrawingPdfBytes before calling triggerDownload,
  //    so the AbortError fallback still preserves the bytes.
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
  });

  // 3. Click Export PDF on the Drawing ribbon.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await page.getByRole('button', { name: 'Export PDF' }).click();

  // 4. Wait for bytes to be set.
  await page.waitForFunction(() => {
    return !!(window as { __zilventorDrawingPdfBytes?: Uint8Array }).__zilventorDrawingPdfBytes;
  }, undefined, { timeout: 10_000 });

  // 5. Check length > 0.
  const len = await page.evaluate(() =>
    (window as { __zilventorDrawingPdfBytes?: Uint8Array }).__zilventorDrawingPdfBytes?.length ?? 0,
  );
  expect(len).toBeGreaterThan(0);

  // 6. Check magic bytes '%PDF-' = [37, 80, 68, 70, 45].
  const head = await page.evaluate(() => {
    const bytes = (window as { __zilventorDrawingPdfBytes?: Uint8Array }).__zilventorDrawingPdfBytes;
    return Array.from((bytes ?? new Uint8Array()).slice(0, 5));
  });
  expect(head).toEqual([37, 80, 68, 70, 45]);
});
