import { test, expect, type Page } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * P13 W3 — real pointer-drag of a placed panel on the Nesting-tab sheet SVG.
 *
 * (a) valid drag to free space commits exactly one EditPlacedPanelCommand:
 *     panel x/y settle at the target, bus.lastExecutedName() flips to
 *     'EditPlacedPanel', and a single undo restores both the exact original
 *     x/y and the prior lastExecutedName() ('GenerateNest') — proving only
 *     one history entry was pushed for the whole gesture.
 * (b) an invalid drag (dropped onto another panel → overlap) is rejected:
 *     EditPlacedPanelCommand.apply() validates before it ever calls
 *     useAppStore.setState (see EditPlacedPanelCommand.ts apply()), so the
 *     panel's x/y never change and no command is pushed onto the undo stack.
 *     NestingTab shows the translated panel.sheet.edit.errorOverlap text.
 *
 * D5 (P13 plan): expect.poll 10s (suite default, not the 60s drag-gizmo
 * contention special case). No fixed sleeps.
 *
 * Coordinate-capture gotcha (found via debug-loop instrumentation): selecting
 * a panel for the FIRST time mounts the per-panel edit toolbar (rotate/flip/
 * move-nudge buttons) above the sheet SVG, shifting the SVG down the page.
 * screenToSheet() re-reads getBoundingClientRect() on every pointer event, so
 * if selection happens mid-gesture (via the drag's own pointerdown), the
 * anchor (pre-toolbar rect) and the later move/up reads (post-toolbar rect)
 * disagree, producing a bogus Y delta unrelated to actual cursor movement.
 * Fix: pre-select the panel with a plain click (movedPx=0, no command) so
 * the toolbar is mounted and layout is settled *before* bounding boxes are
 * captured for the real drag gesture.
 */

type PlacedPanelSnapshot = {
  x: number;
  y: number;
  length: number;
  width: number;
  itemNumber: number;
};

type NestSheetSnapshot = {
  sheetLengthMm: number;
  sheetWidthMm: number;
  panels: PlacedPanelSnapshot[];
};

type StoreState = {
  activeDocument?: { kind: string };
  activeAssembly?: {
    components: unknown[];
    nest?: { sheets: NestSheetSnapshot[] };
  } | null;
  addMaterial(m: unknown): void;
  addComponent(c: unknown): void;
  bus: { lastExecutedName(): string | null };
};

type StoreWindow = {
  __zilventorStore: { getState(): StoreState };
  __zilventorLoadCutListSpecs?: () => Promise<void>;
};

async function setupTwoPanelNest(page: Page): Promise<void> {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Assembly via ribbon.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as StoreWindow;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Material with sheet stock — sheet is large relative to the panels so
  // there is unambiguous free space for the valid-drag target.
  await page.evaluate(() => {
    const w = window as unknown as StoreWindow;
    w.__zilventorStore.getState().addMaterial({
      id: 'birch18',
      name: 'Birch 18mm',
      defaultThickness: 18,
      color: '#d2b48c',
      sheetLengthMm: 2440,
      sheetWidthMm: 1220,
    });
  });

  // 3. Two distinctly-sized panels → 2 cut-list rows → 2 placed panels.
  const panelDims = [
    { length: 300, width: 200 },
    { length: 260, width: 180 },
  ];
  for (let i = 1; i <= 2; i++) {
    const dim = panelDims[i - 1]!;
    await seedAssemblyPanelPart(page, {
      partPath: `panels/drag-p${i}.zipt`,
      partName: `Drag Panel ${i}`,
      length: dim.length,
      width: dim.width,
      thickness: 18,
      materialId: 'birch18',
      grain: 'length',
      materials: [{ id: 'birch18', name: 'Birch 18mm', defaultThickness: 18, color: '#d2b48c' }],
    });
    await page.evaluate((idx) => {
      const w = window as unknown as StoreWindow;
      w.__zilventorStore.getState().addComponent({
        id: `DC${idx}`,
        partPath: `panels/drag-p${idx}.zipt`,
        position: { x: idx * 700, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
    }, i);
  }

  await page.waitForFunction(() => {
    const w = window as unknown as StoreWindow;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 2;
  });

  await page.evaluate(async () => {
    const w = window as unknown as StoreWindow;
    await w.__zilventorLoadCutListSpecs?.();
  });

  // 4. Furniture tab → Generate Nest → kerf 3 → OK.
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Generate Nest' }).click();
  await expect(page.getByRole('dialog', { name: 'Nest dialog' })).toBeVisible();
  await page.getByLabel('Kerf').fill('3');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: 'Nest dialog' })).toHaveCount(0);

  // 5. Nesting tab.
  await page.getByLabel('Nesting tab').click();
  await expect(page.locator('[data-nesting-sheet]')).toHaveCount(1);
  await expect(page.locator('[data-nesting-panel]')).toHaveCount(2);
}

async function readNestSheet(page: Page): Promise<NestSheetSnapshot> {
  return page.evaluate(() => {
    const w = window as unknown as StoreWindow;
    const nest = w.__zilventorStore.getState().activeAssembly!.nest!;
    const sheet = nest.sheets[0]!;
    return {
      sheetLengthMm: sheet.sheetLengthMm,
      sheetWidthMm: sheet.sheetWidthMm,
      panels: sheet.panels.map((p) => ({ x: p.x, y: p.y, length: p.length, width: p.width, itemNumber: p.itemNumber })),
    };
  });
}

async function lastExecutedName(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as StoreWindow).__zilventorStore.getState().bus.lastExecutedName());
}

