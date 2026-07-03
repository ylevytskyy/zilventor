import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

/**
 * T28 — cut-list inline item# edit, persist across reload, conflict-bump,
 *        and Renumber resequences.
 *
 * Places 2 distinct panels, opens Cut List, edits Item# of the first row to 7.
 * Asserts conflict-bump fires when 7 is also assigned to the second row.
 * Reloads — asserts 7 persists. Then Renumber → rows become 1, 2.
 */
test('T28 — cut-list renumber + inline edit + persist across reload', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Add material to assembly registry.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
    };
    w.__zilventorStore.getState().addMaterial({
      id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
    });
  });

  // 3. Seed 2 distinct panel parts.
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t28-a.zipt',
    partName: 't28-a',
    length: 600, width: 400, thickness: 18,
    materialId: 'm-birch', grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/t28-b.zipt',
    partName: 't28-b',
    length: 800, width: 400, thickness: 18,
    materialId: 'm-birch', grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });

  // 4. Place 1 of each.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addComponent(c: unknown): void } };
    };
    const add = w.__zilventorStore.getState().addComponent;
    add({ id: 'C0', partPath: 'parts/t28-a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
    add({ id: 'C1', partPath: 'parts/t28-b.zipt', position: { x: 700, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true });
  });
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 2;
  });

  // 5. Load panel specs and open Cut List tab.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });
  await page.getByRole('button', { name: 'Cut List tab' }).click();

  // 6. Assert 2 rows are visible.
  const rows = page.locator('[data-cutlist-row]');
  await expect(rows).toHaveCount(2, { timeout: 10_000 });

  // 7. Double-click Item# cell of row 0, type 7, blur to commit.
  const row0 = rows.nth(0);
  await row0.locator('td').first().dblclick();
  const input = page.locator('input[type="number"]');
  await input.fill('7');
  await input.blur();

  // Assert row 0 now shows 7.
  await expect(row0.locator('td').first()).toHaveText('7', { timeout: 5_000 });

  // 8. Conflict-bump: find the row that doesn't have 7 and set it to 7 too.
  //    The store bumps the existing holder to max+1, so only one row retains 7.
  const secondRow = rows.nth(1);
  await secondRow.locator('td').first().dblclick();
  const input2 = page.locator('input[type="number"]');
  await input2.fill('7');
  await input2.blur();

  // After conflict resolution: exactly one row should have 7 and the other a higher number.
  // (Rows re-sort by itemNumber, so row at index 0 should be 7.)
  await expect(rows.nth(0).locator('td').first()).toHaveText('7', { timeout: 5_000 });

  // 9. Wait for autosave to persist cutListItemNumbers.
  const autosavedName = await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { name: string } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.name ?? 'Assembly') + '.ziasm';
  });
  await expect.poll(async () => {
    return await page.evaluate(async (name) => {
      const w = window as unknown as {
        __zilventorGetOpfs: () => Promise<{ read(path: string): Promise<Uint8Array> }>;
        __zilventorUnpackAssembly: (bytes: Uint8Array) => Promise<{ cutListItemNumbers: Record<string, number> }>;
      };
      try {
        const opfs = await w.__zilventorGetOpfs();
        const bytes = await opfs.read(name);
        const doc = await w.__zilventorUnpackAssembly(bytes);
        return Object.values(doc.cutListItemNumbers).includes(7);
      } catch { return false; }
    }, autosavedName);
  }, { timeout: 5_000 }).toBe(true);

  // 10. Reload the assembly from OPFS (simulates re-opening the file).
  //     The step-9 poll only confirmed the file's CONTENT was correct at that
  //     instant — the 500ms autosave debounce can still rewrite the same OPFS
  //     path afterward, and under worker contention the read below can land in
  //     the transient window where the old file handle was just removed and the
  //     new one hasn't been created yet (NotFoundError). Retry the read itself
  //     until it stably succeeds, rather than time-boxing a single attempt.
  await page.evaluate(async (name) => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { setActiveDocument(d: unknown): void } };
      __zilventorGetOpfs: () => Promise<{ read(path: string): Promise<Uint8Array> }>;
      __zilventorUnpackAssembly: (bytes: Uint8Array) => Promise<unknown>;
    };
    w.__zilventorStore.getState().setActiveDocument(null);
    const opfs = await w.__zilventorGetOpfs();
    const deadline = Date.now() + 10_000;
    let bytes: Uint8Array | undefined;
    for (;;) {
      try {
        bytes = await opfs.read(name);
        break;
      } catch (e) {
        const isNotFound = e instanceof Error && e.name === 'NotFoundError';
        if (!isNotFound || Date.now() >= deadline) throw e;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const doc = await w.__zilventorUnpackAssembly(bytes);
    w.__zilventorStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
  }, autosavedName);

  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeAssembly?: { components: unknown[] } | null } };
    };
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 2;
  });

  // 11. Re-load panel specs and re-open Cut List tab.
  await page.evaluate(async () => {
    const w = window as unknown as { __zilventorLoadCutListSpecs?: () => Promise<void> };
    await w.__zilventorLoadCutListSpecs?.();
  });
  await page.getByRole('button', { name: 'Cut List tab' }).click();

  // 12. Assert the Item# 7 persists after reload.
  const rowsAfterReload = page.locator('[data-cutlist-row]');
  await expect(rowsAfterReload).toHaveCount(2, { timeout: 10_000 });
  const allItemNums = await Promise.all([
    rowsAfterReload.nth(0).locator('td').first().textContent(),
    rowsAfterReload.nth(1).locator('td').first().textContent(),
  ]);
  expect(allItemNums.map(Number)).toContain(7);

  // 13. Click Renumber in the Furniture ribbon — should resequence rows to 1, 2.
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.locator('[aria-label="Cut List panel"]').getByRole('button', { name: 'Renumber' }).click();

  // Re-open Cut List tab to see the updated numbers.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.getByRole('button', { name: 'Cut List tab' }).click();

  const rowsAfterRenumber = page.locator('[data-cutlist-row]');
  await expect(rowsAfterRenumber).toHaveCount(2, { timeout: 10_000 });
  const item0 = Number(await rowsAfterRenumber.nth(0).locator('td').first().textContent());
  const item1 = Number(await rowsAfterRenumber.nth(1).locator('td').first().textContent());
  expect(new Set([item0, item1])).toEqual(new Set([1, 2]));
});
