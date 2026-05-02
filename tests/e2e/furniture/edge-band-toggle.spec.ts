import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * T35 — edge-band toggle persistence.
 *
 * Seeds a panel-bearing part with one banded edge so the SceneManager builds
 * a single LineSegments overlay. Then exercises the View-tab "Show edge
 * bands" toggle:
 *   1. Toggle off → overlay count drops to 0; localStorage records false.
 *   2. Reload → checkbox still off (store re-hydrates from localStorage),
 *      overlays still 0.
 *   3. Toggle on → overlays restored.
 *   4. Reload → overlay state still on.
 *
 * Persistence lives in `useAppStore`'s `setShowEdgeBands` (writes to
 * `localStorage.showEdgeBands`); init reads the same key. We verify that
 * round-trip in the browser, not just the in-memory flag.
 *
 * Reads SceneManager via the same `store.viewport.getSceneManager()` chain
 * used by T34.
 */
test('T35 — show-edge-bands toggle persists across reloads', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New Part.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 2. Inject a panel feature with one banded edge so the overlay subsystem
  //    has something to draw.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: { id: string; featureTree: unknown[] } | null;
          setActivePart(p: unknown): void;
          addMaterial(m: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    if (!s.activePart) throw new Error('no active part');
    s.addMaterial({
      id: 'mat-band', name: 'Band', defaultThickness: 1, color: '#ff0000',
    });
    const stateWithMat = w.__zilventorStore.getState().activePart!;
    const panel = {
      kind: 'panel',
      id: 'pf-toggle',
      length: { kind: 'literal', value: 600 },
      width: { kind: 'literal', value: 400 },
      thickness: { kind: 'literal', value: 18 },
      thicknessFromMaterial: false,
      materialId: 'mat-band',
      grain: 'length',
      edgeBands: {
        front: { materialId: 'mat-band' },
        back: null, left: null, right: null,
      },
    };
    s.setActivePart({
      ...stateWithMat,
      featureTree: [...stateWithMat.featureTree, panel],
    });
  });

  const readOverlayCount = async () => {
    return await page.evaluate(() => {
      const store = (window as unknown as {
        __zilventorStore: { getState(): { viewport: unknown } };
      }).__zilventorStore.getState();
      const vp = store.viewport as { getSceneManager?(): unknown } | null;
      const sm = vp?.getSceneManager?.() as
        | { edgeBandOverlayCount(): number }
        | null;
      return sm?.edgeBandOverlayCount?.() ?? -1;
    });
  };

  const readShowEdgeBandsLs = async () => {
    return await page.evaluate(() =>
      localStorage.getItem('showEdgeBands'),
    );
  };

  // 3. Initial state: overlay rendered (1 banded edge), button shows "✓".
  await expect.poll(readOverlayCount, { timeout: 10_000 }).toBe(1);

  // 4. Switch to View tab and toggle off.
  await page.getByRole('tab', { name: 'View' }).click();
  const toggle = page.getByRole('button', { name: /Show edge bands/i });
  await expect(toggle).toContainText(/^✓\s*Show edge bands$/);
  await toggle.click();

  // Off state: button no longer prefixed with ✓.
  await expect(toggle).toHaveText(/^Show edge bands$/);
  await expect.poll(readOverlayCount, { timeout: 5_000 }).toBe(0);
  expect(await readShowEdgeBandsLs()).toBe('false');

  // 5. Reload — state persists.
  await page.reload();
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'View' }).click();
  const toggleAfterReload = page.getByRole('button', { name: /Show edge bands/i });
  await expect(toggleAfterReload).toHaveText(/^Show edge bands$/);
  expect(await readShowEdgeBandsLs()).toBe('false');

  // After reload there is no active part (no panel) — overlay count is 0
  // either way; the load-bearing assertion is the localStorage flag plus
  // the unchecked button. Re-seed the panel and verify overlays stay 0
  // (because showEdgeBands is false), proving the off state is honored.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: { id: string; featureTree: unknown[] } | null;
          setActivePart(p: unknown): void;
          addMaterial(m: unknown): void;
        };
      };
    };
    const s = w.__zilventorStore.getState();
    s.addMaterial({
      id: 'mat-band', name: 'Band', defaultThickness: 1, color: '#ff0000',
    });
    const stateWithMat = w.__zilventorStore.getState().activePart!;
    const panel = {
      kind: 'panel',
      id: 'pf-toggle-2',
      length: { kind: 'literal', value: 600 },
      width: { kind: 'literal', value: 400 },
      thickness: { kind: 'literal', value: 18 },
      thicknessFromMaterial: false,
      materialId: 'mat-band',
      grain: 'length',
      edgeBands: {
        front: { materialId: 'mat-band' },
        back: null, left: null, right: null,
      },
    };
    s.setActivePart({
      ...stateWithMat,
      featureTree: [...stateWithMat.featureTree, panel],
    });
  });

  // Give the scene a moment, then assert overlays remain suppressed.
  await page.waitForTimeout(500);
  expect(await readOverlayCount()).toBe(0);

  // 6. Toggle back on.
  await page.getByRole('tab', { name: 'View' }).click();
  await toggleAfterReload.click();
  await expect(toggleAfterReload).toContainText(/^✓\s*Show edge bands$/);
  await expect.poll(readOverlayCount, { timeout: 5_000 }).toBe(1);
  expect(await readShowEdgeBandsLs()).toBe('true');

  // 7. Reload once more; on-state persists.
  await page.reload();
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'View' }).click();
  const toggleFinal = page.getByRole('button', { name: /Show edge bands/i });
  await expect(toggleFinal).toContainText(/^✓\s*Show edge bands$/);
  expect(await readShowEdgeBandsLs()).toBe('true');
});