/**
 * Selects the panel with a plain click (no drag — movedPx=0, no command
 * dispatch) so the per-panel edit toolbar mounts and the sheet SVG's layout
 * settles *before* any bounding-box measurement for a real drag gesture.
 * Returns the settled panel <g> and sheet <svg> bounding boxes.
 */
async function preselectAndMeasure(
  page: Page,
  itemNumber: number,
  panelArrayIndex: number,
): Promise<{ panelBox: { x: number; y: number; width: number; height: number }; svgBox: { x: number; y: number; width: number; height: number } }> {
  const panelLocator = page.locator(`[data-nesting-panel="${itemNumber}:${panelArrayIndex}"]`);
  await panelLocator.click();
  // The per-panel toolbar (rotate/flip/move-nudge) only mounts once a panel
  // is selected — wait for it so the SVG's on-screen position is settled.
  await expect(page.getByRole('button', { name: 'Rotate 90°' })).toBeVisible();

  const svgLocator = page.locator('[data-nesting-sheet] svg').first();
  const panelBox = await panelLocator.boundingBox();
  const svgBox = await svgLocator.boundingBox();
  if (!panelBox || !svgBox) throw new Error('panel or svg bounding box is null');
  return { panelBox, svgBox };
}

test('T-p13-w3-1: valid drag to free space commits the move (settled x/y, single history entry)', async ({ page }) => {
  await setupTwoPanelNest(page);

  await page.getByRole('button', { name: 'Toggle nest edit mode' }).click();

  const before = await readNestSheet(page);
  const targetIndex = 0;
  const targetPanel = before.panels[targetIndex]!;

  // Brute-force scan from the sheet's bottom-right corner for a spot that
  // fits the dragged panel's own dims without overlapping any other panel —
  // mirrors EditPlacedPanelCommand's own bounds/overlap predicate exactly.
  // A 10mm margin off the true edge absorbs px<->mm floating-point slop from
  // the real on-screen drag (screenToSheet divides then multiplies).
  const freeSpot = await page.evaluate(
    (args: { sheet: NestSheetSnapshot; targetIndex: number; length: number; width: number }) => {
      const { sheet, targetIndex, length, width } = args;
      const margin = 10;
      const step = 20;
      for (let y = sheet.sheetWidthMm - width - margin; y >= margin; y -= step) {
        for (let x = sheet.sheetLengthMm - length - margin; x >= margin; x -= step) {
          const overlaps = sheet.panels.some((o, i) => {
            if (i === targetIndex) return false;
            return !(x + length <= o.x || o.x + o.length <= x || y + width <= o.y || o.y + o.width <= y);
          });
          if (!overlaps) return { x, y };
        }
      }
      return null;
    },
    { sheet: before, targetIndex, length: targetPanel.length, width: targetPanel.width },
  );
  expect(freeSpot, 'a free spot for the drag target must exist on a 2440x1220 sheet with only 2 small panels').not.toBeNull();
  const target = freeSpot!;

  expect(await lastExecutedName(page), 'baseline before drag is the nest-generation command').toBe('GenerateNest');

  // Pre-select (plain click, no drag) so the edit toolbar is mounted and the
  // SVG layout is settled before we measure pixel<->mm scale for the drag.
  const { panelBox, svgBox } = await preselectAndMeasure(page, targetPanel.itemNumber, targetIndex);

  const scaleX = svgBox.width / before.sheetLengthMm;
  const scaleY = svgBox.height / before.sheetWidthMm;
  const deltaPxX = (target.x - targetPanel.x) * scaleX;
  const deltaPxY = (target.y - targetPanel.y) * scaleY;

  const startX = panelBox.x + panelBox.width / 2;
  const startY = panelBox.y + panelBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaPxX / 2, startY + deltaPxY / 2, { steps: 5 });

  // Mid-drag: ghost preview must exist while the button is down.
  const ghost = page.locator(`[data-nesting-drag-ghost="${targetPanel.itemNumber}:${targetIndex}"]`);
  await expect(ghost, 'drag ghost must render while pointer is down and moved').toHaveCount(1);

  await page.mouse.move(startX + deltaPxX, startY + deltaPxY, { steps: 5 });
  await expect(ghost).toHaveAttribute('data-nesting-drag-valid', 'true');

  await page.mouse.up();

  // Ghost is idle-render only — must disappear once the gesture commits.
  await expect(ghost, 'drag ghost must be removed after pointerup').toHaveCount(0);

  await expect
    .poll(
      async () => {
        const after = await readNestSheet(page);
        const p = after.panels[targetIndex]!;
        const cmd = await lastExecutedName(page);
        return { dist: Math.hypot(p.x - target.x, p.y - target.y), cmd };
      },
      { timeout: 10_000, message: 'panel must settle at the free-space target and EditPlacedPanel must be the last executed command' },
    )
    .toMatchObject({ cmd: 'EditPlacedPanel' });

  const settled = await readNestSheet(page);
  const settledPanel = settled.panels[targetIndex]!;
  const settleDist = Math.hypot(settledPanel.x - target.x, settledPanel.y - target.y);
  expect(settleDist, `settled panel (${settledPanel.x},${settledPanel.y}) must be close to target (${target.x},${target.y})`).toBeLessThan(25);
  const movedDist = Math.hypot(settledPanel.x - targetPanel.x, settledPanel.y - targetPanel.y);
  expect(movedDist, 'the move must be a meaningful displacement, not a no-op').toBeGreaterThan(100);

  // Exactly one new history entry for the whole gesture: a single undo must
  // restore both the exact original x/y (revert snaps back the full prior
  // nest snapshot, not a pixel re-derivation) and the prior command name.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorStore: { getState(): { bus: { undo(): Promise<boolean> } } } };
    await w.__zilventorStore.getState().bus.undo();
  });

  await expect
    .poll(
      async () => {
        const after = await readNestSheet(page);
        return after.panels[targetIndex];
      },
      { timeout: 10_000, message: 'undo must restore the panel to its exact pre-drag position' },
    )
    .toEqual({ x: targetPanel.x, y: targetPanel.y, length: targetPanel.length, width: targetPanel.width, itemNumber: targetPanel.itemNumber });

  expect(await lastExecutedName(page), 'after one undo, the stack must be back to GenerateNest — proving only one entry was pushed').toBe('GenerateNest');
});

