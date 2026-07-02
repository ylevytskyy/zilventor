import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

/**
 * Locking test for a status-clobber race between the OPFS part-autosave
 * debounce (App.tsx, 500ms) and the reactive kernel-execute effect.
 *
 * Root cause: `kernel.saveToBytes()` unconditionally re-runs `executeTree()`
 * to bake the BRep, with no "has a solid-producing feature" guard — unlike
 * the App.tsx reactive re-execute effect, which explicitly skips execute()
 * for a fresh empty part (only origin.* work features, no solid). If the
 * 500ms autosave debounce fires while a part is still empty (no user
 * feature added yet), `saveToBytes` throws "Feature tree produced no
 * solid", which the autosave catch handler surfaces as a status message
 * ("Not saved — execute failed before save: ..."). That status is never
 * cleared afterwards: the reactive effect only clears status it set itself
 * (`lastExecuteErrorRef`), not a status set by the independent autosave
 * effect. So the phantom error persists even after a feature is
 * successfully added and rendered.
 *
 * Under parallel e2e load this window (New Part created, wait for next
 * user action) routinely exceeds 500ms of real wall-clock time, causing
 * intermittent failures in specs that assert a clean status bar after
 * adding the first feature (pbr-textures-panel, m4-leg-levelers,
 * m4-tandem-slides, cabinet-blind-corner-create, etc). This test
 * reproduces the mechanism deterministically with an explicit wait —
 * no parallel workers required.
 */
test('autosave on an empty part does not leave a phantom "produced no solid" status after a feature is later added', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // Let the 500ms autosave debounce fire while the part is still empty
  // (no user feature yet) — this is the exact window the reactive effect
  // guards against, but the autosave effect does not.
  await page.waitForTimeout(700);

  // Now add a feature via the bus, same pattern as pbr-textures-panel.spec.ts.
  await page.evaluate(async () => {
    const { AddPanelFeatureCommand } = await import('/src/commands/AddPanelFeatureCommand.ts');
    const w = window as unknown as {
      __zilventorStore: { getState(): { activePart: { id: string } | null; bus: { execute(c: unknown): Promise<unknown> } } };
    };
    const store = w.__zilventorStore;
    const bus = store.getState().bus;
    await bus.execute(new AddPanelFeatureCommand({
      kind: 'panel', id: 'pf-autosave-race-e2e',
      length: { kind: 'literal', value: 400 },
      width: { kind: 'literal', value: 300 },
      thickness: { kind: 'literal', value: 18 },
      thicknessFromMaterial: false,
      materialId: undefined as unknown as string,
      grain: 'none',
      edgeBands: { front: null, back: null, left: null, right: null },
    }));
  });

  await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 60_000 });

  const status = await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): Record<string, unknown> } };
    return (w.__zilventorStore.getState().statusMessage as string) ?? '';
  });
  expect(status, 'status bar must not contain a phantom no-solid error after the panel renders').not.toContain('produced no solid');
});
