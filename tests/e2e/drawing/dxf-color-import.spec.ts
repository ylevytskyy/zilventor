import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from '../helpers/buildBox';

const DXF = readFileSync(resolve(__dirname, '../fixtures/dxf-color-sample.dxf'), 'utf-8');

test('imports DXF layer colors + dash style into sketch primitives', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await waitForKernelReady(page);

  const result = await page.evaluate(async (text: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState: () => { activePart?: { featureTree: Array<{ kind: string; primitives?: Array<{ kind: string; color?: number; lineStyle?: string }> }> } } };
      __zilventorImportDxfNewPart: (file: File) => Promise<void>;
    };
    const file = new File([text], 'colors.dxf', { type: 'image/vnd.dxf' });
    await w.__zilventorImportDxfNewPart(file);
    const part = w.__zilventorStore.getState() as unknown as { activePart?: { featureTree: Array<{ kind: string; primitives?: Array<{ kind: string; color?: number; lineStyle?: string }> }> } };
    const sketch = part.activePart?.featureTree.find((f) => f.kind === 'sketch');
    const lines = (sketch?.primitives ?? []).filter((p) => p.kind === 'line');
    return {
      count: lines.length,
      colors: lines.map((p) => p.color).sort(),
      styles: lines.map((p) => p.lineStyle ?? 'solid').sort(),
    };
  }, DXF);

  expect(result.count).toBe(2);
  // ACI 1 = 0xff0000 (red, walls layer), ACI 5 = 0x0000ff (blue, hidden layer)
  expect(result.colors).toEqual([0x0000ff, 0xff0000].sort());
  // CONTINUOUS -> solid (fallback), HIDDEN -> dashed
  expect(result.styles).toEqual(['dashed', 'solid']);
  expect(errors).toEqual([]);
});
