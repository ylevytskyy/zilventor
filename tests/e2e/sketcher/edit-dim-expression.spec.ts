import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('edit parameter expression cascades to dependent dimension', async ({ page }) => {
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
      parameters: {
        width: { name: 'width', expression: '50', value: 50, unit: 'mm' },
        d0:    { name: 'd0',    expression: 'width * 2', value: 100, unit: 'mm' }
      },
      featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY',
        primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }],
        constraints: [{
          id: 'dimA', kind: 'dim-length', paramName: 'd0', line: 'L1',
          value: { kind: 'param', paramName: 'd0' }
        }]
      }]
    });
    s.setSketchMode(true, 'S1');
  });

  await expect(page.locator('[data-testid="dimension-glyph"]')).toHaveCount(1, { timeout: 3000 });
  await expect(page.locator('text="100.00"')).toBeVisible();

  await page.keyboard.press('F7');
  await expect(page.getByRole('dialog', { name: /Parameters/i })).toBeVisible();
  const widthRow = page.getByText('width').locator('..');
  await widthRow.getByText('50').first().dblclick();
  await page.getByRole('textbox').first().fill('75');
  await page.keyboard.press('Enter');

  await expect(page.locator('text="150.00"')).toBeVisible({ timeout: 3000 });
});
