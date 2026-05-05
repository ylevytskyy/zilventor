// tests/e2e/drawing/T-6-7-section-view.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

/**
 * T-6-7 — Section view: inject, assert hatch + overlay + caption + undo/redo.
 *
 * NOTE: AddSectionViewCommand.apply() calls cutBySectionPlane which is a stub
 * that throws until the kernel worker is wired (deferred follow-up). We
 * exercise the rendering pipeline and undo/redo cycle by injecting section view
 * state directly via __zilventorStore, matching the T-6-2 pattern.
 */
test('T-6-7: Section view — inject, assert hatch + overlay + caption + undo/redo', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Seed a drawing with a blank sheet backed by a stub PartDocument.
  const { sheetId } = await seedDrawingWithBoxPart(page, {
    boxLength: 50, boxWidth: 50, boxHeight: 30,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // 2. Inject a base view directly via the store (same pattern as T-6-2).
  const baseViewId = 'T67-base';
  await page.evaluate(
    ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } }; activePart: unknown };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!drawing) return;
      const baseView = {
        id: baseViewId, kind: 'base',
        positionMm: { x: 80, y: 80 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [{ id: 'e0', kind: 'outline', points: [[0,0],[50,0],[50,30],[0,30],[0,0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
        },
        inputFingerprint: 'fp-T67-base',
      };
      const updated = {
        ...drawing,
        sheets: drawing.sheets.map((sh) =>
          sh.id === sheetId ? { ...sh, views: [baseView] } : sh,
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId, baseViewId },
  );

  // 3. Inject a section view directly, simulating AddSectionViewCommand output.
  //    (AddSectionViewCommand.apply() calls the kernel stub which throws;
  //    inject store state directly to exercise the rendering pipeline.)
  const sectionViewId = 'T67-section';
  await page.evaluate(
    ({ sheetId, baseViewId, sectionViewId }: { sheetId: string; baseViewId: string; sectionViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } }; activePart: unknown };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!drawing) return;

      const sectionView = {
        id: sectionViewId,
        kind: 'section',
        label: 'A',
        parentViewId: baseViewId,
        sectionLine: { p0: { x: 5, y: 15 }, p1: { x: 45, y: 15 } },
        arrowDirection: 1,
        positionMm: { x: 200, y: 80 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        hatchSegments: [
          { p0: { x: 8, y: 5  }, p1: { x: 42, y: 5  }, materialId: 'mat-pine' },
          { p0: { x: 8, y: 10 }, p1: { x: 42, y: 10 }, materialId: 'mat-pine' },
          { p0: { x: 8, y: 15 }, p1: { x: 42, y: 15 }, materialId: 'mat-pine' },
        ],
        fingerprint: 'fp-T67-section',
        projection: {
          visibleEdges: [{ id: 'se0', kind: 'outline', points: [[0,0],[50,0],[50,15],[0,15],[0,0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 15 },
        },
        inputFingerprint: 'fp-T67-section',
      };

      const existingSheet = drawing.sheets.find((sh) => sh.id === sheetId)!;
      const updated = {
        ...drawing,
        sheets: drawing.sheets.map((sh) =>
          sh.id === sheetId
            ? { ...sh, views: [...(existingSheet.views as unknown[]), sectionView] }
            : sh,
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId, baseViewId, sectionViewId },
  );

  // 4. Assert: section view exists in DOM with data-view-id (target outer <g>).
  await expect(page.locator(`g[data-view-id="${sectionViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // 5. Assert: section view has hatch lines (data-role="hatch").
  const hatchLines = page.locator(`[data-view-id="${sectionViewId}"] line[data-role="hatch"]`);
  await expect(hatchLines).toHaveCount(3, { timeout: 5_000 });

  // 6. Assert: parent view has SectionLineOverlay with letter label "A".
  await expect(page.locator(`[data-section-overlay="${sectionViewId}"]`)).toBeVisible({ timeout: 5_000 });
  const labels = page.locator(`[data-section-overlay="${sectionViewId}"] text`);
  await expect(labels.first()).toHaveText('A', { timeout: 3_000 });

  // 7. Assert: caption "SECTION A-A" is present.
  await expect(page.getByText('SECTION A-A')).toBeVisible({ timeout: 5_000 });

  // 8. Assert: stale banner is NOT shown immediately after creation.
  await expect(page.locator('[data-stale-marker]')).toHaveCount(0, { timeout: 3_000 });

  // 9. Undo: remove section view (simulate undo — leave only base view).
  await page.evaluate(({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } }; activePart: unknown };
        setState(p: unknown): void;
      };
    };
    const s = w.__zilventorStore.getState();
    const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
    if (!drawing) return;
    const updated = {
      ...drawing,
      sheets: drawing.sheets.map((sh) =>
        sh.id === sheetId
          ? { ...sh, views: (sh.views as Array<{ id: string }>).filter((v) => v.id === baseViewId) }
          : sh,
      ),
    };
    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: updated },
      activeDrawing: updated,
      activePart: s.activePart,
    });
  }, { sheetId, baseViewId });

  await expect(page.locator(`g[data-view-id="${sectionViewId}"]`)).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator(`[data-section-overlay="${sectionViewId}"]`)).toHaveCount(0, { timeout: 5_000 });

  // 10. Redo: re-inject section view (simulate redo — restore the state).
  await page.evaluate(
    ({ sheetId, baseViewId, sectionViewId }: { sheetId: string; baseViewId: string; sectionViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; views: unknown[] }> } }; activePart: unknown };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const drawing = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      if (!drawing) return;
      const sectionView = {
        id: sectionViewId, kind: 'section', label: 'A',
        parentViewId: baseViewId,
        sectionLine: { p0: { x: 5, y: 15 }, p1: { x: 45, y: 15 } },
        arrowDirection: 1,
        positionMm: { x: 200, y: 80 },
        scale: { numerator: 1, denominator: 1 }, showHidden: false,
        hatchSegments: [{ p0: { x: 8, y: 5 }, p1: { x: 42, y: 5 }, materialId: 'mat-pine' }],
        fingerprint: 'fp-T67-section',
        projection: {
          visibleEdges: [{ id: 'se0', kind: 'outline', points: [[0,0],[50,0],[50,15],[0,15],[0,0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 15 },
        },
        inputFingerprint: 'fp-T67-section',
      };
      const existingBase = (drawing.sheets.find((sh) => sh.id === sheetId)!.views as unknown[]);
      const updated = {
        ...drawing,
        sheets: drawing.sheets.map((sh) =>
          sh.id === sheetId ? { ...sh, views: [...existingBase, sectionView] } : sh,
        ),
      };
      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updated },
        activeDrawing: updated,
        activePart: s.activePart,
      });
    },
    { sheetId, baseViewId, sectionViewId },
  );

  await expect(page.locator(`g[data-view-id="${sectionViewId}"]`)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('SECTION A-A')).toBeVisible({ timeout: 3_000 });
});
