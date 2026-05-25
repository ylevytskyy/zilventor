// tests/e2e/drawing/T-6-15-hole-table.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedDrawingWithBoxPart } from '../helpers/seedDrawing';

/**
 * T-6-15 — Hole Table (F6):
 *
 * Seeds a drawing with a part that has 3 holes of 2 distinct sizes (H1 dia=8,
 * H2 dia=8, H3 dia=12). Constructs a synthetic base view whose projected
 * visibleEdges carry sourceFaceIds for each hole (circle approximated as a
 * 16-point polyline). Injects an AddHoleTableCommand via the real command bus
 * to produce a HoleTableAnnotation. Asserts:
 *   - 3 table rows in the DOM (data-holetable-row)
 *   - Tags are A1, A2, B1 (size-grouped, stable)
 *   - XDIM/YDIM of A1 and B1 relative to the injected datum
 *   - Balloon/leader marker count == 3 (data-holetable-marker)
 * Then exercises undo (bus.undo()) and asserts the annotation disappears,
 * then redo (bus.redo()) and asserts it reappears.
 *
 * Uses store injection to avoid OPFS dependency — mirrors T-6-14 pattern.
 * Requires Batches 1-3 shipped (AddHoleTableCommand, HoleTableElement,
 * renderDrawingSvg case, computeHoleTableRows).
 */
