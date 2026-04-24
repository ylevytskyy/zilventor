import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('adding a conflicting dimension shows toast + highlights offenders', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('/');
  await waitForKernelReady(page);

  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore?: { getState(): Record<string, unknown> } };
    const s = w.__zilventorStore!.getState() as Record<string, unknown> & {
      setActivePart(p: unknown): void;
      setSketchMode(mode: boolean, id?: string): void;
    };
    s.setActivePart({
      id: 'P1', name: 'P', units: 'mm',
      parameters: { d0: { name: 'd0', expression: '50', value: 50, unit: 'mm' } },
      featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY',
        primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 }],
        constraints: [{
          id: 'existing', kind: 'dim-length', paramName: 'd0', line: 'L1',
          value: { kind: 'param', paramName: 'd0' }
        }]
      }]
    });
    s.setSketchMode(true, 'S1');
  });

  // Wait for SketchModeController.enter -> loadSketch to resolve; sketchDof
  // goes from null to a DofStatus at that point.
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore?: { getState(): { sketchDof: unknown } } };
    return w.__zilventorStore?.getState().sketchDof !== null;
  }, { timeout: 5000 });

  await page.keyboard.press('d');
  const viewport = page.locator('main#region-viewport canvas');
  // Line is (0,0)-(50,0) world. Use the viewport's own worldToScreen to pick
  // a canvas-relative click position for world (30, 2) — on the line body,
  // offset from the midpoint to avoid the existing dim's label.
  const clickAt = await page.evaluate(() => {
    const fn = (window as unknown as {
      __zilventorWorldToScreen: (x: number, y: number) => { x: number; y: number };
    }).__zilventorWorldToScreen;
    return fn(30, 2);
  });
  await viewport.click({ position: clickAt, force: true });

  await expect(page.getByRole('dialog', { name: /Edit Dimension/i })).toBeVisible();
  await page.getByLabel('Value').fill('100');
  await page.getByRole('button', { name: /^OK$/ }).click();

  await expect(page.locator('[data-testid="conflict-toast"]')).toBeVisible({ timeout: 3000 });
  await page.getByRole('button', { name: /Show conflict/i }).click();

  const highlighted = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore?: { getState(): { highlightedConstraintIds: string[] } };
    };
    return w.__zilventorStore!.getState().highlightedConstraintIds;
  });
  expect(highlighted.length).toBeGreaterThan(0);
});
