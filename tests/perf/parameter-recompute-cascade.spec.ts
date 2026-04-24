import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

test('Perf: 30-param chain re-evaluates + re-solves under 1000 ms', async ({ page }) => {
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
    const params: Record<string, { name: string; expression: string; value: number; unit: 'mm' }> = {};
    for (let i = 0; i <= 30; i++) {
      params[`d${i}`] = i === 0
        ? { name: 'd0', expression: '0', value: 0, unit: 'mm' }
        : { name: `d${i}`, expression: `d${i - 1} + 1`, value: i, unit: 'mm' };
    }
    s.setActivePart({
      id: 'P1', name: 'P', units: 'mm', parameters: params,
      featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] }]
    });
    s.setSketchMode(true, 'S1');
  });

  // Wait for SketchModeController.enter to complete so the registry is populated.
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore?: { getState(): { sketchDof: unknown } } };
    return w.__zilventorStore?.getState().sketchDof !== null;
  }, { timeout: 5000 });

  await page.keyboard.press('F7');
  await expect(page.getByRole('dialog', { name: /Parameters/i })).toBeVisible();

  // Edit d0's expression from "0" to "100" via the data-testid cells; the
  // cascade should recompute d1..d30 (each d_i = d_{i-1} + 1) so d30 becomes 130.
  const t0 = Date.now();
  await page.locator('[data-testid="param-expression-d0"]').dblclick();
  const input = page.locator('[data-testid="param-row-d0"] input');
  await input.fill('100');
  await input.press('Enter');
  await expect(page.locator('[data-testid="param-value-d30"]')).toHaveText('130', { timeout: 1000 });
  const totalMs = Date.now() - t0;
  console.log(JSON.stringify({ metric: 'parameter-recompute-cascade', totalMs }));
  expect(totalMs).toBeLessThan(1000);
});
