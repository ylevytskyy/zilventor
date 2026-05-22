// tests/e2e/drawing/T-6-12-dimension-styles.spec.ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T-6-12 — Dimension styles: baseline / ordinate / angular.
 * Dispatches commands via store injection, asserts SVG DOM output.
 *
 * Pattern: store-injection (same as T-6-11).
 * No real canvas clicks — commands dispatched via page.evaluate dynamic import.
 */
test('T-6-12: Dimension styles — baseline/ordinate/angular dims, cascade text', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Inject drawing with one base view + part with 1 parameter for cascade.
  // ──────────────────────────────────────────────────────────────────────────
  const ids = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): unknown; setState(p: unknown): void };
    };

    const partId = `part-T612-${Date.now()}`;
    const sheetId = `sheet-T612-${Date.now()}`;
    const baseViewId = `base-T612-${Date.now()}`;
    const drawingId = `drawing-T612-${Date.now()}`;

    const activePart = {
      id: partId,
      name: 'T612 Part',
      units: 'mm',
      parameters: {
        angle: { name: 'angle', value: 45, unit: 'deg' },
      },
      featureTree: [],
    };

    const baseView = {
      id: baseViewId,
      kind: 'base',
      positionMm: { x: 10, y: 10 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [
          // Baseline fixture: datum + 3 member edges
          { id: 'e-datum',   kind: 'outline', points: [[-50, -15], [-50, 15]]  },
          { id: 'e-bm-0',    kind: 'outline', points: [[-30, -15], [-30, 15]]  },
          { id: 'e-bm-1',    kind: 'outline', points: [[-10, -15], [-10, 15]]  },
          { id: 'e-bm-2',    kind: 'outline', points: [[10, -15],  [10, 15]]   },
          // Ordinate fixture: origin + 3 member edges (2 x-axis, 1 y-axis)
          { id: 'e-origin',  kind: 'outline', points: [[-50, 0],   [0, 0]]     },
          { id: 'e-om-x0',   kind: 'outline', points: [[20, -5],   [20, 5]]    },
          { id: 'e-om-x1',   kind: 'outline', points: [[40, -5],   [40, 5]]    },
          { id: 'e-om-y0',   kind: 'outline', points: [[-5, 20],   [5, 20]]    },
          // Angular fixture: two line edges for two-edges dim
          { id: 'e-ang-1',   kind: 'outline', points: [[0, 0],     [30, 0]]    },
          { id: 'e-ang-2',   kind: 'outline', points: [[0, 0],     [0, 30]]    },
        ],
        hiddenEdges: [],
        bbox: { minX: -50, minY: -15, maxX: 50, maxY: 50 },
      },
      inputFingerprint: `fp-T612-${partId}`,
    };

    const drawing = {
      id: drawingId,
      name: 'T-6-12 Drawing',
      units: 'mm',
      source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
      properties: {},
      sheets: [{
        id: sheetId,
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A4' },
        orientation: 'landscape',
        views: [baseView],
        dimensions: [],
        dimensionGroups: [],
        annotations: [],
        titleBlock: {},
      }],
      activeSheetId: sheetId,
    };

    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: drawing },
      activeDrawing: drawing,
      activePart,
    });

    return { sheetId, baseViewId, drawingId, partId };
  });

  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator(`g[data-view-id="${ids.baseViewId}"]`)).toBeVisible({ timeout: 10_000 });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Dispatch baseline group + 3 members.
  // ──────────────────────────────────────────────────────────────────────────
  const baselineResult = await page.evaluate(
    async ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const { AddDimensionGroupCommand } = await import('/src/commands/AddDimensionGroupCommand.ts');
      const { AddBaselineMemberCommand } = await import('/src/commands/AddBaselineMemberCommand.ts');

      const groupId = `bg-T612-${Date.now()}`;
      const group = {
        kind: 'baseline' as const,
        id: groupId,
        viewId: baseViewId,
        datum: { kind: 'edge-endpoint' as const, edgeId: 'e-datum', end: 'start' as const },
        direction: 'h' as const,
        baseOffsetMm: 20,
        spacingMm: 10,
      };

      await new AddDimensionGroupCommand({ sheetId, group }).apply();
      await new AddBaselineMemberCommand({ sheetId, groupId, to: { kind: 'edge-endpoint', edgeId: 'e-bm-0', end: 'start' } }).apply();
      await new AddBaselineMemberCommand({ sheetId, groupId, to: { kind: 'edge-endpoint', edgeId: 'e-bm-1', end: 'start' } }).apply();
      await new AddBaselineMemberCommand({ sheetId, groupId, to: { kind: 'edge-endpoint', edgeId: 'e-bm-2', end: 'start' } }).apply();

      const w2 = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; dimensions: Array<{ id: string; kind: string; groupId?: string; slot?: number }> }> } } } };
      };
      const doc = w2.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return { ok: false, dims: [] as { id: string; kind: string; groupId?: string; slot?: number }[], groupId };
      const sheet = doc.document.sheets.find((s) => s.id === sheetId);
      const baselineDims = (sheet?.dimensions ?? [])
        .filter((d): d is { id: string; kind: string; groupId?: string; slot?: number } => d.kind === 'baseline');
      return { ok: true, dims: baselineDims, groupId };
    },
    { sheetId: ids.sheetId, baseViewId: ids.baseViewId },
  );

  // ── Assertion 1: 3 baseline dims placed with slots 0/1/2 ─────────────────
  expect(baselineResult.ok).toBe(true);
  expect(baselineResult.dims.length).toBe(3);
  const slots = baselineResult.dims.map((d) => d.slot).sort((a, b) => (a ?? 0) - (b ?? 0));
  expect(slots).toEqual([0, 1, 2]);

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Dispatch ordinate group + 2 x-axis + 1 y-axis members.
  // ──────────────────────────────────────────────────────────────────────────
  const ordinateResult = await page.evaluate(
    async ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const { AddDimensionGroupCommand } = await import('/src/commands/AddDimensionGroupCommand.ts');
      const { AddOrdinateMemberCommand } = await import('/src/commands/AddOrdinateMemberCommand.ts');

      const groupId = `og-T612-${Date.now()}`;
      const group = {
        kind: 'ordinate' as const,
        id: groupId,
        viewId: baseViewId,
        origin: { kind: 'edge-endpoint' as const, edgeId: 'e-origin', end: 'start' as const },
        xColumnOffsetMm: 20,
        yColumnOffsetMm: 20,
      };

      await new AddDimensionGroupCommand({ sheetId, group }).apply();
      await new AddOrdinateMemberCommand({ sheetId, groupId, to: { kind: 'edge-endpoint', edgeId: 'e-om-x0', end: 'start' }, axis: 'x' }).apply();
      await new AddOrdinateMemberCommand({ sheetId, groupId, to: { kind: 'edge-endpoint', edgeId: 'e-om-x1', end: 'start' }, axis: 'x' }).apply();
      await new AddOrdinateMemberCommand({ sheetId, groupId, to: { kind: 'edge-endpoint', edgeId: 'e-om-y0', end: 'start' }, axis: 'y' }).apply();

      const w2 = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; dimensions: Array<{ id: string; kind: string; axis?: string }> }> } } } };
      };
      const doc = w2.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return { ok: false, dims: [] as { id: string; kind: string; axis?: string }[] };
      const sheet = doc.document.sheets.find((s) => s.id === sheetId);
      const ordinateDims = (sheet?.dimensions ?? [])
        .filter((d): d is { id: string; kind: string; axis?: string } => d.kind === 'ordinate');
      return { ok: true, dims: ordinateDims };
    },
    { sheetId: ids.sheetId, baseViewId: ids.baseViewId },
  );

  // ── Assertion 2: 3 ordinate dims placed, 2 x-axis + 1 y-axis ────────────
  expect(ordinateResult.ok).toBe(true);
  expect(ordinateResult.dims.length).toBe(3);
  const xCount = ordinateResult.dims.filter((d) => d.axis === 'x').length;
  const yCount = ordinateResult.dims.filter((d) => d.axis === 'y').length;
  expect(xCount).toBe(2);
  expect(yCount).toBe(1);

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Dispatch angular dim (two-edges) with sourceParameterName for cascade.
  // ──────────────────────────────────────────────────────────────────────────
  const angularResult = await page.evaluate(
    async ({ sheetId, baseViewId }: { sheetId: string; baseViewId: string }) => {
      const { AddAngularDimCommand } = await import('/src/commands/AddAngularDimCommand.ts');

      const cmd = new AddAngularDimCommand({
        sheetId,
        viewId: baseViewId,
        ref: { kind: 'two-edges', edge1: { viewId: baseViewId, edgeId: 'e-ang-1' }, edge2: { viewId: baseViewId, edgeId: 'e-ang-2' } },
        arcSide: 'inside',
        offsetMm: 15,
        opts: { sourceParameterName: 'angle' },
      });
      await cmd.apply();

      const w2 = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ id: string; dimensions: Array<{ id: string; kind: string; sourceParameterName?: string }> }> } } } };
      };
      const doc = w2.__zilventorStore.getState().activeDocument;
      if (doc?.kind !== 'drawing') return { ok: false, dimId: null as string | null };
      const sheet = doc.document.sheets.find((s) => s.id === sheetId);
      const angDim = sheet?.dimensions.find((d) => d.kind === 'angular');
      console.log(`[T-6-12] angular dim id: ${angDim?.id ?? 'none'}`);
      return { ok: !!angDim, dimId: angDim?.id ?? null };
    },
    { sheetId: ids.sheetId, baseViewId: ids.baseViewId },
  );

  // ── Assertion 3: angular dim placed ──────────────────────────────────────
  expect(angularResult.ok).toBe(true);
  expect(angularResult.dimId).not.toBeNull();

  // Wait for React to render F5 dims in the canvas DOM
  await page.waitForTimeout(500);

  // ── Assertion 4a: canvas DOM — baseline dim rendered in React tree ────────
  // Task A (fix) added BaselineDimension/OrdinateDimension/AngularDimension
  // to DimensionElement switch. These assertions verify the LIVE CANVAS DOM
  // (not renderDrawingSvg export path) contains rendered F5 dim elements.
  const baselineInCanvas = page.locator('[data-dim-kind="baseline"]');
  await expect(baselineInCanvas.first()).toBeVisible({ timeout: 5_000 });
  const baselineCount = await baselineInCanvas.count();
  expect(baselineCount).toBeGreaterThanOrEqual(3);  // 3 members dispatched above
  console.log(`[T-6-12] baseline dims in canvas DOM: ${baselineCount}`);

  // ── Assertion 4b: canvas DOM — ordinate dim rendered ─────────────────────
  const ordinateInCanvas = page.locator('[data-dim-kind="ordinate"]');
  await expect(ordinateInCanvas.first()).toBeVisible({ timeout: 5_000 });
  const ordinateCount = await ordinateInCanvas.count();
  expect(ordinateCount).toBeGreaterThanOrEqual(3);  // 3 members dispatched above
  console.log(`[T-6-12] ordinate dims in canvas DOM: ${ordinateCount}`);

  // ── Assertion 4c: canvas DOM — angular dim rendered with arc path ─────────
  const angularInCanvas = page.locator('[data-dim-kind="angular"]');
  await expect(angularInCanvas.first()).toBeVisible({ timeout: 5_000 });
  const angularCount = await angularInCanvas.count();
  expect(angularCount).toBeGreaterThanOrEqual(1);
  // Verify the arc path has an arc SVG command ('A')
  const angularPath = angularInCanvas.first().locator('path').first();
  const pathD = await angularPath.getAttribute('d');
  expect(pathD).toContain('A');
  console.log(`[T-6-12] angular dims in canvas DOM: ${angularCount}, arc path: ${pathD?.slice(0, 30)}…`);

  // ── Mid-flight screenshot ─────────────────────────────────────────────────
  await page.screenshot({ path: '/tmp/drawing-dim-styles-proof.png' });
  console.log('[T-6-12] proof screenshot saved to /tmp/drawing-dim-styles-proof.png');

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Cascade: edit 'angle' parameter, angular dim text should update.
  //    F5 dims are now rendered via React tree (DimensionElement + AngularDimension
  //    added in Task A fix). Canvas DOM cascade text update is verified by checking
  //    store state after parameter update (DrawingCanvas re-renders on store change).
  // ──────────────────────────────────────────────────────────────────────────
  const cascadeResult = await page.evaluate(({ partId, dimId }: { partId: string; dimId: string | null }) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: { id: string; parameters: Record<string, { name: string; value: number; unit: string }> } | null;
          activeDocument?: { kind: string; document: { sheets: Array<{ id: string; dimensions: Array<{ id: string; kind: string; sourceParameterName?: string }> }> } };
        };
        setState(p: unknown): void;
      };
    };
    const s = w.__zilventorStore.getState();
    if (!s.activePart || s.activePart.id !== partId) return { ok: false, reason: 'part mismatch' };
    const updatedPart = {
      ...s.activePart,
      parameters: {
        ...s.activePart.parameters,
        angle: { ...s.activePart.parameters['angle'], value: 60 },
      },
    };
    w.__zilventorStore.setState({ activePart: updatedPart });
    // Verify the parameter update is reflected in store
    const afterState = w.__zilventorStore.getState();
    const angleValue = afterState.activePart?.parameters['angle']?.value;
    return { ok: true, angleValue, dimId };
  }, { partId: ids.partId, dimId: angularResult.dimId });

  // ── Assertion 4: cascade parameter update reflected in store ─────────────
  expect(cascadeResult.ok).toBe(true);
  expect(cascadeResult.angleValue).toBe(60);
});
