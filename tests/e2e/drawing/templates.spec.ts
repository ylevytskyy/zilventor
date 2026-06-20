// tests/e2e/drawing/templates.spec.ts
// M3.3 §6 e2e — Drawing templates: save the active sheet as a template, then create a
// new sheet from it, and assert the new sheet's title block matches the template.
//
// Pattern mirrors auto-regen.spec.ts (direct store injection of a drawing document) and
// drives the REAL DrawingTab ribbon buttons + the REAL browser OPFS round-trip
// (Save as Template → templates/<slug>.zitpl → New from Template picker → AddSheetFromTemplateCommand).

import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

const TITLE_BLOCK = { drawnBy: 'E2E', revision: 'Z', notes: 'tmpl-notes' };

test('templates: new sheet from template carries the template title block', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed an active drawing with one A2/portrait sheet carrying a distinctive title block.
  await page.evaluate((titleBlock) => {
    const w = window as unknown as { __zilventorStore: { setState(p: unknown): void } };
    const partId = 'tpl-part';
    const drawing = {
      id: 'tpl-drawing', name: 'Template Drawing', units: 'mm',
      source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
      properties: {},
      sheets: [{
        id: 'tpl-sheet-1', name: 'Master Sheet',
        size: { kind: 'iso', size: 'A2' }, orientation: 'portrait',
        views: [], dimensions: [], dimensionGroups: [], annotations: [],
        titleBlock,
      }],
      activeSheetId: 'tpl-sheet-1',
    };
    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: drawing },
      activeDrawing: drawing,
      activePart: { id: partId, name: 'TplPart', units: 'mm', parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [] },
      activeAssembly: null,
    });
  }, TITLE_BLOCK);

  // 2. Switch to the Drawing ribbon so the Templates panel buttons are visible.
  await page.getByRole('tab', { name: 'Drawing' }).click();

  // 3. Save the active sheet as a template (accept the name prompt → slug "e2e-template").
  page.on('dialog', (d) => { void d.accept('E2E Template'); });
  await page.getByRole('button', { name: /Save as Template/ }).click();

  // 4. Wait until the template file lands in OPFS (the save handler is fire-and-forget).
  await expect.poll(async () => page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('templates');
      const names: string[] = [];
      for await (const [name] of dir as unknown as AsyncIterable<[string, unknown]>) names.push(name);
      return names;
    } catch { return [] as string[]; }
  }), { timeout: 10_000 }).toContain('e2e-template.zitpl');

  // 5. Open the "New from Template" picker and pick the saved template.
  await page.getByRole('button', { name: /New from Template/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'e2e-template' }).click();

  // 6. Assert a 2nd sheet was created from the template with the SAME title block + empty content.
  await expect.poll(async () => page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeDrawing: { sheets: Array<{ titleBlock: unknown; views: unknown[] }> } | null } } };
    return w.__zilventorStore.getState().activeDrawing?.sheets.length ?? 0;
  }), { timeout: 10_000 }).toBe(2);

  const newSheet = await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeDrawing: { sheets: Array<{ titleBlock: Record<string, string>; views: unknown[]; size: unknown; orientation: string }> } | null } } };
    const sheets = w.__zilventorStore.getState().activeDrawing!.sheets;
    return sheets[sheets.length - 1]!;
  });

  expect(newSheet.titleBlock).toEqual(TITLE_BLOCK);
  expect(newSheet.views).toEqual([]);
  expect(newSheet.size).toEqual({ kind: 'iso', size: 'A2' });
  expect(newSheet.orientation).toBe('portrait');
});