test('T-p13-w3-2: drag onto another panel is rejected — position unchanged, error text shown', async ({ page }) => {
  await setupTwoPanelNest(page);

  await page.getByRole('button', { name: 'Toggle nest edit mode' }).click();

  const before = await readNestSheet(page);
  const targetIndex = 0;
  const otherIndex = 1;
  const targetPanel = before.panels[targetIndex]!;
  const otherPanel = before.panels[otherIndex]!;

  // Sanity: dropping targetPanel's own dims at otherPanel's origin must be a
  // pure overlap rejection (not bounds) — guard the assumption loudly rather
  // than silently asserting the wrong error string if it ever breaks.
  const withinBounds =
    otherPanel.x + targetPanel.length <= before.sheetLengthMm && otherPanel.y + targetPanel.width <= before.sheetWidthMm;
  expect(withinBounds, 'dropping onto the other panel origin must stay within sheet bounds so the rejection reason is overlap, not bounds').toBe(true);

  const preDragCmd = await lastExecutedName(page);

  // Pre-select (plain click, no drag) so the edit toolbar is mounted and the
  // SVG layout is settled before we measure pixel<->mm scale for the drag.
  const { panelBox, svgBox } = await preselectAndMeasure(page, targetPanel.itemNumber, targetIndex);

  const scaleX = svgBox.width / before.sheetLengthMm;
  const scaleY = svgBox.height / before.sheetWidthMm;
  const deltaPxX = (otherPanel.x - targetPanel.x) * scaleX;
  const deltaPxY = (otherPanel.y - targetPanel.y) * scaleY;

  const startX = panelBox.x + panelBox.width / 2;
  const startY = panelBox.y + panelBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaPxX, startY + deltaPxY, { steps: 8 });

  const ghost = page.locator(`[data-nesting-drag-ghost="${targetPanel.itemNumber}:${targetIndex}"]`);
  await expect(ghost, 'ghost must render mid-drag').toHaveCount(1);
  await expect(ghost, 'ghost must be colored invalid while hovering the overlap target').toHaveAttribute('data-nesting-drag-valid', 'false');

  await page.mouse.up();
  await expect(ghost, 'ghost must be removed after pointerup regardless of accept/reject').toHaveCount(0);

  // KNOWN BUG (found via this test, root-caused with debug-loop — not a test
  // mistake): SheetSvg.tsx's onClick={() => onSelectPanel?.(i)} on the panel
  // <g> (line ~129) fires unconditionally after ANY pointerdown+move+up
  // gesture, because setPointerCapture retargets the trailing native 'click'
  // event back to the drag-origin element regardless of where the pointer
  // was released. That click re-invokes handleSelectPanel(), which calls
  // setEditError(null) (NestingTab.tsx) — clearing the rejection error that
  // EditPlacedPanelCommand's catch block had just set a tick earlier.
  // Verified via MutationObserver: the role="alert" div IS added with the
  // correct text, then immediately removed by the trailing click. A real
  // mouse drag reproduces this identically (confirmed via window-level
  // 'click' event tracing — Chromium does not suppress click after this
  // drag distance for a custom pointer-capture drag). Net effect: a
  // rejected drag's error text is not durably visible to the user.
  // Fix (out of this worker's scope — SheetSvg.tsx/NestingTab.tsx are W1/W2
  // files): guard the onClick handler with a "justDragged" ref set in
  // handleUp and checked/cleared at the top of onClick, so a trailing click
  // after a real drag gesture does not re-run the select/clear-error path.
  // Exact English string from packages/app/src/i18n/locales/en.json panel.sheet.edit.errorOverlap.
  await expect(page.getByRole('alert')).toHaveText('Move rejected: panel would overlap another panel');

  await expect
    .poll(
      async () => {
        const after = await readNestSheet(page);
        return after.panels[targetIndex];
      },
      { timeout: 10_000, message: 'rejected drag must leave the panel at its original position' },
    )
    .toEqual(targetPanel);

  expect(
    await lastExecutedName(page),
    'a rejected EditPlacedPanelCommand must throw before useAppStore.setState / undoStack.push — no new history entry',
  ).toBe(preDragCmd);
});
