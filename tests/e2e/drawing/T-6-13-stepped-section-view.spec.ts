// tests/e2e/drawing/T-6-13-stepped-section-view.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T-6-13 — Stepped section view (Drawing F1.2): drive AddSectionViewCommand with
 * mode='stepped' via the real command flow. Cases 1–4 map to spec §10.2:
 *   Case 1: 2-jog canonical (3 segments) — assertions (i)–(vii)
 *   Case 2: 3-jog variant (4 segments)   — len/hatch/polyline-points
 *   Case 3: empty-cut error              — command throws, sheet.views unchanged
 *   Case 4: byte-size verification gate  — canvas DOM <polyline> count + PNG size
 *
 * Pattern mirrors T-6-10 (F1.1): the command may be dispatched through the
 * `bus` so that undo/redo work via `bus.undo()`/`bus.redo()` for assertions (vi)
 * and (vii). When kernel cut succeeds we proceed with the real command flow;
 * empty-cut paths surface the upstream batch error verbatim.
 */

test.describe('T-6-13 — Stepped section view (F1.2)', () => {
  test('Case 1: 2-jog canonical stepped section (3 segments) — assertions (i)–(vii)', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.goto('/');
    await waitForKernelReady(page);

    // 1. Create a 100×60×40 mm box part (matches spec §10.2 precondition).
    await page.getByRole('tab', { name: 'Model' }).click();
    await page.getByRole('button', { name: 'New Part' }).click();
    await page.getByRole('tab', { name: 'Sketch' }).click();
    await page.getByRole('button', { name: '2D Sketch' }).click();
    await page.getByRole('button', { name: 'Numeric rectangle…' }).click();
    await page.getByLabel('x1').fill('0');
    await page.getByLabel('y1').fill('0');
    await page.getByLabel('x2').fill('100');
    await page.getByLabel('y2').fill('60');
    await page.getByRole('button', { name: 'OK' }).click();
    await page.getByRole('button', { name: 'Finish Sketch' }).click();
    await page.getByRole('tab', { name: 'Model' }).click();
    await page.getByRole('button', { name: 'Extrude' }).click();
    await page.getByLabel('Distance').fill('40');
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByText(/Extrusion1/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 15_000 });

    // 2. Seed a drawing with a single front Base View at 1:1, mirroring T-6-10's pattern.
    const { sheetId, baseViewId } = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            kernel: { execute(partId: string): Promise<unknown> } | null;
          };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-13 Case 1: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);

      const partId = s.activePart.id;
      const sheetId = `sheet-T613c1-${Date.now()}`;
      const baseViewId = `base-T613c1-${Date.now()}`;
      const drawingId = `drawing-T613c1-${Date.now()}`;
      // Front view: world-space part centered at (-50,-30,-20) projects to sheet origin.
      const frontViewMatrix = [1,0,0,-50, 0,1,0,-30, 0,0,1,-20, 0,0,0,1];

      const baseView = {
        id: baseViewId, kind: 'base',
        positionMm: { x: 80, y: 80 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        viewMatrix: frontViewMatrix,
        projection: {
          visibleEdges: [{ id: 'e0', kind: 'outline', points: [[0,0],[100,0],[100,40],[0,40],[0,0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
        },
        inputFingerprint: `fp-T613c1-${partId}`,
      };

      const drawing = {
        id: drawingId, name: 'T-6-13 Case 1 Drawing', units: 'mm',
        source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
        properties: {},
        sheets: [{
          id: sheetId, name: 'Sheet 1', size: { kind: 'iso', size: 'A3' },
          orientation: 'landscape',
          views: [baseView], dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: sheetId,
      };

      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: drawing },
        activeDrawing: drawing,
      });

      return { sheetId, baseViewId };
    });

    // 3. Switch to drawing tab; confirm base view rendered.
    await page.getByRole('tab', { name: 'Drawing' }).click();
    await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

    // 4. Dispatch AddSectionViewCommand with the canonical 2-jog payload (spec §10.2 lines 698–705)
    //    THROUGH the bus so bus.undo()/bus.redo() drive assertions (vi)/(vii).
    const result = await page.evaluate(
      async ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              activeDocument: { kind: string; document: unknown } | null;
              bus: { execute(cmd: { apply(): Promise<void>; revert(): Promise<void> }): Promise<void> };
            };
          };
        };
        const { AddSectionViewCommand } = await import('/src/commands/AddSectionViewCommand.ts');

        const cmd = new AddSectionViewCommand({
          drawingId: 'T-6-13-c1',
          sheetId,
          parentViewId: baseViewId,
          // p0/p1 in the command payload are still used for the section-line endpoints
          // (allocator label position + arrow placement). For stepped mode the actual
          // cut is driven by stepSegments.
          // Sheet coords are parent-view-local mm. ParentViewMatrix maps world→view
          // as (x_w-50, y_w-30, z_w-20), so invM maps view→world by +50/+30/+20.
          // Box occupies world (0..100, 0..60, 0..40); these segments form a
          // 2-jog polyline whose 3 cut planes (y=10, x=50, y=40) each cleanly
          // bisect the box interior.
          p0: { x: -30, y: -20 },
          p1: { x:  30, y:  10 },
          arrowDirection: 1 as -1 | 1,
          dropAt: { x: 260, y: 80 },
          mode: 'stepped',
          stepSegments: [
            { startSheet: { x: -30, y: -20 }, endSheet: { x:  0, y: -20 } }, // H, plane y=10
            { startSheet: { x:   0, y: -20 }, endSheet: { x:  0, y:  10 } }, // V, plane x=50
            { startSheet: { x:   0, y:  10 }, endSheet: { x: 30, y:  10 } }, // H, plane y=40
          ],
        });

        try {
          await w.__zilventorStore.getState().bus.execute(cmd);
        } catch (e) {
          return { ok: false, error: String(e) };
        }

        const s = w.__zilventorStore.getState();
        const doc = s.activeDocument?.kind === 'drawing'
          ? s.activeDocument.document as {
              sheets: Array<{ id: string; views: Array<{ id: string; kind: string; mode?: string; label?: string; stepSegments?: unknown[]; hatchSegments?: unknown[] }> }>;
            }
          : null;
        const sheet = doc?.sheets.find((sh) => sh.id === sheetId);
        const sectionView = sheet?.views.find((v) => v.kind === 'section');
        if (!sectionView) return { ok: false, error: 'no section view after bus.execute()' };

        // Count "A"-label allocator usage in this sheet (assertion iv).
        const labelACount = (sheet?.views ?? []).filter((v) => v.kind === 'section' && v.label === 'A').length;

        return {
          ok: true,
          sectionViewId: sectionView.id,
          mode: sectionView.mode,
          label: sectionView.label,
          labelACount,
          stepSegmentsLen: sectionView.stepSegments?.length ?? 0,
          hatchCount: sectionView.hatchSegments?.length ?? 0,
        };
      },
      { sheetId, baseViewId },
    );

    // Apply must succeed — if Batch 2/3 kernel binding regressed, this surfaces it.
    if (!result.ok) {
      throw new Error(`AddSectionViewCommand stepped dispatch failed: ${(result as { error?: string }).error ?? '(no error)'}`);
    }
    const sectionViewId = result.sectionViewId!;

    // ---- Assertion (i): view.mode === 'stepped' ----
    expect(result.mode).toBe('stepped');

    // ---- Assertion (ii): view.stepSegments.length === 3 (2-jog polyline) ----
    expect(result.stepSegmentsLen).toBe(3);

    // ---- Assertion (iii): view.hatchSegments.length > 0 ----
    expect(result.hatchCount).toBeGreaterThan(0);

    // ---- Assertion (iv): exactly one 'A' allocated for this view ----
    expect(result.label).toBe('A');
    expect(result.labelACount).toBe(1);

    // ---- Assertion (v): canvas DOM <polyline data-role="stepped-section-line"> rendered
    //                    inside the parent view's section overlay group ----
    const polyline = page.locator(`[data-section-overlay="${sectionViewId}"] polyline[data-role="stepped-section-line"]`);
    await expect(polyline).toHaveCount(1, { timeout: 5_000 });
    await expect(polyline).toBeVisible();

    // ---- Assertion (vi): Undo → SectionView removed; overlay removed ----
    const undoOk = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { undo(): Promise<boolean> } } };
      };
      return w.__zilventorStore.getState().bus.undo();
    });
    expect(undoOk).toBe(true);
    await expect(page.locator(`g[data-view-id="${sectionViewId}"]`)).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator(`[data-section-overlay="${sectionViewId}"]`)).toHaveCount(0, { timeout: 5_000 });

    // ---- Assertion (vii): Redo → SectionView restored; overlay restored ----
    //   Note: bus.redo() re-runs cmd.apply(), which allocates a NEW UUID for the
    //   restored view. Identity check is therefore done by re-querying the store
    //   for the (single) section view present after redo.
    const redoOk = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { redo(): Promise<boolean> } } };
      };
      return w.__zilventorStore.getState().bus.redo();
    });
    expect(redoOk).toBe(true);

    const redoSectionViewId = await page.evaluate(({ sheetId }: { sheetId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string }> }> } } | null;
          };
        };
      };
      const doc = w.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return null;
      const sheet = doc.document.sheets.find((sh) => sh.id === sheetId);
      const sv = sheet?.views.find((v) => v.kind === 'section');
      return sv?.id ?? null;
    }, { sheetId });
    expect(redoSectionViewId).not.toBeNull();
    await expect(page.locator(`g[data-view-id="${redoSectionViewId}"]`)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`[data-section-overlay="${redoSectionViewId}"] polyline[data-role="stepped-section-line"]`)).toHaveCount(1, { timeout: 5_000 });
  });

  test('Case 2: 3-jog variant (4 segments) — len/hatch/polyline-points', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.goto('/');
    await waitForKernelReady(page);

    // Same 100×60×40 fixture as Case 1.
    await page.getByRole('tab', { name: 'Model' }).click();
    await page.getByRole('button', { name: 'New Part' }).click();
    await page.getByRole('tab', { name: 'Sketch' }).click();
    await page.getByRole('button', { name: '2D Sketch' }).click();
    await page.getByRole('button', { name: 'Numeric rectangle…' }).click();
    await page.getByLabel('x1').fill('0');
    await page.getByLabel('y1').fill('0');
    await page.getByLabel('x2').fill('100');
    await page.getByLabel('y2').fill('60');
    await page.getByRole('button', { name: 'OK' }).click();
    await page.getByRole('button', { name: 'Finish Sketch' }).click();
    await page.getByRole('tab', { name: 'Model' }).click();
    await page.getByRole('button', { name: 'Extrude' }).click();
    await page.getByLabel('Distance').fill('40');
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByText(/Extrusion1/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 15_000 });

    const { sheetId, baseViewId } = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activePart: { id: string } | null; kernel: { execute(partId: string): Promise<unknown> } | null };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-13 Case 2: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);

      const partId = s.activePart.id;
      const sheetId = `sheet-T613c2-${Date.now()}`;
      const baseViewId = `base-T613c2-${Date.now()}`;
      const drawingId = `drawing-T613c2-${Date.now()}`;
      const frontViewMatrix = [1,0,0,-50, 0,1,0,-30, 0,0,1,-20, 0,0,0,1];

      const baseView = {
        id: baseViewId, kind: 'base',
        positionMm: { x: 80, y: 80 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        viewMatrix: frontViewMatrix,
        projection: {
          visibleEdges: [{ id: 'e0', kind: 'outline', points: [[0,0],[100,0],[100,40],[0,40],[0,0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
        },
        inputFingerprint: `fp-T613c2-${partId}`,
      };

      const drawing = {
        id: drawingId, name: 'T-6-13 Case 2 Drawing', units: 'mm',
        source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
        properties: {},
        sheets: [{
          id: sheetId, name: 'Sheet 1', size: { kind: 'iso', size: 'A3' },
          orientation: 'landscape',
          views: [baseView], dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: sheetId,
      };

      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: drawing },
        activeDrawing: drawing,
      });

      return { sheetId, baseViewId };
    });

    await page.getByRole('tab', { name: 'Drawing' }).click();
    await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

    // Dispatch with 4 segments (3 jogs). Segments alternate H/V/H/V, share endpoints,
    // and each plane (y=10, x=40, y=30, x=60) cleanly cuts the 100×60×40 box interior.
    const result = await page.evaluate(
      async ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              activeDocument: { kind: string; document: unknown } | null;
              bus: { execute(cmd: { apply(): Promise<void>; revert(): Promise<void> }): Promise<void> };
            };
          };
        };
        const { AddSectionViewCommand } = await import('/src/commands/AddSectionViewCommand.ts');
        const cmd = new AddSectionViewCommand({
          drawingId: 'T-6-13-c2',
          sheetId,
          parentViewId: baseViewId,
          p0: { x: -30, y: -20 },
          p1: { x:  10, y:  10 },
          arrowDirection: 1 as -1 | 1,
          dropAt: { x: 260, y: 80 },
          mode: 'stepped',
          stepSegments: [
            { startSheet: { x: -30, y: -20 }, endSheet: { x: -10, y: -20 } }, // H, plane y=10
            { startSheet: { x: -10, y: -20 }, endSheet: { x: -10, y:  0  } }, // V, plane x=40
            { startSheet: { x: -10, y:  0  }, endSheet: { x:  10, y:  0  } }, // H, plane y=30
            { startSheet: { x:  10, y:  0  }, endSheet: { x:  10, y: 10  } }, // V, plane x=60
          ],
        });
        try {
          await w.__zilventorStore.getState().bus.execute(cmd);
        } catch (e) {
          return { ok: false, error: String(e) };
        }
        const s = w.__zilventorStore.getState();
        const doc = s.activeDocument?.kind === 'drawing'
          ? s.activeDocument.document as { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; stepSegments?: unknown[]; hatchSegments?: unknown[] }> }> }
          : null;
        const sheet = doc?.sheets.find((sh) => sh.id === sheetId);
        const sectionView = sheet?.views.find((v) => v.kind === 'section');
        if (!sectionView) return { ok: false, error: 'no section view after bus.execute()' };
        return {
          ok: true,
          sectionViewId: sectionView.id,
          stepSegmentsLen: sectionView.stepSegments?.length ?? 0,
          hatchCount: sectionView.hatchSegments?.length ?? 0,
        };
      },
      { sheetId, baseViewId },
    );

    if (!result.ok) {
      throw new Error(`AddSectionViewCommand (Case 2) dispatch failed: ${(result as { error?: string }).error ?? '(no error)'}`);
    }
    const sectionViewId = result.sectionViewId!;

    // ---- view.stepSegments.length === 4 ----
    expect(result.stepSegmentsLen).toBe(4);

    // ---- hatchSegments.length > 0 ----
    expect(result.hatchCount).toBeGreaterThan(0);

    // ---- polyline points = 5 (N+1 vertices for N=4 segments) ----
    const polyline = page.locator(`[data-section-overlay="${sectionViewId}"] polyline[data-role="stepped-section-line"]`);
    await expect(polyline).toHaveCount(1, { timeout: 5_000 });

    const pointsAttr = await polyline.getAttribute('points');
    expect(pointsAttr).not.toBeNull();
    // SVG `points` is a space- or comma-separated list of "x,y" pairs.
    const numericPairs = pointsAttr!.trim().split(/\s+/).filter((p) => p.includes(','));
    expect(numericPairs).toHaveLength(5);
  });

  test('Case 3: empty-cut error — command throws, sheet.views.length unchanged', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.goto('/');
    await waitForKernelReady(page);

    // Same 100×60×40 fixture; same drawing seeding.
    await page.getByRole('tab', { name: 'Model' }).click();
    await page.getByRole('button', { name: 'New Part' }).click();
    await page.getByRole('tab', { name: 'Sketch' }).click();
    await page.getByRole('button', { name: '2D Sketch' }).click();
    await page.getByRole('button', { name: 'Numeric rectangle…' }).click();
    await page.getByLabel('x1').fill('0');
    await page.getByLabel('y1').fill('0');
    await page.getByLabel('x2').fill('100');
    await page.getByLabel('y2').fill('60');
    await page.getByRole('button', { name: 'OK' }).click();
    await page.getByRole('button', { name: 'Finish Sketch' }).click();
    await page.getByRole('tab', { name: 'Model' }).click();
    await page.getByRole('button', { name: 'Extrude' }).click();
    await page.getByLabel('Distance').fill('40');
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByText(/Extrusion1/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 15_000 });

    const { sheetId, baseViewId, viewsLenBefore } = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activePart: { id: string } | null; kernel: { execute(partId: string): Promise<unknown> } | null };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-13 Case 3: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);

      const partId = s.activePart.id;
      const sheetId = `sheet-T613c3-${Date.now()}`;
      const baseViewId = `base-T613c3-${Date.now()}`;
      const drawingId = `drawing-T613c3-${Date.now()}`;
      const frontViewMatrix = [1,0,0,-50, 0,1,0,-30, 0,0,1,-20, 0,0,0,1];

      const baseView = {
        id: baseViewId, kind: 'base',
        positionMm: { x: 80, y: 80 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        viewMatrix: frontViewMatrix,
        projection: {
          visibleEdges: [{ id: 'e0', kind: 'outline', points: [[0,0],[100,0],[100,40],[0,40],[0,0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
        },
        inputFingerprint: `fp-T613c3-${partId}`,
      };

      const drawing = {
        id: drawingId, name: 'T-6-13 Case 3 Drawing', units: 'mm',
        source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
        properties: {},
        sheets: [{
          id: sheetId, name: 'Sheet 1', size: { kind: 'iso', size: 'A3' },
          orientation: 'landscape',
          views: [baseView], dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: sheetId,
      };

      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: drawing },
        activeDrawing: drawing,
      });

      return { sheetId, baseViewId, viewsLenBefore: 1 };
    });

    await page.getByRole('tab', { name: 'Drawing' }).click();
    await expect(page.locator(`g[data-view-id="${baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

    // Dispatch with stepSegments entirely outside the 100×60×40 part. Sheet coords
    // (500,500)..(600,600) map to world planes at y=530, x=650 — both miss the box
    // (world x∈[0,100], y∈[0,60]) so kernel returns ok:false; command throws.
    const errorReport = await page.evaluate(
      async ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
        const { AddSectionViewCommand } = await import('/src/commands/AddSectionViewCommand.ts');
        const cmd = new AddSectionViewCommand({
          drawingId: 'T-6-13-c3',
          sheetId,
          parentViewId: baseViewId,
          p0: { x: 500, y: 500 },
          p1: { x: 600, y: 600 },
          arrowDirection: 1 as -1 | 1,
          dropAt: { x: 260, y: 80 },
          mode: 'stepped',
          stepSegments: [
            { startSheet: { x: 500, y: 500 }, endSheet: { x: 600, y: 500 } }, // H
            { startSheet: { x: 600, y: 500 }, endSheet: { x: 600, y: 600 } }, // V
          ],
        });
        let thrown: string | null = null;
        try {
          await cmd.apply();
        } catch (e) {
          thrown = String(e);
        }

        const w = window as unknown as { __zilventorStore: { getState(): { activeDocument: { kind: string; document: unknown } | null } } };
        const doc = w.__zilventorStore.getState().activeDocument?.kind === 'drawing'
          ? (w.__zilventorStore.getState().activeDocument!.document as { sheets: Array<{ id: string; views: unknown[] }> })
          : null;
        const sheet = doc?.sheets.find((sh) => sh.id === sheetId);
        return { thrown, viewsLenAfter: sheet?.views.length ?? -1 };
      },
      { sheetId, baseViewId },
    );

    // Command threw with the expected stepped-section-empty-cut message
    expect(errorReport.thrown).not.toBeNull();
    expect(errorReport.thrown).toMatch(/stepped-section-empty-cut/);

    // sheet.views.length unchanged — no partial SectionView was added.
    expect(errorReport.viewsLenAfter).toBe(viewsLenBefore);
  });
});