test('T-6-15: Hole Table — inject command, assert rows + tags + datum dims + undo/redo', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // ── 1. Seed drawing (blank sheet, box 100×60×40) ──────────────────────────
  const { sheetId } = await seedDrawingWithBoxPart(page, {
    boxLength: 100, boxWidth: 60, boxHeight: 40,
    sheetSize: 'A3', orientation: 'landscape',
  });

  // ── 2. Inject part with 3 holes (2 distinct sizes) + base view ───────────
  //
  // Hole layout (all throughAll, front-face, part-mm):
  //   H1 (dia=8):  center (20, 20)
  //   H2 (dia=8):  center (50, 20)
  //   H3 (dia=12): center (80, 30)
  //
  // Each hole's circular boundary is approximated by 16 polyline points.
  // sourceFaceIds carries "<featureId>|hole|0" so extractHolesInView can
  // parse the featureId and look it up in featureTree.
  //
  // Datum edge: a synthetic edge at part-mm (0, 0) used as an edge-endpoint
  // PointRef for the datum; datumEdgeId = 'T615-datum'.
  // Datum resolves to part-mm [0, 0].
  //
  // Expected dims:
  //   A1 (H1): xDim = 20 - 0 = 20, yDim = 20 - 0 = 20
  //   A2 (H2): xDim = 50 - 0 = 50, yDim = 20 - 0 = 20
  //   B1 (H3): xDim = 80 - 0 = 80, yDim = 30 - 0 = 30

  const baseViewId = 'T615-base';
  const tableAnnotationId = 'T615-hole-table-1';

  await page.evaluate(
    ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: { kind: string; document: unknown };
            activePart: unknown;
          };
          setState(p: unknown): void;
        };
      };
      const s = w.__zilventorStore.getState();
      const drawing = s.activeDocument?.kind === 'drawing'
        ? (s.activeDocument.document as { sheets: Array<{ id: string; views: unknown[]; annotations: unknown[] }> })
        : null;
      if (!drawing) return;

      // Build a 16-point circle approximation around (cx, cy) with radius r.
      function circlePoints(cx: number, cy: number, r: number): ReadonlyArray<readonly [number, number]> {
        const pts: Array<readonly [number, number]> = [];
        for (let i = 0; i <= 16; i++) {
          const angle = (i / 16) * 2 * Math.PI;
          pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
        }
        return pts;
      }

      // Datum edge: a single horizontal edge whose start point is at (0,0).
      const datumEdge = {
        id: 'T615-datum',
        kind: 'outline' as const,
        points: [[0, 0], [10, 0]] as ReadonlyArray<readonly [number, number]>,
        sourceFaceIds: [] as string[],
      };

      // Hole H1 — dia 8 → radius 4, center (20, 20)
      const h1Edge = {
        id: 'T615-h1-circle',
        kind: 'feature' as const,
        points: circlePoints(20, 20, 4),
        sourceFaceIds: ['H1|hole|0'],
      };

      // Hole H2 — dia 8 → radius 4, center (50, 20)
      const h2Edge = {
        id: 'T615-h2-circle',
        kind: 'feature' as const,
        points: circlePoints(50, 20, 4),
        sourceFaceIds: ['H2|hole|0'],
      };

      // Hole H3 — dia 12 → radius 6, center (80, 30)
      const h3Edge = {
        id: 'T615-h3-circle',
        kind: 'feature' as const,
        points: circlePoints(80, 30, 6),
        sourceFaceIds: ['H3|hole|0'],
      };

      // Part with 3 hole features in featureTree.
      const partWithHoles = {
        ...(s.activePart as object),
        id: 'T615-part',
        name: 'T615Part',
        parameters: {
          length: { value: 100 },
          width: { value: 60 },
          height: { value: 40 },
          d_h1: { value: 8 },
          d_h2: { value: 8 },
          d_h3: { value: 12 },
        },
        featureTree: [
          // H1: simple throughAll, dia=8
          {
            id: 'H1',
            kind: 'hole',
            placement: { kind: 'fromSketch', sketchId: 'sk1' },
            profile: {
              kind: 'simple',
              diameter: { kind: 'param', paramName: 'd_h1' },
            },
            termination: { kind: 'throughAll' },
            flipAxis: false,
          },
          // H2: simple throughAll, dia=8 (same size → same tag letter as H1)
          {
            id: 'H2',
            kind: 'hole',
            placement: { kind: 'fromSketch', sketchId: 'sk1' },
            profile: {
              kind: 'simple',
              diameter: { kind: 'param', paramName: 'd_h2' },
            },
            termination: { kind: 'throughAll' },
            flipAxis: false,
          },
          // H3: simple throughAll, dia=12 (different size → new tag letter B)
          {
            id: 'H3',
            kind: 'hole',
            placement: { kind: 'fromSketch', sketchId: 'sk1' },
            profile: {
              kind: 'simple',
              diameter: { kind: 'param', paramName: 'd_h3' },
            },
            termination: { kind: 'throughAll' },
            flipAxis: false,
          },
        ],
      };

      const baseView = {
        id: baseViewId,
        kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front',
        showHidden: false,
        projection: {
          visibleEdges: [datumEdge, h1Edge, h2Edge, h3Edge],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
        },
        inputFingerprint: 'fp-T615-base',
      };

      const updatedDrawing = {
        ...drawing,
        sheets: drawing.sheets.map((sh) =>
          sh.id === sheetId ? { ...sh, views: [baseView] } : sh,
        ),
      };

      w.__zilventorStore.setState({
        activeDocument: { kind: 'drawing', document: updatedDrawing },
        activeDrawing: updatedDrawing,
        activePart: partWithHoles,
      });
    },
    { sheetId, baseViewId },
  );

  // ── 3. Switch to Drawing tab; assert base view renders ───────────────────
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator(`g[data-view-id="${baseViewId}"]`).first()).toBeVisible({ timeout: 10_000 });

  // ── 4. Inject AddHoleTableCommand via the real command bus ───────────────
  //
  // datum: edge-endpoint on 'T615-datum' end='start' → resolves to part-mm [0,0].
  // positionMm: table top-left at { x: 20, y: 200 } (below the view).
  // entries: empty on first placement — assignHoleTags assigns all fresh tags.

  const dispatchResult = await page.evaluate(
    async ({
      sheetId,
      baseViewId,
      tableAnnotationId,
    }: { sheetId: string; baseViewId: string; tableAnnotationId: string }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: {
              sheets: Array<{
                id: string;
                annotations: Array<{ id: string; kind: string }>;
              }>;
            } } | null;
            bus: {
              execute(cmd: { apply(): Promise<void>; revert(): Promise<void>; readonly name: string }): Promise<void>;
            };
          };
        };
      };

      const { AddHoleTableCommand } = await import('/src/commands/AddHoleTableCommand.ts');

      const ann = {
        kind: 'holeTable' as const,
        id: tableAnnotationId,
        viewId: baseViewId,
        datum: { kind: 'edge-endpoint' as const, edgeId: 'T615-datum', end: 'start' as const },
        positionMm: { x: 20, y: 200 },
        entries: [] as ReadonlyArray<{ readonly holeFeatureId: string; readonly tag: string }>,
      };

      const cmd = new AddHoleTableCommand({ sheetId, ann });

      try {
        await w.__zilventorStore.getState().bus.execute(cmd);
      } catch (e) {
        return { ok: false, error: String(e), annotationCount: 0 };
      }

      const s = w.__zilventorStore.getState();
      const doc = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
      const sheet = doc?.sheets.find((sh) => sh.id === sheetId);
      const annotationCount = sheet?.annotations.filter((a) => a.kind === 'holeTable').length ?? 0;

      return { ok: true, error: null, annotationCount };
    },
    { sheetId, baseViewId, tableAnnotationId },
  );

  expect(dispatchResult.ok, `AddHoleTableCommand dispatch failed: ${dispatchResult.error}`).toBe(true);
  expect(dispatchResult.annotationCount).toBe(1);

  // ── 5. Assert DOM: 3 rows, correct tags, XDIM/YDIM, 3 markers ───────────
  //
  // HoleTableElement renders:
  //   [data-holetable-row="<tag>"]   — one per hole row
  //   [data-holetable-tag="<tag>"]   — tag cell text
  //   [data-holetable-xdim="<tag>"]  — XDIM cell text (rounded, mm)
  //   [data-holetable-ydim="<tag>"]  — YDIM cell text (rounded, mm)
  //   [data-holetable-marker="<tag>"] — balloon+leader per hole

  // Wait for React to render the table.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-holetable-row]').length === 3,
    undefined,
    { timeout: 10_000 },
  );

  // 3 table rows
  await expect(page.locator('[data-holetable-row]')).toHaveCount(3);

  // Tags: A1, A2, B1 (size-grouped: H1+H2 share dia=8 → letter A; H3 dia=12 → letter B)
  await expect(page.locator('[data-holetable-row="A1"]')).toBeAttached();
  await expect(page.locator('[data-holetable-row="A2"]')).toBeAttached();
  await expect(page.locator('[data-holetable-row="B1"]')).toBeAttached();

  // XDIM and YDIM for A1: (20-0)=20, (20-0)=20.
  // Tolerance: precision=0 (±0.5mm) accounts for Kasa circle-fit rounding
  // on a 17-point polyline. The rendered text uses toFixed(1) so values like
  // "20.0" or "19.9" are both acceptable — the center is correct to ±0.5mm.
  const xdimA1 = await page.locator('[data-holetable-xdim="A1"]').textContent();
  const ydimA1 = await page.locator('[data-holetable-ydim="A1"]').textContent();
  expect(parseFloat(xdimA1!)).toBeCloseTo(20, 0);
  expect(parseFloat(ydimA1!)).toBeCloseTo(20, 0);

  // XDIM and YDIM for B1: (80-0)=80, (30-0)=30
  const xdimB1 = await page.locator('[data-holetable-xdim="B1"]').textContent();
  const ydimB1 = await page.locator('[data-holetable-ydim="B1"]').textContent();
  expect(parseFloat(xdimB1!)).toBeCloseTo(80, 0);
  expect(parseFloat(ydimB1!)).toBeCloseTo(30, 0);

  // 3 balloon/leader markers
  await expect(page.locator('[data-holetable-marker]')).toHaveCount(3);

  // ── 6. Undo via the real command bus → annotation disappears ─────────────
  const undoOk = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { undo(): Promise<boolean> } } };
    };
    return w.__zilventorStore.getState().bus.undo();
  });
  expect(undoOk).toBe(true);

  // Annotation removed from store
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: {
              kind: string;
              document: { sheets: Array<{ annotations: Array<{ kind: string }> }> };
            };
          };
        };
      };
      const doc = w.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return false;
      return doc.document.sheets[0]?.annotations.filter((a) => a.kind === 'holeTable').length === 0;
    },
    undefined,
    { timeout: 5_000 },
  );

  // DOM rows gone
  await expect(page.locator('[data-holetable-row]')).toHaveCount(0, { timeout: 5_000 });

  // ── 7. Redo via the real command bus → annotation reappears ─────────────
  const redoOk = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { redo(): Promise<boolean> } } };
    };
    return w.__zilventorStore.getState().bus.redo();
  });
  expect(redoOk).toBe(true);

  // Annotation back in store
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: {
              kind: string;
              document: { sheets: Array<{ annotations: Array<{ kind: string }> }> };
            };
          };
        };
      };
      const doc = w.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return false;
      return doc.document.sheets[0]?.annotations.filter((a) => a.kind === 'holeTable').length === 1;
    },
    undefined,
    { timeout: 5_000 },
  );

  // DOM rows back
  await expect(page.locator('[data-holetable-row]')).toHaveCount(3, { timeout: 5_000 });
});
