import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('apply Equal constraint between two lines via Q shortcut', async ({ page }) => {
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
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Line A: 200px wide on screen, 40px above centre.
  await viewport.click({ position: { x: box.width / 2 - 100, y: box.height / 2 - 40 }, force: true });
  await page.mouse.move(cx + 100, cy - 40);
  await viewport.click({ position: { x: box.width / 2 + 100, y: box.height / 2 - 40 }, force: true });

  await expect(page.locator('[data-sketch-primitive-count]')).toHaveAttribute(
    'data-sketch-primitive-count', '1', { timeout: 5000 }
  );

  // Line B: 100px wide on screen, 40px below centre — half the length of line A.
  await viewport.click({ position: { x: box.width / 2 - 50, y: box.height / 2 + 40 }, force: true });
  await page.mouse.move(cx + 50, cy + 40);
  await viewport.click({ position: { x: box.width / 2 + 50, y: box.height / 2 + 40 }, force: true });

  await expect(page.locator('[data-sketch-primitive-count]')).toHaveAttribute(
    'data-sketch-primitive-count', '2', { timeout: 5000 }
  );

  // Arm Equal tool via 'Q' shortcut; wait for React effect to flush.
  await page.keyboard.press('q');
  await page.waitForTimeout(300);

  // The H-constraint badges (auto-inferred) sit at each line's midpoint and have
  // pointerEvents: 'auto' — clicking exactly on them would hit the button, not the
  // canvas. Pick positions that are offset from the badge (70 px right on A, 30 px
  // right on B) but still on the line body, so ConstraintTool.pickAt finds them.
  const lineAPickX = box.width / 2 + 70;  // element-relative
  const lineAPickY = box.height / 2 - 40;
  const lineBPickX = box.width / 2 + 30;
  const lineBPickY = box.height / 2 + 40;

  // Click line A using page.mouse (absolute coords) so the canvas — not an overlay
  // button — receives the pointerdown.
  await page.mouse.move(box.x + lineAPickX, box.y + lineAPickY);
  await page.mouse.down();
  await page.mouse.up();

  // Click line B.
  await page.mouse.move(box.x + lineBPickX, box.y + lineBPickY);
  await page.mouse.down();
  await page.mouse.up();

  await page.waitForTimeout(500);

  // Dump store state.
  const snapshot = await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore?: { getState(): Record<string, unknown> } };
    if (!w.__zilventorStore) return { error: 'no store' };
    const s = w.__zilventorStore.getState();
    const part = s['activePart'] as { featureTree?: Array<Record<string, unknown>> } | null;
    const sketch = part?.featureTree?.find((f) => f['kind'] === 'sketch') as Record<string, unknown> | undefined;
    return {
      primitiveCount: (sketch?.['primitives'] as unknown[])?.length ?? 0,
      constraints: (sketch?.['constraints'] as Array<Record<string, unknown>> | undefined) ?? []
    };
  });
  console.log('SNAPSHOT:', JSON.stringify(snapshot, null, 2));

  // Equal constraint must be present (H constraints from snap inference may also be there).
  const constraintKinds = (snapshot as { constraints: Array<{ kind: string }> }).constraints.map((c) => c.kind);
  expect(constraintKinds).toContain('equal');

  // Equal badge must render — find the button whose only glyph is "=".
  await expect(
    page.locator('[data-testid="constraint-badge"]').filter({ hasText: /^=$/ })
  ).toHaveCount(1, { timeout: 3000 });
});
