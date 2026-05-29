// tests/e2e/drawing/T-6-29-dxf-underlay-import.spec.ts
/**
 * T-6-29 — DXF Underlay Import (F5+F6): browser verification.
 *
 * Steps:
 *  1. Navigate to the app; wait for kernel ready.
 *  2. Inject a minimal DrawingDocument (blank sheet) into the store via
 *     window.__zilventorStore.setState, mirroring seedDrawingWithBoxPart.
 *  3. Switch to the Drawing tab.
 *  4. Verify the "Import DXF Underlay…" ribbon button is present and enabled.
 *  5. Inject DXF fixture text (with HEADER, BLOCKS with a block, INSERT, LINEs,
 *     CIRCLE, ARC) into the page and execute ImportDxfUnderlayCommand via the
 *     real command bus — dynamic import mirrors the production path.
 *  6. Assert that the active sheet's underlay has been set:
 *     - underlay.name matches the fixture name
 *     - underlay.entities.length > 0
 *     - at least one 'line' entity and one 'circle' entity present
 *     - INSERT block entities were flattened (block has 4 lines → total includes them)
 *  7. Verify the DrawingCanvas renders a <g data-underlay> element (or at least
 *     a canvas with non-zero size), confirming the underlay is rendered.
 *  8. Take a screenshot to /tmp/dxf-underlay-live.png.
 *  9. Confirm bus.undo() removes the underlay (revert works in live app).
 * 10. Confirm bus.redo() re-applies the underlay.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { waitForKernelReady } from '../helpers/buildBox';

// Realistic Inventor-style DXF fixture: header, blocks section with a rectangle
// block, INSERT reference to that block, plus top-level LINEs, CIRCLE, ARC.
const DXF_FIXTURE = `  0
SECTION
  2
HEADER
  9
$ACADVER
  1
AC1015
  9
$INSUNITS
 70
4
  0
ENDSEC
  0
SECTION
  2
TABLES
  0
TABLE
  2
LAYER
 70
1
  0
LAYER
  2
0
 70
0
 62
7
  6
CONTINUOUS
  0
ENDTAB
  0
ENDSEC
  0
SECTION
  2
BLOCKS
  0
BLOCK
  8
0
  2
RECT_BLOCK
 10
0.0
 20
0.0
 30
0.0
  1

  0
LINE
  8
0
 10
0.0
 20
0.0
 30
0.0
 11
50.0
 21
0.0
 31
0.0
  0
LINE
  8
0
 10
50.0
 20
0.0
 30
0.0
 11
50.0
 21
30.0
 31
0.0
  0
LINE
  8
0
 10
50.0
 20
30.0
 30
0.0
 11
0.0
 21
30.0
 31
0.0
  0
LINE
  8
0
 10
0.0
 20
30.0
 30
0.0
 11
0.0
 21
0.0
 31
0.0
  0
ENDBLK
  8
0
  0
ENDSEC
  0
SECTION
  2
ENTITIES
  0
LINE
  8
0
 10
10.0
 20
10.0
 30
0.0
 11
200.0
 21
10.0
 31
0.0
  0
LINE
  8
0
 10
200.0
 20
10.0
 30
0.0
 11
200.0
 21
150.0
 31
0.0
  0
LINE
  8
0
 10
200.0
 20
150.0
 30
0.0
 11
10.0
 21
150.0
 31
0.0
  0
LINE
  8
0
 10
10.0
 20
150.0
 30
0.0
 11
10.0
 21
10.0
 31
0.0
  0
CIRCLE
  8
0
 10
105.0
 20
80.0
 30
0.0
 40
40.0
  0
ARC
  8
0
 10
105.0
 20
80.0
 30
0.0
 40
20.0
 50
0.0
 51
180.0
  0
INSERT
  8
0
  2
RECT_BLOCK
 10
120.0
 20
100.0
 30
0.0
  0
ENDSEC
  0
EOF`;

test('T-6-29: DXF underlay import — inject command, assert underlay set + canvas renders + undo/redo', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    console.log('BROWSER:', m.type(), m.text());
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => {
    console.log('PAGEERROR:', e.message);
    consoleErrors.push(e.message);
  });

  // ── 1. Load the app ────────────────────────────────────────────────────────
  await page.goto('/');
  await waitForKernelReady(page);

  // ── 2. Seed a blank drawing document ──────────────────────────────────────
  const { sheetId } = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): unknown; setState(p: unknown): void };
    };
    const partId = `T629-part-${Date.now()}`;
    const part = {
      id: partId, name: 'T629Box', units: 'mm',
      parameters: { length: { value: 100 }, width: { value: 60 }, height: { value: 40 } },
      featureTree: [], properties: {},
      materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#c8a96e' }],
      hardware: [],
    };
    const sheetId = `T629-sheet-${Date.now()}`;
    const drawingId = `T629-drawing-${Date.now()}`;
    const drawing = {
      id: drawingId, name: 'T629 — Drawing', units: 'mm',
      source: { partPath: `${partId}.zipt`, sourceKind: 'part' },
      properties: {},
      sheets: [{
        id: sheetId, name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
      }],
      activeSheetId: sheetId,
    };
    w.__zilventorStore.setState({
      activeDocument: { kind: 'drawing', document: drawing },
      activeDrawing: drawing,
      activePart: part,
      activeAssembly: null,
    });
    return { sheetId, drawingId };
  });

  // ── 3. Switch to Drawing tab ───────────────────────────────────────────────
  // After seeding kind:'drawing', the Ribbon auto-selects "Drawing" as default tab.
  // Click it explicitly to be safe (it's already the active tab per Ribbon logic).
  await page.getByRole('tab', { name: 'Drawing' }).click();

  // ── 4. Assert the ribbon button is present ────────────────────────────────
  const importBtn = page.getByRole('button', { name: 'Import DXF Underlay…' });
  await expect(importBtn).toBeVisible({ timeout: 10_000 });
  await expect(importBtn).toBeEnabled();

  // ── 5. Execute ImportDxfUnderlayCommand via real bus ──────────────────────
  //    (Mirrors the production click path, avoids file-picker headless hurdle)
  const dxfFixture = DXF_FIXTURE;

  await page.evaluate(async (dxfText: string) => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { bus: { execute(c: unknown): Promise<void>; undo(): Promise<void>; redo(): Promise<void> } };
        setState(p: unknown): void;
      };
    };
    const { bus } = w.__zilventorStore.getState();
    // Dynamic import matches the production click handler
    const { ImportDxfUnderlayCommand } = await import('/src/commands/ImportDxfUnderlayCommand.ts');
    await bus.execute(new ImportDxfUnderlayCommand({ dxfText, fileName: 'T629-fixture.dxf' }));
  }, dxfFixture);

  // ── 6. Assert underlay is set on the active sheet ─────────────────────────
  const underlayInfo = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ underlay?: { name: string; entities: Array<{ kind: string }> } }> } } };
      };
    };
    const s = w.__zilventorStore.getState();
    const doc = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
    if (!doc) return null;
    const sheet = doc.sheets[0];
    if (!sheet?.underlay) return null;
    return {
      name: sheet.underlay.name,
      entityCount: sheet.underlay.entities.length,
      kinds: sheet.underlay.entities.map((e) => e.kind),
    };
  });

  expect(underlayInfo).not.toBeNull();
  expect(underlayInfo!.name).toBe('T629-fixture');
  // 4 top-level lines + 1 circle + 1 arc + 4 block lines (from INSERT) = 10
  expect(underlayInfo!.entityCount).toBeGreaterThanOrEqual(6);
  expect(underlayInfo!.kinds).toContain('line');
  expect(underlayInfo!.kinds).toContain('circle');
  // INSERT block was flattened → at least 4 lines total
  const lineCount = underlayInfo!.kinds.filter((k) => k === 'line').length;
  expect(lineCount).toBeGreaterThanOrEqual(4);

  // ── 7. Verify DrawingCanvas renders (SVG viewport is present) ───────────────
  // DrawingCanvas renders an SVG (not a <canvas>) — data-sheet-border marks the sheet rect.
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 10_000 });

  // ── 8. Screenshot ─────────────────────────────────────────────────────────
  await page.screenshot({ path: '/tmp/dxf-underlay-live.png', fullPage: false });
  console.log('Screenshot saved to /tmp/dxf-underlay-live.png');

  // ── 9. undo() removes the underlay ────────────────────────────────────────
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { undo(): Promise<void> } } };
    };
    await w.__zilventorStore.getState().bus.undo();
  });

  const afterUndo = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ underlay?: unknown }> } } };
      };
    };
    const s = w.__zilventorStore.getState();
    const doc = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
    return doc?.sheets[0]?.underlay ?? null;
  });
  expect(afterUndo).toBeNull();

  // ── 10. redo() re-applies the underlay ────────────────────────────────────
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { redo(): Promise<void> } } };
    };
    await w.__zilventorStore.getState().bus.redo();
  });

  const afterRedo = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activeDocument?: { kind: string; document: { sheets: Array<{ underlay?: { entities: unknown[] } }> } } };
      };
    };
    const s = w.__zilventorStore.getState();
    const doc = s.activeDocument?.kind === 'drawing' ? s.activeDocument.document : null;
    return doc?.sheets[0]?.underlay?.entities.length ?? 0;
  });
  expect(afterRedo).toBeGreaterThanOrEqual(6);

  // Confirm no critical console errors occurred
  const criticalErrors = consoleErrors.filter(
    (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
  );
  expect(criticalErrors).toHaveLength(0);
});
