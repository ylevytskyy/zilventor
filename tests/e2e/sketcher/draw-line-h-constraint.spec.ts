import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('Drawing a horizontal line auto-attaches a horizontal constraint', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: /^Line/i }).click();

  const viewport = page.locator('main#region-viewport canvas');
  const box = (await viewport.boundingBox())!;

  // Draw a horizontal line at y = centre of viewport (on the h-axis snap).
  // Using viewport.click with force:true matches the pattern from draw-line.spec.ts
  // so the click lands on the canvas even when the NumericInputOverlay sits above it.
  await viewport.click({ position: { x: box.width / 2,       y: box.height / 2 }, force: true });
  // Move to second point first so the axis-snap hint fires (pointermove updates lastMove)
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2);
  await viewport.click({ position: { x: box.width / 2 + 120, y: box.height / 2 }, force: true });

  // One primitive should be committed in the sketch.
  await expect(page.locator('[data-sketch-primitive-count]')).toHaveAttribute(
    'data-sketch-primitive-count',
    '1',
    { timeout: 5000 }
  );

  // Dump store state for diagnostics
  const snapshot = await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore?: { getState(): Record<string, unknown> } };
    if (!w.__zilventorStore) return { error: 'no store' };
    const s = w.__zilventorStore.getState();
    const part = s['activePart'] as { featureTree?: Array<Record<string, unknown>> } | null;
    const sketch = part?.featureTree?.find((f) => f['kind'] === 'sketch') as Record<string, unknown> | undefined;
    return {
      primitiveCount: (sketch?.['primitives'] as unknown[])?.length ?? 0,
      constraintCount: (sketch?.['constraints'] as unknown[])?.length ?? 0,
      constraints: sketch?.['constraints'] ?? [],
      sketchDof: s['sketchDof']
    };
  });
  console.log('SNAPSHOT:', JSON.stringify(snapshot, null, 2));

  // The h-axis snap should have inferred a horizontal constraint → badge appears.
  await expect(page.locator('[data-testid="constraint-badge"]')).toHaveCount(1, { timeout: 5000 });

  // DOF footer segment must be visible (under- or fully-constrained, either is fine).
  await expect(page.locator('footer')).toContainText(/DOF|Fully constrained/, { timeout: 5000 });
});
