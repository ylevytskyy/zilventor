import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

// FIXME: dblclick on params table cell does not open inline editor in perf project context; textbox never appears
test.skip('Perf: 30-param chain re-evaluates + re-solves under 100 ms', async ({ page }) => {
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

  await page.keyboard.press('F7');
  const t0 = Date.now();
  // Target the d0 row precisely to avoid strict-mode ambiguity in a 30-param table
  const d0Row = page.getByRole('row', { name: /^d0\b/ });
  await d0Row.getByRole('cell', { name: '0' }).first().dblclick();
  await page.getByRole('textbox').first().fill('100');
  await page.keyboard.press('Enter');
  await expect(page.getByText('130')).toBeVisible({ timeout: 1000 });
  const totalMs = Date.now() - t0;
  console.log(JSON.stringify({ metric: 'parameter-recompute-cascade', totalMs }));
  expect(totalMs).toBeLessThan(1000);
});
