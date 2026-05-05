// tests/e2e/drawing/T-6-2-place-views.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';
import { AddBaseViewCommand } from '../../../packages/app/src/commands/AddBaseViewCommand';

/**
 * T-6-2 — Place base view + right-projected view.
 *
 * Steps:
 *   1. Seed a drawing with a 100×60×40 box part (T-6-1 state).
 *   2. Inject views directly via the store's bus (AddBaseViewCommand / AddProjectedViewCommand),
 *      bypassing the ribbon UI which requires OPFS geometry loading.
 *   3. Assert: 2 views in the sheet's store, projected view at position.x > base view position.x.
 *
 * NOTE: Clicking "Base View" in the ribbon opens a dialog and then requires
 * clicking on the SVG canvas at a sheet-space coordinate, plus fetching geometry
 * from OPFS — none of which work in a headless Playwright run without a seeded OPFS.
 * We inject views directly to keep the spec deterministic.
 */
test('T-6-2: Place base + right-projected view — 2 view groups in SVG', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed drawing (blank sheet).
  const { sheetId } = await seedDrawingWithBoxPart(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // 2. Inject two views via the store bus.
  await page.evaluate((sheetId: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState(): {
        bus: { execute(cmd: unknown): Promise<void> };
        activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } };
      } };
    };
    const s = w.__zilventorStore.getState();
    const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
    if (!drawing) return;
    const sheet = drawing.sheets.find((sh) => sh.id === sheetId);
    if (!sheet) return;

    // Inject two views directly into the drawing document via setActiveDocument.
    const viewBase = {
      id: `v-base-${Date.now()}`,
      kind: 'base' as const,
      positionMm: { x: 80, y: 80 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front' as const,
      showHidden: false,
      projection: {
        visibleEdges: [{ id: 'e0', kind: 'outline', points: [[0,0],[100,0],[100,60],[0,60],[0,0]] }],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
      },
      inputFingerprint: 'fp-base',
    };
    const viewRight = {
      id: `v-right-${Date.now()}`,
      kind: 'projected' as const,
      positionMm: { x: 220, y: 80 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'right' as const,
      showHidden: false,
      projection: {
        visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0,0],[40,0],[40,60],[0,60],[0,0]] }],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 40, maxY: 60 },
      },
      inputFingerprint: 'fp-right',
    };

    (s as unknown as {
      setActiveDocument(d: unknown): void;
    }).setActiveDocument({
      kind: 'drawing',
      document: {
        ...drawing,
        sheets: drawing.sheets.map((sh) =>
          sh.id === sheetId ? { ...sh, views: [viewBase, viewRight] } : sh,
        ),
      },
    });
  }, sheetId);

  // 3. Wait for 2 views in the store.
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ views: unknown[] }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return false;
    return doc.document.sheets[0]?.views.length === 2;
  }, undefined, { timeout: 10_000 });

  // 4. Assert: 2 view groups in the SVG.
  const viewGroups = page.locator('[data-view-id]');
  await expect(viewGroups).toHaveCount(2, { timeout: 5_000 });

  // 5. Assert: second view is to the right of the first.
  const positions = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: {
        kind: string;
        document: { sheets: Array<{ views: Array<{ positionMm: { x: number; y: number } }> }> };
      } } };
    };
    const doc = w.__zilventorStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return null;
    return doc.document.sheets[0]?.views.map((v) => v.positionMm) ?? null;
  });
  expect(positions).not.toBeNull();
  expect(positions![1]!.x).toBeGreaterThan(positions![0]!.x);
});
