// tests/e2e/helpers/waitForAutosave.ts
import type { Page } from '@playwright/test';

/**
 * Wait until the OPFS autosave completes one write cycle after a store mutation.
 * Strategy: poll `window.__zilventorAutosaveStats().writeCount` until it increments
 * by at least 1 beyond the current value, with a generous ceiling.
 * The autosave debounce fires 500 ms after the last `activeDocument` change;
 * we wait up to 3000 ms total to be safe under CI load.
 *
 * Falls back to a fixed 700ms wait if __zilventorAutosaveStats is not exposed
 * (provides a baseline for environments where the stats hook is not installed).
 */
export async function waitForAutosave(page: Page, timeoutMs = 3000): Promise<void> {
  const statsAvailable: boolean = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorAutosaveStats?: () => { writeCount: number };
    };
    return typeof w.__zilventorAutosaveStats === 'function';
  });

  if (!statsAvailable) {
    // Baseline fallback: 700ms covers the 500ms debounce with margin.
    await page.waitForTimeout(700);
    return;
  }

  const writtenBefore: number = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorAutosaveStats?: () => { writeCount: number };
    };
    return w.__zilventorAutosaveStats?.()?.writeCount ?? 0;
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const writtenNow: number = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorAutosaveStats?: () => { writeCount: number };
      };
      return w.__zilventorAutosaveStats?.()?.writeCount ?? 0;
    });
    if (writtenNow > writtenBefore) return;
  }
  throw new Error(`waitForAutosave: no autosave write detected within ${timeoutMs}ms`);
}
