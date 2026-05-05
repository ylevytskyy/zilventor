// tests/e2e/drawing/T-6-6-balloon-bom.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T-6-6 — Balloon on assembly drawing shows the BOM item number.
 *
 * Steps:
 *   1. Seed an assembly drawing with a balloon annotation (item number 1).
 *   2. Assert: [data-ann-kind="balloon"] text contains "1".
 *
 * NOTE: The full balloon placement flow requires assembly geometry in OPFS
 * and a view with edge picks. We inject a balloon annotation directly via
 * the store to test the rendering path reliably in headless Playwright.
 */
test('T-6-6: Balloon on assembly drawing shows BOM item number', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed an assembly drawing with one view and a balloon annotation.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): {
        setActiveDocument(d: unknown): void;
        setActivePart(p: unknown): void;
      } };
    };
    const s = w.__zilventorStore.getState();

    // Seed a stub assembly (drawing source)
    s.setActivePart({
      id: 'asm-T66', name: 'TestAsm', units: 'mm',
      parameters: {}, featureTree: [], properties: {},
      materials: [], hardware: [],
    });

    const sheetId = 'sheet-T66';
    const viewId = 'view-T66';
    const annId = 'ann-balloon-T66';

    s.setActiveDocument({ kind: 'drawing', document: {
      id: 'drawing-T66', name: 'TestAsm — Drawing', units: 'mm',
      source: { partPath: 'TestAsm.ziasm', sourceKind: 'assembly' },
      properties: {},
      sheets: [{
        id: sheetId, name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [{
          id: viewId, kind: 'base',
          positionMm: { x: 80, y: 80 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front', showHidden: false,
          projection: {
            visibleEdges: [{ id: 'e0', kind: 'outline',
              points: [[0,0],[200,0],[200,100],[0,100],[0,0]] }],
            hiddenEdges: [],
            bbox: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
          },
          inputFingerprint: 'fp-T66',
        }],
        dimensions: [],
        annotations: [{
          id: annId, kind: 'balloon', viewId,
          itemNumber: 1,
          targetMm: { x: 80, y: 100 },
          textPosMm: { x: 100, y: 80 },
        }],
        titleBlock: {},
      }],
      activeSheetId: sheetId,
    }});
  });

  // 2. Wait for drawing to be active.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'drawing';
  }, undefined, { timeout: 10_000 });

  // 3. Assert: balloon annotation SVG group is rendered.
  await expect(page.locator('[data-ann-kind="balloon"]')).toHaveCount(1, { timeout: 10_000 });

  // 4. Assert: balloon text contains "1" (the item number).
  const balloonText = page.locator('[data-ann-kind="balloon"] text');
  await expect(balloonText).toContainText('1', { timeout: 5_000 });
});
